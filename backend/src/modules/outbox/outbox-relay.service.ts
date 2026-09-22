import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { CustomLoggerService } from '../../common/logger/logger.service';

interface PendingRow {
  id: string;
  event_type: string;
  payload: Record<string, any>;
  correlation_id: string | null;
}

/**
 * Message relay del Transactional Outbox (variante "polling publisher").
 *
 * - Lee eventos pendientes con FOR UPDATE SKIP LOCKED: varias réplicas del backend
 *   pueden correr el relay a la vez sin publicar dos veces el mismo lote.
 * - Solo marca published_at si el broker aceptó el mensaje. Si RabbitMQ está caído,
 *   el evento queda pendiente y se reintenta en el siguiente ciclo (no se pierde).
 * - Entrega at-least-once: los consumidores deben ser idempotentes (eventId en el mensaje).
 *
 * En producción esta pieza se reemplaza por CDC sobre el WAL (Debezium Outbox Event Router).
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly rabbitmqService: RabbitMQService,
    private readonly metricsService: MetricsService,
    private readonly logger: CustomLoggerService,
    configService: ConfigService,
  ) {
    this.intervalMs = Number(configService.get('OUTBOX_POLL_INTERVAL_MS', 1000));
    this.batchSize = Number(configService.get('OUTBOX_BATCH_SIZE', 100));
  }

  onModuleInit() {
    if (process.env.OUTBOX_RELAY_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Publica un lote de eventos pendientes. Devuelve cuántos se publicaron. */
  async flush(): Promise<number> {
    if (this.running) return 0; // un solo ciclo a la vez por instancia
    this.running = true;
    const qr = this.dataSource.createQueryRunner();
    let published = 0;
    try {
      await qr.connect();
      await qr.startTransaction();
      const rows: PendingRow[] = await qr.query(
        `SELECT id, event_type, payload, correlation_id
           FROM outbox_events
          WHERE published_at IS NULL
          ORDER BY created_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [this.batchSize],
      );

      for (const row of rows) {
        const ok = await this.rabbitmqService.publishEvent(
          row.event_type,
          { eventId: row.id, ...row.payload },
          row.correlation_id ?? undefined,
        );
        if (ok) {
          await qr.query(`UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = $1`, [row.id]);
          published++;
        } else {
          await qr.query(
            `UPDATE outbox_events SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
            [row.id, 'broker no disponible'],
          );
          break; // el broker no acepta: no tiene sentido seguir con el lote
        }
      }
      await qr.commitTransaction();

      const [{ pending }] = await qr.query(
        `SELECT count(*)::int AS pending FROM outbox_events WHERE published_at IS NULL`,
      );
      this.metricsService.setOutboxPending(pending);
      if (published > 0) {
        this.logger.log(`[OUTBOX] ${published} eventos publicados, ${pending} pendientes`);
      }
    } catch (error) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      this.logger.error(`[OUTBOX] Error en el relay: ${error.message}`, error.stack);
    } finally {
      await qr.release();
      this.running = false;
    }
    return published;
  }
}
