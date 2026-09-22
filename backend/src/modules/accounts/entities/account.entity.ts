import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  VersionColumn,
} from 'typeorm';

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  BLOCKED = 'BLOCKED',
  INACTIVE = 'INACTIVE',
}

export enum AccountType {
  SAVINGS = 'SAVINGS',
  CHECKING = 'CHECKING',
  INVESTMENT = 'INVESTMENT',
}

@Entity('accounts')
@Index(['accountNumber'], { unique: true })
@Index(['clientId'])
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_number', type: 'varchar', length: 20, unique: true })
  accountNumber: string;

  @Column({ name: 'account_holder', type: 'varchar', length: 100 })
  accountHolder: string;

  @Column({ name: 'client_id', type: 'varchar', length: 50 })
  clientId: string;

  @Column({
    type: 'enum',
    enum: AccountType,
    default: AccountType.SAVINGS,
  })
  type: AccountType;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0.0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  balance: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Column({
    type: 'enum',
    enum: AccountStatus,
    default: AccountStatus.ACTIVE,
  })
  status: AccountStatus;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
