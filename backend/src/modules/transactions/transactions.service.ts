import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transaction, TransactionCategory, TransactionStatus } from './entities/transaction.entity';
import { Account, AccountStatus } from '../accounts/entities/account.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly rabbitmqService: RabbitMQService,
    private readonly metricsService: MetricsService,
    private readonly logger: CustomLoggerService,
  ) {}

  async processTransaction(
    dto: CreateTransactionDto,
    correlationId: string,
  ): Promise<Transaction> {
    const startTime = Date.now();
    const { sourceAccountNumber, targetAccountNumber, amount, description, category, currency } = dto;

    if (sourceAccountNumber === targetAccountNumber) {
      throw new BadRequestException('La cuenta de origen y destino no pueden ser iguales');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    let createdTx: Transaction | null = null;

    try {
      this.logger.log(`Starting transaction processing: ${sourceAccountNumber} -> ${targetAccountNumber} ($${amount})`, {
        correlationId,
        sourceAccountNumber,
        targetAccountNumber,
        amount,
      });

      // PREVENCIÓN DE DEADLOCKS: Ordenar cuentas lexicográficamente al adquirir el lock pesimista
      const accountsToLock = [sourceAccountNumber, targetAccountNumber].sort();
      const firstAccNum = accountsToLock[0];
      const secondAccNum = accountsToLock[1];

      // Bloqueo pesimista exclusivo (SELECT ... FOR UPDATE)
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
        throw new NotFoundException(
          `Una o ambas cuentas no existen (#${firstAccNum}, #${secondAccNum})`,
        );
      }

      const sourceAccount = sourceAccountNumber === firstAccount.accountNumber ? firstAccount : secondAccount;
      const targetAccount = targetAccountNumber === firstAccount.accountNumber ? firstAccount : secondAccount;

      // Validar estados de cuenta
      if (sourceAccount.status !== AccountStatus.ACTIVE) {
        throw new BadRequestException(`La cuenta origen #${sourceAccountNumber} no está activa (${sourceAccount.status})`);
      }
      if (targetAccount.status !== AccountStatus.ACTIVE) {
        throw new BadRequestException(`La cuenta destino #${targetAccountNumber} no está activa (${targetAccount.status})`);
      }

      // Validar fondos suficientes (Previene sobregiros y race conditions)
      const currentBalance = Number(sourceAccount.balance);
      if (currentBalance < amount) {
        throw new BadRequestException(
          `Fondos insuficientes en la cuenta #${sourceAccountNumber}. Saldo disponible: $${currentBalance.toFixed(2)}, Requerido: $${amount.toFixed(2)}`,
        );
      }

      // Actualizar saldos de forma consistente
      sourceAccount.balance = Number((currentBalance - amount).toFixed(2));
      targetAccount.balance = Number((Number(targetAccount.balance) + amount).toFixed(2));

      await queryRunner.manager.save(Account, [sourceAccount, targetAccount]);

      const executionTime = Date.now() - startTime;

      // Registrar transacción exitosa
      createdTx = queryRunner.manager.create(Transaction, {
        correlationId,
        sourceAccountNumber,
        targetAccountNumber,
        amount,
        currency: currency || 'USD',
        description: description || 'Transferencia SmartBancs',
        category: category || TransactionCategory.TRANSFER,
        status: TransactionStatus.COMPLETED,
        executionTimeMs: executionTime,
      });

      await queryRunner.manager.save(Transaction, createdTx);

      // Commit atómico
      await queryRunner.commitTransaction();

      const totalTimeSec = (Date.now() - startTime) / 1000;
      this.metricsService.recordTransaction('COMPLETED', createdTx.category, totalTimeSec);

      this.logger.log(`Transaction successfully completed in ${executionTime}ms (ID: ${createdTx.id})`, {
        correlationId,
        transactionId: createdTx.id,
        durationMs: executionTime,
      });

      // PUBLICACIÓN ASÍNCRONA NO BLOQUEANTE (RabbitMQ):
      // No bloquea la respuesta HTTP al usuario garantizando SLA < 2 segundos
      this.dispatchAsyncEvents(createdTx, sourceAccount, correlationId);

      return createdTx;
    } catch (error) {
      await queryRunner.rollbackTransaction();

      const totalTimeSec = (Date.now() - startTime) / 1000;
      this.metricsService.recordTransaction('FAILED', category || TransactionCategory.TRANSFER, totalTimeSec);

      if (error.message && (error.message.includes('deadlock') || error.message.includes('could not obtain lock'))) {
        this.metricsService.recordDeadlock();
      }

      this.logger.error(`Transaction processing failed: ${error.message}`, error.stack, {
        correlationId,
        sourceAccountNumber,
        targetAccountNumber,
        amount,
      });

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(`Error en el procesamiento transaccional: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  private dispatchAsyncEvents(tx: Transaction, sourceAccount: Account, correlationId: string) {
    // 1. Enviar evento al microservicio de IA para generar recomendación financiera
    const aiPayload = {
      transactionId: tx.id,
      accountNumber: tx.sourceAccountNumber,
      amount: tx.amount,
      category: tx.category,
      currentBalance: sourceAccount.balance,
      description: tx.description,
      timestamp: tx.createdAt,
    };
    this.rabbitmqService.publishEvent('transaction.created', aiPayload, correlationId).catch((err) => {
      this.logger.warn(`Failed async publish to AI queue: ${err.message}`, { correlationId });
    });

    // 2. Enviar evento de sincronización hacia el Core Legado Bancs (Rate-limited buffer)
    const bancsSyncPayload = {
      legacySystem: 'BANCS_CORE',
      transactionId: tx.id,
      sourceAccount: tx.sourceAccountNumber,
      targetAccount: tx.targetAccountNumber,
      amount: tx.amount,
      syncStatus: 'QUEUED',
      timestamp: tx.createdAt,
    };
    this.rabbitmqService.publishEvent('bancs.sync', bancsSyncPayload, correlationId).catch((err) => {
      this.logger.warn(`Failed async publish to Bancs sync queue: ${err.message}`, { correlationId });
    });
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
