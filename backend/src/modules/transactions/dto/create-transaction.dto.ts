import { IsString, IsNotEmpty, IsNumber, Min, Max, IsEnum, IsOptional, IsIn, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { TransactionCategory } from '../entities/transaction.entity';

export const SUPPORTED_CURRENCIES = ['USD'] as const;
export const MAX_TRANSFER_AMOUNT = 1_000_000;

export class CreateTransactionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  sourceAccountNumber: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  targetAccountNumber: string;

  // Montos con máximo 2 decimales (NUMERIC(18,2)): 0.125 se rechaza en vez de redondearse distinto
  // en débito y crédito. Los booleanos no se convierten a 1 por la conversión implícita.
  @Transform(({ obj, value }) => (typeof obj.amount === 'boolean' ? NaN : value))
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'amount debe ser un número con máximo 2 decimales' },
  )
  @Min(0.01, { message: 'El monto mínimo a transferir es 0.01' })
  @Max(MAX_TRANSFER_AMOUNT, { message: `El monto máximo por transferencia es ${MAX_TRANSFER_AMOUNT}` })
  amount: number;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES, { message: `currency debe ser una de: ${SUPPORTED_CURRENCIES.join(', ')}` })
  currency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @IsEnum(TransactionCategory)
  @IsOptional()
  category?: TransactionCategory;
}
