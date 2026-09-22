import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum TransactionStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum TransactionCategory {
  TRANSFER = 'TRANSFER',
  SERVICES = 'SERVICES',
  FOOD = 'FOOD',
  ENTERTAINMENT = 'ENTERTAINMENT',
  SHOPPING = 'SHOPPING',
  SALARY = 'SALARY',
  OTHER = 'OTHER',
}

@Entity('transactions')
@Index(['sourceAccountNumber'])
@Index(['targetAccountNumber'])
@Index(['correlationId'])
@Index(['createdAt'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 64 })
  correlationId: string;

  @Column({ name: 'source_account_number', type: 'varchar', length: 20 })
  sourceAccountNumber: string;

  @Column({ name: 'target_account_number', type: 'varchar', length: 20 })
  targetAccountNumber: string;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  amount: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'varchar', length: 255, default: 'Transferencia SmartBancs' })
  description: string;

  @Column({
    type: 'enum',
    enum: TransactionCategory,
    default: TransactionCategory.TRANSFER,
  })
  category: TransactionCategory;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true })
  errorMessage: string;

  @Column({ name: 'execution_time_ms', type: 'int', default: 0 })
  executionTimeMs: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
