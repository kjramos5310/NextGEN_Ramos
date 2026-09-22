import { BadRequestException, Controller, Get, Post, Body, Param, Req, Query } from '@nestjs/common';
import { Request } from 'express';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Controller('api/v1/transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  async create(
    @Body() createTransactionDto: CreateTransactionDto,
    @Req() req: Request,
  ) {
    const correlationId = (req.headers['x-correlation-id'] as string) || 'GEN-' + Date.now();
    // Idempotency-Key (G2): el cliente la genera una vez por intento lógico de transferencia
    const idempotencyKey = (req.headers['idempotency-key'] as string | undefined)?.trim();
    if (idempotencyKey && idempotencyKey.length > 64) {
      throw new BadRequestException('Idempotency-Key no puede superar 64 caracteres');
    }
    return this.transactionsService.processTransaction(createTransactionDto, correlationId, idempotencyKey || undefined);
  }

  @Get()
  async findAll(@Query('limit') limit?: number) {
    return this.transactionsService.findAll(limit ? Number(limit) : 50);
  }

  @Get('account/:accountNumber')
  async findByAccount(
    @Param('accountNumber') accountNumber: string,
    @Query('limit') limit?: number,
  ) {
    return this.transactionsService.findByAccount(accountNumber, limit ? Number(limit) : 20);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.transactionsService.findById(id);
  }
}
