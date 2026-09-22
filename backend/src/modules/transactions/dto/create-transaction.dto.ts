import { IsString, IsNotEmpty, IsNumber, Min, IsEnum, IsOptional } from 'class-validator';
import { TransactionCategory } from '../entities/transaction.entity';

export class CreateTransactionDto {
  @IsString()
  @IsNotEmpty()
  sourceAccountNumber: string;

  @IsString()
  @IsNotEmpty()
  targetAccountNumber: string;

  @IsNumber()
  @Min(0.01, { message: 'El monto mínimo a transferir es 0.01' })
  amount: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(TransactionCategory)
  @IsOptional()
  category?: TransactionCategory;
}
