import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';

@Controller('api/v1/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  async findAll() {
    return this.accountsService.findAll();
  }

  @Get(':accountNumber')
  async findOne(@Param('accountNumber') accountNumber: string) {
    return this.accountsService.findByAccountNumber(accountNumber);
  }

  @Get(':accountNumber/balance')
  async getBalance(@Param('accountNumber') accountNumber: string) {
    return this.accountsService.getBalance(accountNumber);
  }

  @Post()
  async create(@Body() createAccountDto: CreateAccountDto) {
    return this.accountsService.create(createAccountDto);
  }
}
