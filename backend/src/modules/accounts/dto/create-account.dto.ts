import { IsString, IsNotEmpty, IsEnum, IsNumber, Min, IsOptional } from 'class-validator';
import { AccountType, AccountStatus } from '../entities/account.entity';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @IsString()
  @IsNotEmpty()
  accountHolder: string;

  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsEnum(AccountType)
  @IsOptional()
  type?: AccountType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  balance?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsEnum(AccountStatus)
  @IsOptional()
  status?: AccountStatus;
}
