import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { CreateTransactionDto } from './create-transaction.dto';
import { buildValidationPipe } from '../../../common/validation';
import { toAmountString, toCents } from '../transactions.service';

// Misma configuración que main.ts: un DTO inválido debe ser 400, nunca 500
const pipe = buildValidationPipe();
const meta: ArgumentMetadata = { type: 'body', metatype: CreateTransactionDto };
const base = { sourceAccountNumber: '1000000001', targetAccountNumber: '1000000002' };

describe('CreateTransactionDto (validación de montos, moneda y descripción)', () => {
  it.each([
    ['3 decimales', { amount: 0.125 }],
    ['3 decimales como string', { amount: '10.005' }],
    ['booleano', { amount: true }],
    ['cero', { amount: 0 }],
    ['negativo', { amount: -5 }],
    ['sobre el máximo', { amount: 1_000_000.01 }],
    ['moneda no soportada', { amount: 10, currency: 'EUR' }],
    ['moneda demasiado larga', { amount: 10, currency: 'EURO' }],
    ['descripción > 255', { amount: 10, description: 'x'.repeat(256) }],
  ])('rechaza con 400: %s', async (_name, extra) => {
    await expect(pipe.transform({ ...base, ...extra }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    [{ amount: 0.01 }],
    [{ amount: 0.1 }],
    [{ amount: '250.50' }],
    [{ amount: 1_000_000, currency: 'USD', description: 'x'.repeat(255) }],
  ])('acepta montos válidos con hasta 2 decimales: %j', async (extra) => {
    const dto = await pipe.transform({ ...base, ...extra }, meta);
    expect(typeof dto.amount).toBe('number');
  });
});

describe('Aritmética de montos en centavos', () => {
  it('0.10 + 0.20 = 0.30 exacto en centavos (en float daría 0.30000000000000004)', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));
    expect(toAmountString(0.1)).toBe('0.10');
    expect(toAmountString(0.29)).toBe('0.29');
    expect(toAmountString(1_000_000)).toBe('1000000.00');
  });
});
