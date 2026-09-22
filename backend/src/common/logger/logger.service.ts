import { Injectable, LoggerService as INestLoggerService } from '@nestjs/common';
import * as winston from 'winston';

@Injectable()
export class CustomLoggerService implements INestLoggerService {
  private logger: winston.Logger;

  constructor() {
    // Producción: una línea JSON por evento (timestamp ISO-8601 UTC, correlationId como campo) para Loki/ELK.
    // Desarrollo: formato legible.
    const json = process.env.LOG_FORMAT
      ? process.env.LOG_FORMAT === 'json'
      : process.env.NODE_ENV === 'production';

    const pretty = winston.format.printf(({ timestamp, level, message, correlationId, service, stack, environment, ...meta }) => {
      const metaString = Object.keys(meta).length ? JSON.stringify(meta) : '';
      const corr = correlationId ? `[CorrID: ${correlationId}]` : '';
      return `[${timestamp}] [${level.toUpperCase()}] [${service}] ${corr} ${message} ${metaString} ${stack ? '\n' + stack : ''}`;
    });

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      defaultMeta: {
        service: 'smartbancs-backend',
        environment: process.env.NODE_ENV || 'development',
      },
      format: json
        ? winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json())
        : winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            winston.format.errors({ stack: true }),
            pretty,
          ),
      transports: [new winston.transports.Console()],
    });
  }

  log(message: string, context?: any) {
    this.logger.info(message, this.formatContext(context));
  }

  error(message: string, trace?: string, context?: any) {
    this.logger.error(message, { ...(trace ? { stack: trace } : {}), ...this.formatContext(context) });
  }

  warn(message: string, context?: any) {
    this.logger.warn(message, this.formatContext(context));
  }

  debug(message: string, context?: any) {
    this.logger.debug(message, this.formatContext(context));
  }

  verbose(message: string, context?: any) {
    this.logger.verbose(message, this.formatContext(context));
  }

  private formatContext(context?: any): Record<string, any> {
    if (typeof context === 'string') {
      return { context };
    }
    return context || {};
  }
}
