import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account])],
  controllers: [AccountsController],
  providers: [AccountsService, CustomLoggerService],
  exports: [AccountsService, TypeOrmModule],
})
export class AccountsModule {}
