import { Module } from '@nestjs/common';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Module({
  imports: [TransactionsModule, AccountsModule],
  controllers: [SimulationController],
  providers: [SimulationService, CustomLoggerService],
  exports: [SimulationService],
})
export class SimulationModule {}
