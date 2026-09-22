import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountStatus } from './entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly logger: CustomLoggerService,
  ) {}

  async findAll(): Promise<Account[]> {
    return this.accountRepository.find({
      order: { accountNumber: 'ASC' },
    });
  }

  async findByAccountNumber(accountNumber: string): Promise<Account> {
    const account = await this.accountRepository.findOne({
      where: { accountNumber },
    });

    if (!account) {
      throw new NotFoundException(`Cuenta bancaria #${accountNumber} no encontrada`);
    }

    return account;
  }

  async findById(id: string): Promise<Account> {
    const account = await this.accountRepository.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException(`Cuenta con ID ${id} no encontrada`);
    }
    return account;
  }

  async create(createAccountDto: CreateAccountDto): Promise<Account> {
    const existing = await this.accountRepository.findOne({
      where: { accountNumber: createAccountDto.accountNumber },
    });

    if (existing) {
      throw new ConflictException(`La cuenta #${createAccountDto.accountNumber} ya existe`);
    }

    const account = this.accountRepository.create({
      ...createAccountDto,
      balance: createAccountDto.balance || 0,
      status: createAccountDto.status || AccountStatus.ACTIVE,
    });

    const saved = await this.accountRepository.save(account);
    this.logger.log(`Account created successfully: ${saved.accountNumber} for ${saved.accountHolder}`);
    return saved;
  }

  async getBalance(accountNumber: string): Promise<{ accountNumber: string; balance: number; currency: string; holder: string }> {
    const account = await this.findByAccountNumber(accountNumber);
    return {
      accountNumber: account.accountNumber,
      balance: Number(account.balance),
      currency: account.currency,
      holder: account.accountHolder,
    };
  }
}
