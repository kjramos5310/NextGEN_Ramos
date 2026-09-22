import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { Transaction, TransactionCategory, TransactionStatus } from './entities/transaction.entity';
import { Account, AccountStatus } from '../accounts/entities/account.entity';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { MetricsService } from '../../common/metrics/metrics.service';
import { CustomLoggerService } from '../../common/logger/logger.service';

/** SQLSTATE de PostgreSQL relevantes (https://www.postgresql.org/docs/current/errcodes-appendix.html) */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03', // lock_timeout
  QUERY_CANCELED: '57014', // statement_timeout
} as const;

/** Conflictos transitorios: PostgreSQL recomienda reintentar la transacción completa. */
const RETRYABLE = new Set<string>([PG.DEADLOCK_DETECTED, PG.SERIALIZATION_FAILURE]);

export function pgErrorCode(error: any): string | undefined {
  return error?.code ?? error?.driverError?.code;
}

@Injectable()
export class TransactionsService {
  private readonly lockTimeoutMs: number;
  private readonly statementTimeoutMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly metricsService: MetricsService,
    private readonly logger: CustomLoggerService,
    configService: ConfigService,
  ) {
    this.lockTimeoutMs = Number(configService.get('DB_LOCK_TIMEOUT_MS', 2000));
    this.statementTimeoutMs = Number(configService.get('DB_STATEMENT_TIMEOUT_MS', 5000));
    this.maxAttempts = Number(configService.get('TX_MAX_ATTEMPTS', 3));
  }

  async processTransaction(
    dto: CreateTransactionDto,
    correlationId: string,
    idempotencyKey?: string,
  ): Promise<Transaction> {
    const startTime = Date.now();
    const { sourceAccountNumber, targetAccountNumber, amount } = dto;

    if (sourceAccountNumber === targetAccountNumber) {
      throw new BadRequestException('La cuenta de origen y destino no pueden ser iguales');
    }

    // IDEMPOTENCIA (G2): si la clave ya fue procesada se devuelve el resultado original
    if (idempotencyKey) {
      const previous = await this.transactionRepository.findOne({ where: { idempotencyKey } });
      if (previous) {
        this.logger.log(`Idempotent replay: key ${idempotencyKey} -> tx ${previous.id}`, { correlationId, idempotencyKey });
        return previous;
      }
    }

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.executeTransfer(dto, correlationId, idempotencyKey, startTime);
      } catch (error) {
        const sqlstate = pgErrorCode(error);
        if (sqlstate) this.metricsService.recordDbError(sqlstate);

        // Dos peticiones concurrentes con la misma clave: gana una, la otra devuelve la ganadora
        if (sqlstate === PG.UNIQUE_VIOLATION && idempotencyKey) {
          const winner = await this.transactionRepository.findOne({ where: { idempotencyKey } });
          if (winner) return winner;
        }

        if (sqlstate && RETRYABLE.has(sqlstate) && attempt < this.maxAttempts) {
          this.metricsService.recordTransactionRetry(sqlstate);
          const backoffMs = 20 * attempt + Math.floor(Math.random() * 30); // backoff con jitter
          this.logger.warn(`Concurrency conflict ${sqlstate}, retry ${attempt}/${this.maxAttempts - 1} in ${backoffMs}ms`, {
            correlationId, sqlstate, attempt,
          });
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        this.metricsService.recordTransaction(
          'FAILED',
          dto.category || TransactionCategory.TRANSFER,
          (Date.now() - startTime) / 1000,
        );
        // Se registra SQLSTATE y la consulta exacta para diagnosticar el cuello de botella (R3.5a-c)
        this.logger.error(`Transaction processing failed: ${error.message}`, error.stack, {
          correlationId, sourceAccountNumber, targetAccountNumber, amount, sqlstate, attempt,
          query: error?.query,
        });

        if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
        if (sqlstate === PG.LOCK_NOT_AVAILABLE || sqlstate === PG.QUERY_CANCELED || (sqlstate && RETRYABLE.has(sqlstate))) {
          // Falla rápido: libera la conexión en vez de acumular espera durante el pico
          throw new ServiceUnavailableException(`Sistema bajo alta contención (SQLSTATE ${sqlstate}). Reintente la operación.`);
        }
        throw new InternalServerErrorException('Error en el procesamiento transaccional');
      }
    }
  }

  private async executeTransfer(
    dto: CreateTransactionDto,
    correlationId: string,
    idempotencyKey: string | undefined,
    startTime: number,
  ): Promise<Transaction> {
    const { sourceAccountNumber, targetAccountNumber, amount, description, category, currency } = dto;
    const queryRunner: QueryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      // Límites por transacción (G3): una fila bloqueada o una consulta lenta no retienen
      // la conexión indefinidamente durante el pico de quincena
      await queryRunner.query(`SET LOCAL lock_timeout = '${Math.trunc(this.lockTimeoutMs)}ms'`);
      await queryRunner.query(`SET LOCAL statement_timeout = '${Math.trunc(this.statementTimeoutMs)}ms'`);

      this.logger.log(`Starting transaction processing: ${sourceAccountNumber} -> ${targetAccountNumber} ($${amount})`, {
        correlationId, sourceAccountNumber, targetAccountNumber, amount,
      });

      // PREVENCIÓN DE DEADLOCKS: orden determinista al adquirir los locks pesimistas
      const [firstAccNum, secondAccNum] = [sourceAccountNumber, targetAccountNumber].sort();

      const firstAccount = await queryRunner.manager
        .createQueryBuilder(Account, 'account')
        .setLock('pessimistic_write')
        .where('account.accountNumber = :num', { num: firstAccNum })
        .getOne();

      const secondAccount = await queryRunner.manager
        .createQueryBuilder(Account, 'account')
        .setLock('pessimistic_write')
        .where('account.accountNumber = :num', { num: secondAccNum })
        .getOne();

      if (!firstAccount || !secondAccount) {
        throw new NotFoundException(`Una o ambas cuentas no existen (#${firstAccNum}, #${secondAccNum})`);
      }

      const sourceAccount = sourceAccountNumber === firstAccount.accountNumber ? firstAccount : secondAccount;
      const targetAccount = targetAccountNumber === firstAccount.accountNumber ? firstAccount : secondAccount;

      if (sourceAccount.status !== AccountStatus.ACTIVE) {
        throw new BadRequestException(`La cuenta origen #${sourceAccountNumber} no está activa (${sourceAccount.status})`);
      }
      if (targetAccount.status !== AccountStatus.ACTIVE) {
        throw new BadRequestException(`La cuenta destino #${targetAccountNumber} no está activa (${targetAccount.status})`);
      }

      const currentBalance = Number(sourceAccount.balance);
      if (currentBalance < amount) {
        throw new BadRequestException(
          `Fondos insuficientes en la cuenta #${sourceAccountNumber}. Saldo disponible: $${currentBalance.toFixed(2)}, Requerido: $${amount.toFixed(2)}`,
        );
      }

      sourceAccount.balance = Number((currentBalance - amount).toFixed(2));
      targetAccount.balance = Number((Number(targetAccount.balance) + amount).toFixed(2));
      await queryRunner.manager.save(Account, [sourceAccount, targetAccount]);

      const createdTx = queryRunner.manager.create(Transaction, {
        correlationId,
        sourceAccountNumber,
        targetAccountNumber,
        amount,
        currency: currency || 'USD',
        description: description || 'Transferencia SmartBancs',
        category: category || TransactionCategory.TRANSFER,
        status: TransactionStatus.COMPLETED,
        executionTimeMs: Date.now() - startTime,
        idempotencyKey: idempotencyKey ?? null,
      });
      await queryRunner.manager.save(Transaction, createdTx);

      // TRANSACTIONAL OUTBOX (G1): los eventos se escriben en la MISMA transacción.
      // Si hay rollback no existen; si RabbitMQ está caído esperan en la tabla. No hay dual-write.
      await queryRunner.manager.insert(OutboxEvent, this.buildOutboxEvents(createdTx, sourceAccount, correlationId));

      await queryRunner.commitTransaction();

      const executionTime = Date.now() - startTime;
      this.metricsService.recordTransaction('COMPLETED', createdTx.category, executionTime / 1000);
      this.logger.log(`Transaction successfully completed in ${executionTime}ms (ID: ${createdTx.id})`, {
        correlationId, transactionId: createdTx.id, durationMs: executionTime,
      });

      // La respuesta sale apenas termina el COMMIT: la IA y Bancs se alimentan del outbox (RNF-2, RNF-3)
      return createdTx;
    } catch (error) {
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private buildOutboxEvents(tx: Transaction, sourceAccount: Account, correlationId: string): Partial<OutboxEvent>[] {
    const base = { aggregateType: 'transaction', aggregateId: tx.id, correlationId };
    return [
      {
        ...base,
        // Evento para el microservicio de IA (recomendación financiera)
        eventType: 'transaction.created',
        payload: {
          transactionId: tx.id,
          accountNumber: tx.sourceAccountNumber,
          amount: tx.amount,
          category: tx.category,
          currentBalance: sourceAccount.balance,
          description: tx.description,
          timestamp: tx.createdAt,
        },
      },
      {
        ...base,
        // Evento para la sincronización con el core legado Bancs (consumo a ritmo controlado)
        eventType: 'bancs.sync',
        payload: {
          legacySystem: 'BANCS_CORE',
          transactionId: tx.id,
          sourceAccount: tx.sourceAccountNumber,
          targetAccount: tx.targetAccountNumber,
          amount: tx.amount,
          syncStatus: 'QUEUED',
          timestamp: tx.createdAt,
        },
      },
    ];
  }

  async findAll(limit = 50): Promise<Transaction[]> {
    return this.transactionRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findByAccount(accountNumber: string, limit = 20): Promise<Transaction[]> {
    return this.transactionRepository.find({
      where: [
        { sourceAccountNumber: accountNumber },
        { targetAccountNumber: accountNumber },
      ],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findById(id: string): Promise<Transaction> {
    const tx = await this.transactionRepository.findOne({ where: { id } });
    if (!tx) {
      throw new NotFoundException(`Transacción ${id} no encontrada`);
    }
    return tx;
  }
}
