import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from './entities/transaction.entity';
import { Account } from '../accounts/entities/account.entity';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction, Account, OutboxEvent])],
  controllers: [TransactionsController],
  providers: [TransactionsService, CustomLoggerService],
  exports: [TransactionsService, TypeOrmModule],
})
export class TransactionsModule {}
