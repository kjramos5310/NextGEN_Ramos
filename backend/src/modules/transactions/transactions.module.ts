import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from './entities/transaction.entity';
import { Account } from '../accounts/entities/account.entity';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction, Account])],
  controllers: [TransactionsController],
  providers: [TransactionsService, CustomLoggerService],
  exports: [TransactionsService, TypeOrmModule],
})
export class TransactionsModule {}
