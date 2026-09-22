import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { CustomLoggerService } from '../../common/logger/logger.service';

/**
 * Conexión a RabbitMQ con publisher confirms y reconexión indefinida.
 *
 * - Canal de confirmación: publishEvent resuelve true solo cuando el broker confirma (ack);
 *   false ante nack, error o timeout. El relay del outbox marca published_at solo con ack.
 * - Reconexión: backoff exponencial con tope (30 s por defecto), sin límite de intentos,
 *   también tras un 'close' de la conexión o del canal. Un solo temporizador a la vez.
 */
@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.ConfirmChannel | null = null;
  private isConnected = false;
  private connecting = false;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;

  public readonly EXCHANGE_NAME = 'smartbancs.events';
  public readonly AI_QUEUE_NAME = 'smartbancs.ai.queue';
  public readonly BANCS_QUEUE_NAME = 'smartbancs.bancs.sync.queue';
  // Dead-letter de la cola de IA (contrato compartido con ai-service)
  public readonly DLX_NAME = 'smartbancs.dlx';
  public readonly AI_DLQ_NAME = 'smartbancs.ai.dlq';

  private readonly url: string;
  private readonly confirmTimeoutMs: number;
  private readonly reconnectMaxDelayMs: number;

  constructor(
    configService: ConfigService,
    private readonly logger: CustomLoggerService,
  ) {
    this.url = configService.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672');
    this.confirmTimeoutMs = Number(configService.get('RABBITMQ_CONFIRM_TIMEOUT_MS', 5000));
    this.reconnectMaxDelayMs = Number(configService.get('RABBITMQ_RECONNECT_MAX_DELAY_MS', 30000));
  }

  async onModuleInit() {
    // Primer intento en el arranque; si falla, sigue en segundo plano sin bloquear la API
    await this.connect();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const conn = this.connection;
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
    try {
      if (conn) await conn.close();
      this.logger.log('RabbitMQ connection closed gracefully');
    } catch (err) {
      this.logger.warn(`Error closing RabbitMQ: ${err.message}`);
    }
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.stopped || this.isConnected) return;
    this.connecting = true;
    let conn: amqp.ChannelModel | null = null;
    try {
      this.logger.log(`Connecting to RabbitMQ (attempt ${this.reconnectAttempt + 1})...`);
      conn = await amqp.connect(this.url);
      conn.on('error', (err: any) => this.logger.error(`RabbitMQ connection error: ${err.message}`, err.stack));
      conn.on('close', () => {
        if (this.connection !== conn) return; // conexión vieja o cierre intencional
        this.handleDisconnect('connection closed');
      });

      const ch = await conn.createConfirmChannel();
      ch.on('error', (err: any) => this.logger.error(`RabbitMQ channel error: ${err.message}`, err.stack));
      ch.on('close', () => {
        if (this.channel !== ch) return;
        // Se cierra toda la conexión y se reconecta desde cero (un solo camino de recuperación)
        this.handleDisconnect('channel closed');
      });

      await this.assertTopology(ch);

      this.connection = conn;
      this.channel = ch;
      this.isConnected = true;
      this.reconnectAttempt = 0;
      this.logger.log('RabbitMQ connected (confirm channel) and queues initialized successfully');
    } catch (error) {
      this.logger.warn(`RabbitMQ connection failed: ${error.message}. Events remain in outbox_events until the broker recovers.`);
      if (conn) await conn.close().catch(() => undefined);
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private async assertTopology(ch: amqp.ConfirmChannel) {
    await ch.assertExchange(this.EXCHANGE_NAME, 'topic', { durable: true });

    await ch.assertExchange(this.DLX_NAME, 'direct', { durable: true });
    await ch.assertQueue(this.AI_DLQ_NAME, { durable: true });
    await ch.bindQueue(this.AI_DLQ_NAME, this.DLX_NAME, this.AI_DLQ_NAME);

    // Los mensajes que el ai-service rechaza (nack sin requeue) terminan en smartbancs.ai.dlq
    await ch.assertQueue(this.AI_QUEUE_NAME, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.DLX_NAME,
        'x-dead-letter-routing-key': this.AI_DLQ_NAME,
      },
    });
    await ch.bindQueue(this.AI_QUEUE_NAME, this.EXCHANGE_NAME, 'transaction.created');

    await ch.assertQueue(this.BANCS_QUEUE_NAME, { durable: true });
    await ch.bindQueue(this.BANCS_QUEUE_NAME, this.EXCHANGE_NAME, 'bancs.sync');
  }

  private handleDisconnect(reason: string) {
    const conn = this.connection;
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
    if (this.stopped) return;
    this.logger.warn(`RabbitMQ ${reason}. Reconnecting...`);
    if (conn) conn.close().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, this.reconnectMaxDelayMs);
    this.reconnectAttempt++;
    this.logger.warn(`RabbitMQ reconnect in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /**
   * Publica y espera la confirmación del broker. true = ack; false = nack, error, timeout o sin conexión.
   * channel.publish se invoca de forma síncrona, así se conserva el orden de llamada dentro de un lote.
   */
  publishEvent(routingKey: string, payload: any, correlationId?: string): Promise<boolean> {
    const ch = this.channel;
    if (!this.isConnected || !ch) {
      this.logger.warn(`RabbitMQ not connected. Event [${routingKey}] not published; it stays pending in outbox_events`, { correlationId });
      return Promise.resolve(false);
    }

    const message = {
      correlationId: correlationId || 'N/A',
      timestamp: new Date().toISOString(),
      data: payload,
    };

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean, reason?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) {
          this.logger.log(`Event confirmed by RabbitMQ [${routingKey}]`, { correlationId, routingKey });
        } else {
          this.logger.warn(`Event [${routingKey}] not confirmed by RabbitMQ: ${reason}`, { correlationId, routingKey });
        }
        resolve(ok);
      };
      const timer = setTimeout(() => done(false, `timeout ${this.confirmTimeoutMs}ms`), this.confirmTimeoutMs);

      try {
        ch.publish(
          this.EXCHANGE_NAME,
          routingKey,
          Buffer.from(JSON.stringify(message)),
          {
            persistent: true,
            correlationId,
            messageId: payload?.eventId,
            contentType: 'application/json',
          },
          (err: any) => done(!err, err ? `nack: ${err?.message ?? err}` : undefined),
        );
      } catch (error) {
        done(false, `error: ${error.message}`);
      }
    });
  }

  getChannel(): any {
    return this.channel;
  }
}
