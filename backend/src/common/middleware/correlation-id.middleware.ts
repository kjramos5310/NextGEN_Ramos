import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Mismo límite que transactions.correlation_id VARCHAR(64); solo caracteres seguros para logs y headers. */
const VALID_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** Devuelve el id del cliente si es válido; si falta o no cumple el formato, genera uno nuevo. */
export function normalizeCorrelationId(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (VALID_CORRELATION_ID.test(trimmed)) return trimmed;
  }
  return uuidv4();
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = normalizeCorrelationId(req.headers[CORRELATION_ID_HEADER]);

    req.headers[CORRELATION_ID_HEADER] = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    (req as any).correlationId = correlationId;

    next();
  }
}
