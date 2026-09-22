import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Transaction, TransactionCategory, TransactionStatus } from './entities/transaction.entity';
import { Account, AccountStatus } from '../accounts/entities/account.entity';
import { DataSource } from 'typeorm';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { CustomLoggerService } from '../../common/logger/logger.service';

describe('TransactionsService - SLA & Async AI Decoupling Test', () => {
  let service: TransactionsService;
  let rabbitmqService: RabbitMQService;

  const mockQueryRunner: any = {
    connect: jest.fn().mockResolvedValue(null),
    startTransaction: jest.fn().mockResolvedValue(null),
    commitTransaction: jest.fn().mockResolvedValue(null),
    rollbackTransaction: jest.fn().mockResolvedValue(null),
    release: jest.fn().mockResolvedValue(null),
    manager: {
      createQueryBuilder: jest.fn().mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockImplementation(async () => ({
          accountNumber: '1000000001',
          accountHolder: 'Test User',
          balance: 5000.0,
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

  const mockRabbitMQService = {
    publishEvent: jest.fn().mockResolvedValue(true),
  };

  const mockMetricsService = {
    recordTransaction: jest.fn(),
    recordDeadlock: jest.fn(),
  };

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
        { provide: getRepositoryToken(Transaction), useValue: {} },
        { provide: RabbitMQService, useValue: mockRabbitMQService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: CustomLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
    rabbitmqService = module.get<RabbitMQService>(RabbitMQService);
  });

  it('debe procesar la transacción y despachar el evento de IA de forma asíncrona no bloqueante', async () => {
    // Sobrescribir queryBuilder para simular cuenta origen y destino
    mockQueryRunner.manager.createQueryBuilder = jest.fn().mockImplementation((entity, alias) => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation((query, params) => ({
        getOne: jest.fn().mockResolvedValue({
          accountNumber: params.num,
          accountHolder: `User ${params.num}`,
          balance: 5000.0,
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

    // Verificar que se emitió el evento a RabbitMQ para la IA sin bloquear la respuesta
    expect(mockRabbitMQService.publishEvent).toHaveBeenCalledWith(
      'transaction.created',
      expect.objectContaining({
        accountNumber: '1000000001',
        amount: 250.0,
        category: TransactionCategory.TRANSFER,
      }),
      'CORR-TEST-123',
    );
  });
});
