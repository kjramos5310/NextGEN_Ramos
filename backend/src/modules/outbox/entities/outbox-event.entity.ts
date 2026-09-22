import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Transactional Outbox (G1). Ver docs/knowledge-base/02-Referencias/Transactional Outbox.md
 * La fila se inserta en la misma transacción que el cambio de negocio.
 */
@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 50 })
  aggregateType: string;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 64 })
  aggregateId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ name: 'correlation_id', type: 'varchar', length: 64, nullable: true })
  correlationId: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @Column({ name: 'published_at', type: 'timestamp with time zone', nullable: true })
  publishedAt: Date | null;
}
