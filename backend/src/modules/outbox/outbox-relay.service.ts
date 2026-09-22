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
 * - Solo marca published_at si el broker confirmó el mensaje (publisher confirms). Si RabbitMQ
 *   está caído o responde nack/timeout, el evento queda pendiente y se reintenta (no se pierde).
 * - El lote se publica completo, se esperan las confirmaciones y se marca con un solo UPDATE.
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
  private static readonly MAX_BATCHES_PER_TICK = 10;

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
    // Nunca un rechazo sin manejar: en Node 20 terminaría el proceso
    this.timer = setInterval(() => {
      this.drain().catch((e) => this.logger.error(`[OUTBOX] Error inesperado en el relay: ${e?.message}`, e?.stack));
    }, this.intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Repite lotes mientras haya backlog (acotado por tick) para no quedar limitado a un lote por intervalo. */
  async drain(): Promise<number> {
    let total = 0;
    for (let i = 0; i < OutboxRelayService.MAX_BATCHES_PER_TICK; i++) {
      const { published, full } = await this.flushBatch();
      total += published;
      if (!full) break;
    }
    return total;
  }

  /** Publica un lote de eventos pendientes. Devuelve cuántos se publicaron. */
  async flush(): Promise<number> {
    return (await this.flushBatch()).published;
  }

  private async flushBatch(): Promise<{ published: number; full: boolean }> {
    if (this.running) return { published: 0, full: false }; // un solo ciclo a la vez por instancia
    this.running = true;
    const qr = this.dataSource.createQueryRunner();
    let published = 0;
    let full = false;
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

      // publishEvent llama a channel.publish de forma síncrona: el orden de envío es el del SELECT
      const results = await Promise.all(
        rows.map((row) =>
          this.rabbitmqService.publishEvent(
            row.event_type,
            { eventId: row.id, ...row.payload },
            row.correlation_id ?? undefined,
          ),
        ),
      );
      const confirmed = rows.filter((_, i) => results[i]).map((r) => r.id);
      const failed = rows.filter((_, i) => !results[i]).map((r) => r.id);

      if (confirmed.length > 0) {
        await qr.query(
          `UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])`,
          [confirmed],
        );
      }
      if (failed.length > 0) {
        await qr.query(
          `UPDATE outbox_events SET attempts = attempts + 1, last_error = $2 WHERE id = ANY($1::uuid[])`,
          [failed, 'broker no confirmó (caído, nack o timeout)'],
        );
      }
      await qr.commitTransaction();
      published = confirmed.length;
      full = rows.length === this.batchSize && failed.length === 0;

      const [{ pending }] = await qr.query(
        `SELECT count(*)::int AS pending FROM outbox_events WHERE published_at IS NULL`,
      );
      this.metricsService.setOutboxPending(pending);
      if (published > 0) {
        this.logger.log(`[OUTBOX] ${published} eventos publicados, ${pending} pendientes`);
      }
    } catch (error) {
      // Si la BD cortó la conexión, el ROLLBACK también falla: no debe escaparse como rechazo
      if (qr.isTransactionActive) await qr.rollbackTransaction().catch(() => undefined);
      this.logger.error(`[OUTBOX] Error en el relay: ${error.message}`, error.stack);
      full = false;
    } finally {
      await qr.release().catch(() => undefined);
      this.running = false;
    }
    return { published, full };
  }
}
