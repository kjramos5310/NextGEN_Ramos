import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountStatus, AccountType } from '../../modules/accounts/entities/account.entity';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly logger: CustomLoggerService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedInitialAccounts();
  }

  private async seedInitialAccounts() {
    const count = await this.accountRepository.count();
    if (count > 0) {
      this.logger.log(`Database already has ${count} accounts. Skipping initial seed.`);
      return;
    }

    this.logger.log('Seeding initial banking accounts for SmartBancs...');

    const initialAccounts = [
      {
        accountNumber: '1000000001',
        accountHolder: 'Carlos Andrés Mendoza',
        clientId: 'CLI-84920',
        type: AccountType.CHECKING,
        balance: 15450.0,
        currency: 'USD',
        status: AccountStatus.ACTIVE,
      },
      {
        accountNumber: '1000000002',
        accountHolder: 'Valeria Sofía Gómez',
        clientId: 'CLI-73819',
        type: AccountType.SAVINGS,
        balance: 8320.5,
        currency: 'USD',
        status: AccountStatus.ACTIVE,
      },
      {
        accountNumber: '1000000003',
        accountHolder: 'Empresas & Retail S.A.',
        clientId: 'CLI-99201',
        type: AccountType.CHECKING,
        balance: 145000.0,
        currency: 'USD',
        status: AccountStatus.ACTIVE,
      },
      {
        accountNumber: '1000000004',
        accountHolder: 'Mateo Alejandro Torres',
        clientId: 'CLI-55412',
        type: AccountType.SAVINGS,
        balance: 3200.0,
        currency: 'USD',
        status: AccountStatus.ACTIVE,
      },
      {
        accountNumber: '1000000005',
        accountHolder: 'Distribuidora Global Tech',
        clientId: 'CLI-66190',
        type: AccountType.INVESTMENT,
        balance: 290000.0,
        currency: 'USD',
        status: AccountStatus.ACTIVE,
      },
    ];

    for (const accData of initialAccounts) {
      const acc = this.accountRepository.create(accData);
      await this.accountRepository.save(acc);
    }

    this.logger.log(`Successfully seeded ${initialAccounts.length} banking accounts.`);
  }
}
