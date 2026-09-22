import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { Account } from './modules/accounts/entities/account.entity';
import { Transaction } from './modules/transactions/entities/transaction.entity';
import { AIRecommendation } from './modules/recommendations/entities/recommendation.entity';
import { OutboxEvent } from './modules/outbox/entities/outbox-event.entity';
import { OutboxModule } from './modules/outbox/outbox.module';

import { AccountsModule } from './modules/accounts/accounts.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { RabbitMQModule } from './modules/rabbitmq/rabbitmq.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { SimulationModule } from './modules/simulation/simulation.module';

import { CustomLoggerService } from './common/logger/logger.service';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { SeedService } from './database/seeds/seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.development'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgres'),
        database: configService.get<string>('DB_NAME', 'smartbancs_db'),
        entities: [Account, Transaction, AIRecommendation, OutboxEvent],
        // G6: la variable llega como string; 'false' era truthy y TypeORM alteraba el esquema versionado en sql/schema.sql
        synchronize: configService.get<string>('DB_SYNCHRONIZE', 'false') === 'true',
        logging: configService.get<string>('DB_LOGGING', 'false') === 'true',
        extra: {
          max: configService.get<number>('DB_POOL_MAX', 25), // Connection pool sizing
          min: configService.get<number>('DB_POOL_MIN', 5),
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        },
      }),
    }),
    AccountsModule,
    TransactionsModule,
    RecommendationsModule,
    RabbitMQModule,
    MetricsModule,
    SimulationModule,
    OutboxModule,
  ],
  providers: [
    CustomLoggerService,
    SeedService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
