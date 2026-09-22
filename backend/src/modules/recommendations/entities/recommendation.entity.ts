import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum RecommendationType {
  SAVINGS_ADVICE = 'SAVINGS_ADVICE',
  SPENDING_ALERT = 'SPENDING_ALERT',
  FRAUD_WARNING = 'FRAUD_WARNING',
  INVESTMENT_OPPORTUNITY = 'INVESTMENT_OPPORTUNITY',
  BUDGET_OPTIMIZATION = 'BUDGET_OPTIMIZATION',
}

@Entity('ai_recommendations')
@Index(['accountNumber'])
@Index(['createdAt'])
export class AIRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_number', type: 'varchar', length: 20 })
  accountNumber: string;

  @Column({ name: 'transaction_id', type: 'varchar', length: 64, nullable: true })
  transactionId: string;

  @Column({
    type: 'enum',
    enum: RecommendationType,
    default: RecommendationType.SAVINGS_ADVICE,
  })
  type: RecommendationType;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({
    name: 'confidence_score',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0.95,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  confidenceScore: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
