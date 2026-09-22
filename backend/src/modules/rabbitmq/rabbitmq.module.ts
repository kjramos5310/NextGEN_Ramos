import { Global, Module } from '@nestjs/common';
import { RabbitMQService } from './rabbitmq.service';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Global()
@Module({
  providers: [RabbitMQService, CustomLoggerService],
  exports: [RabbitMQService],
})
export class RabbitMQModule {}
