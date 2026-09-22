import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Transaction, TransactionCategory, TransactionStatus } from './entities/transaction.entity';
import { Account, AccountStatus } from '../accounts/entities/account.entity';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity';
import { MetricsService } from '../../common/metrics/metrics.service';
import { CustomLoggerService } from '../../common/logger/logger.service';

describe('TransactionsService - SLA, Outbox e idempotencia (unitario)', () => {
  let service: TransactionsService;

  const mockQueryRunner: any = {
    connect: jest.fn().mockResolvedValue(null),
    startTransaction: jest.fn().mockResolvedValue(null),
    commitTransaction: jest.fn().mockResolvedValue(null),
    rollbackTransaction: jest.fn().mockResolvedValue(null),
    release: jest.fn().mockResolvedValue(null),
    // UPDATE accounts ... RETURNING balance: TypeORM devuelve [rows, rowCount]
    query: jest.fn().mockImplementation(async (sql: string) =>
      sql.includes('UPDATE accounts') ? [[{ balance: '4750.00' }], 1] : null,
    ),
    isTransactionActive: true,
    manager: {
      insert: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockImplementation(async () => ({
          accountNumber: '1000000001',
          accountHolder: 'Test User',
          balance: 5000.0,
          currency: 'USD',
          status: AccountStatus.ACTIVE,
        })),
      }),
      save: jest.fn().mockImplementation(async (entity, obj) => obj),
      create: jest.fn().mockImplementation((entity, data) => ({
        id: 'tx-uuid-1234',
        ...data,
      })),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockMetricsService = {
    recordTransaction: jest.fn(),
    recordDbError: jest.fn(),
    recordTransactionRetry: jest.fn(),
  };

  const mockTxRepository = { findOne: jest.fn().mockResolvedValue(null) };

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: getRepositoryToken(Transaction), useValue: mockTxRepository },
        { provide: ConfigService, useValue: { get: (_k: string, d: any) => d } },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: CustomLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  it('procesa la transferencia y escribe los eventos de IA y Bancs en el outbox dentro de la misma transacción', async () => {
    // Sobrescribir queryBuilder para simular cuenta origen y destino
    mockQueryRunner.manager.createQueryBuilder = jest.fn().mockImplementation((entity, alias) => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation((query, params) => ({
        getOne: jest.fn().mockResolvedValue({
          accountNumber: params.num,
          accountHolder: `User ${params.num}`,
          balance: 5000.0,
          currency: 'USD',
          status: AccountStatus.ACTIVE,
        }),
      })),
    }));

    const startTime = Date.now();

    const result = await service.processTransaction(
      {
        sourceAccountNumber: '1000000001',
        targetAccountNumber: '1000000002',
        amount: 250.0,
        category: TransactionCategory.TRANSFER,
        description: 'Test SLA Transfer',
      },
      'CORR-TEST-123',
    );

    const executionDuration = Date.now() - startTime;

    // Verificar que la transacción fue exitosa
    expect(result).toBeDefined();
    expect(result.status).toBe(TransactionStatus.COMPLETED);
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);

    // Verificar que la respuesta es inmediata (muy por debajo de 2000 ms)
    expect(executionDuration).toBeLessThan(2000);

    // Timeouts por transacción (G3)
    expect(mockQueryRunner.query).toHaveBeenCalledWith(expect.stringContaining('SET LOCAL lock_timeout'));
    expect(mockQueryRunner.query).toHaveBeenCalledWith(expect.stringContaining('SET LOCAL statement_timeout'));

    // Outbox (G1): los eventos se insertan en la misma transacción, ANTES del commit.
    // La API ya no publica directamente en RabbitMQ.
    expect(mockQueryRunner.manager.insert).toHaveBeenCalledWith(
      OutboxEvent,
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'transaction.created',
          payload: expect.objectContaining({ accountNumber: '1000000001', amount: 250.0 }),
          correlationId: 'CORR-TEST-123',
        }),
        expect.objectContaining({ eventType: 'bancs.sync' }),
      ]),
    );
    const insertOrder = mockQueryRunner.manager.insert.mock.invocationCallOrder[0];
    const commitOrder = mockQueryRunner.commitTransaction.mock.invocationCallOrder[0];
    expect(insertOrder).toBeLessThan(commitOrder);
  });

  it('devuelve la transacción original ante una Idempotency-Key repetida sin tocar la BD', async () => {
    const original = {
      id: 'tx-original',
      status: TransactionStatus.COMPLETED,
      sourceAccountNumber: '1000000001',
      targetAccountNumber: '1000000002',
      amount: 10,
    };
    mockTxRepository.findOne.mockResolvedValueOnce(original);
    mockDataSource.createQueryRunner.mockClear();

    const result = await service.processTransaction(
      { sourceAccountNumber: '1000000001', targetAccountNumber: '1000000002', amount: 10 },
      'CORR-IDEMP',
      'key-123',
    );

    expect(result).toBe(original);
    expect(mockDataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('responde 422 si la misma Idempotency-Key llega con otro monto o destino', async () => {
    const original = {
      id: 'tx-original',
      sourceAccountNumber: '1000000001',
      targetAccountNumber: '1000000002',
      amount: 10,
    };
    mockTxRepository.findOne.mockResolvedValueOnce(original);
    await expect(
      service.processTransaction(
        { sourceAccountNumber: '1000000001', targetAccountNumber: '1000000002', amount: 999 },
        'CORR-IDEMP-2',
        'key-123',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    mockTxRepository.findOne.mockResolvedValueOnce(original);
    await expect(
      service.processTransaction(
        { sourceAccountNumber: '1000000001', targetAccountNumber: '1000000003', amount: 10 },
        'CORR-IDEMP-3',
        'key-123',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('pool agotado: responde 503 y cuenta POOL_TIMEOUT en smartbancs_db_errors_total', async () => {
    mockMetricsService.recordDbError.mockClear();
    mockQueryRunner.connect.mockRejectedValueOnce(new Error('timeout exceeded when trying to connect'));

    await expect(
      service.processTransaction(
        { sourceAccountNumber: '1000000001', targetAccountNumber: '1000000002', amount: 10 },
        'CORR-POOL',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockMetricsService.recordDbError).toHaveBeenCalledWith('POOL_TIMEOUT');
  });
});
