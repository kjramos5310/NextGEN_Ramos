import {
  Injectable,
  BadRequestException,
  HttpException,
  NotFoundException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
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

/** Etiqueta para smartbancs_db_errors_total cuando el error no trae SQLSTATE (pool agotado). */
export const POOL_TIMEOUT = 'POOL_TIMEOUT';

/** pg-pool lanza un Error sin SQLSTATE cuando vence connectionTimeoutMillis esperando una conexión libre. */
export function isPoolTimeout(error: any): boolean {
  const msg = String(error?.message ?? error?.driverError?.message ?? '');
  return /timeout exceeded when trying to connect|connection terminated due to connection timeout/i.test(msg);
}

/** Monto en centavos enteros: evita comparar floats (0.1 + 0.2 !== 0.3). */
export function toCents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

/** Representación exacta con 2 decimales para enviarla a PostgreSQL como NUMERIC. */
export function toAmountString(value: number | string): string {
  const cents = toCents(value);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
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

    for (let attempt = 1; ; attempt++) {
      try {
        // IDEMPOTENCIA (G2): si la clave ya fue procesada se devuelve el resultado original.
        // Va dentro del try: un timeout del pool aquí también responde 503 y suma en la métrica.
        if (idempotencyKey && attempt === 1) {
          const previous = await this.transactionRepository.findOne({ where: { idempotencyKey } });
          if (previous) {
            this.assertSameRequest(previous, dto, idempotencyKey);
            this.logger.log(`Idempotent replay: key ${idempotencyKey} -> tx ${previous.id}`, { correlationId, idempotencyKey });
            return previous;
          }
        }
        return await this.executeTransfer(dto, correlationId, idempotencyKey, startTime);
      } catch (error) {
        const sqlstate = pgErrorCode(error);
        const poolTimeout = !sqlstate && isPoolTimeout(error);
        if (sqlstate) this.metricsService.recordDbError(sqlstate);
        else if (poolTimeout) this.metricsService.recordDbError(POOL_TIMEOUT);

        // Dos peticiones concurrentes con la misma clave: gana una, la otra devuelve la ganadora
        if (sqlstate === PG.UNIQUE_VIOLATION && idempotencyKey) {
          const winner = await this.transactionRepository.findOne({ where: { idempotencyKey } });
          if (winner) {
            this.assertSameRequest(winner, dto, idempotencyKey);
            return winner;
          }
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
          correlationId, sourceAccountNumber, targetAccountNumber, amount,
          sqlstate: sqlstate ?? (poolTimeout ? POOL_TIMEOUT : undefined), attempt,
          query: error?.query,
        });

        if (error instanceof HttpException) throw error;
        if (poolTimeout) {
          throw new ServiceUnavailableException('Pool de conexiones agotado (POOL_TIMEOUT). Reintente la operación.');
        }
        if (sqlstate === PG.LOCK_NOT_AVAILABLE || sqlstate === PG.QUERY_CANCELED || (sqlstate && RETRYABLE.has(sqlstate))) {
          // Falla rápido: libera la conexión en vez de acumular espera durante el pico
          throw new ServiceUnavailableException(`Sistema bajo alta contención (SQLSTATE ${sqlstate}). Reintente la operación.`);
        }
        throw new InternalServerErrorException('Error en el procesamiento transaccional');
      }
    }
  }

  /** Misma Idempotency-Key con otro origen, destino o monto: es otro pago, no un reintento (422). */
  private assertSameRequest(previous: Transaction, dto: CreateTransactionDto, idempotencyKey: string) {
    const same =
      previous.sourceAccountNumber === dto.sourceAccountNumber &&
      previous.targetAccountNumber === dto.targetAccountNumber &&
      toCents(previous.amount) === toCents(dto.amount);
    if (!same) {
      throw new UnprocessableEntityException(
        `La Idempotency-Key ${idempotencyKey} ya se usó con otro origen, destino o monto`,
      );
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

      const txCurrency = currency ?? sourceAccount.currency;
      if (sourceAccount.currency !== targetAccount.currency || txCurrency !== sourceAccount.currency) {
        throw new BadRequestException(
          `Moneda no coincide: transferencia ${txCurrency}, origen ${sourceAccount.currency}, destino ${targetAccount.currency}`,
        );
      }

      // Aritmética en NUMERIC dentro de PostgreSQL (no en float de JS): débito y crédito son
      // exactamente el mismo monto. El débito es condicional al saldo, así no hay que comparar floats.
      const amountStr = toAmountString(amount);
      const newSourceBalance = await this.applyDelta(
        queryRunner,
        `UPDATE accounts SET balance = balance - $1::numeric, version = version + 1, updated_at = now()
          WHERE account_number = $2 AND balance >= $1::numeric
          RETURNING balance::text AS balance`,
        [amountStr, sourceAccountNumber],
      );
      if (newSourceBalance === null) {
        throw new BadRequestException(
          `Fondos insuficientes en la cuenta #${sourceAccountNumber}. Saldo disponible: $${toAmountString(sourceAccount.balance)}, Requerido: $${amountStr}`,
        );
      }
      await this.applyDelta(
        queryRunner,
        `UPDATE accounts SET balance = balance + $1::numeric, version = version + 1, updated_at = now()
          WHERE account_number = $2
          RETURNING balance::text AS balance`,
        [amountStr, targetAccountNumber],
      );
      sourceAccount.balance = Number(newSourceBalance);

      const createdTx = queryRunner.manager.create(Transaction, {
        correlationId,
        sourceAccountNumber,
        targetAccountNumber,
        amount: Number(amountStr),
        currency: txCurrency,
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
      // Si la conexión murió, el ROLLBACK también falla: se conserva el error original
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction().catch(() => undefined);
      throw error;
    } finally {
      await queryRunner.release().catch(() => undefined);
    }
  }

  /** Ejecuta un UPDATE ... RETURNING balance y devuelve el saldo nuevo (texto NUMERIC) o null si no afectó filas. */
  private async applyDelta(queryRunner: QueryRunner, sql: string, params: unknown[]): Promise<string | null> {
    const result = await queryRunner.query(sql, params);
    // TypeORM devuelve [rows, rowCount] para UPDATE
    const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    return Array.isArray(rows) && rows.length > 0 ? String(rows[0].balance) : null;
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
