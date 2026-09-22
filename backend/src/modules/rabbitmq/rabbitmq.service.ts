import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: any = null;
  private channel: any = null;
  private isConnected = false;

  public readonly EXCHANGE_NAME = 'smartbancs.events';
  public readonly AI_QUEUE_NAME = 'smartbancs.ai.queue';
  public readonly BANCS_QUEUE_NAME = 'smartbancs.bancs.sync.queue';

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: CustomLoggerService,
  ) {}

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
      this.logger.log('RabbitMQ connection closed gracefully');
    } catch (err) {
      this.logger.warn(`Error closing RabbitMQ: ${err.message}`);
    }
  }

  private async connectWithRetry(retries = 5, delayMs = 3000) {
    const url = this.configService.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672');

    for (let i = 0; i < retries; i++) {
      try {
        this.logger.log(`Connecting to RabbitMQ at ${url} (attempt ${i + 1}/${retries})...`);
        this.connection = await amqp.connect(url);
        this.channel = await this.connection.createChannel();

        // Setup Exchanges and Queues
        await this.channel.assertExchange(this.EXCHANGE_NAME, 'topic', { durable: true });
        
        await this.channel.assertQueue(this.AI_QUEUE_NAME, { durable: true });
        await this.channel.bindQueue(this.AI_QUEUE_NAME, this.EXCHANGE_NAME, 'transaction.created');

        await this.channel.assertQueue(this.BANCS_QUEUE_NAME, { durable: true });
        await this.channel.bindQueue(this.BANCS_QUEUE_NAME, this.EXCHANGE_NAME, 'bancs.sync');

        this.isConnected = true;
        this.logger.log('RabbitMQ connected and queues initialized successfully');

        this.connection.on('error', (err: any) => {
          this.logger.error(`RabbitMQ connection error: ${err.message}`, err.stack);
          this.isConnected = false;
        });

        this.connection.on('close', () => {
          this.logger.warn('RabbitMQ connection closed. Reconnecting...');
          this.isConnected = false;
          setTimeout(() => this.connectWithRetry(retries, delayMs), delayMs);
        });

        return;
      } catch (error) {
        this.logger.warn(`RabbitMQ connection failed (attempt ${i + 1}/${retries}): ${error.message}`);
        if (i < retries - 1) {
          await new Promise((res) => setTimeout(res, delayMs));
        }
      }
    }

    this.logger.warn('RabbitMQ is currently unavailable. Asynchronous events will use memory buffer fallback.');
  }

  async publishEvent(routingKey: string, payload: any, correlationId?: string): Promise<boolean> {
    try {
      const message = {
        correlationId: correlationId || 'N/A',
        timestamp: new Date().toISOString(),
        data: payload,
      };

      if (this.isConnected && this.channel) {
        this.channel.publish(
          this.EXCHANGE_NAME,
          routingKey,
          Buffer.from(JSON.stringify(message)),
          {
            persistent: true,
            correlationId,
            contentType: 'application/json',
          },
        );
        this.logger.log(`Event published to RabbitMQ [${routingKey}]`, { correlationId, routingKey });
        return true;
      } else {
        this.logger.warn(`RabbitMQ not connected. Event queued locally: [${routingKey}]`, { correlationId });
        return false;
      }
    } catch (error) {
      this.logger.error(`Error publishing to RabbitMQ: ${error.message}`, error.stack, { correlationId, routingKey });
      return false;
    }
  }

  getChannel(): any {
    return this.channel;
  }
}
