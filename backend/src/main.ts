import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CustomLoggerService } from './common/logger/logger.service';
import { buildValidationPipe } from './common/validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(CustomLoggerService);
  app.useLogger(logger);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    // Idempotency-Key: el frontend (:3000) lo envía en cada transferencia; sin él el preflight bloquea el POST
    allowedHeaders: 'Content-Type, Accept, Authorization, x-correlation-id, Idempotency-Key',
    exposedHeaders: 'x-correlation-id',
  });

  app.useGlobalPipes(buildValidationPipe());

  app.enableShutdownHooks();

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`🚀 SmartBancs Backend Core running on: http://localhost:${port}`);
  logger.log(`📊 Prometheus Metrics available at: http://localhost:${port}/metrics`);
}

bootstrap();
