import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './entities/outbox-event.entity';
import { OutboxRelayService } from './outbox-relay.service';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent])],
  providers: [OutboxRelayService, CustomLoggerService],
  exports: [OutboxRelayService],
})
export class OutboxModule {}
