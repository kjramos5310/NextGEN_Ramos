import { Injectable, LoggerService as INestLoggerService } from '@nestjs/common';
import * as winston from 'winston';

@Injectable()
export class CustomLoggerService implements INestLoggerService {
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: {
        service: 'smartbancs-backend',
        environment: process.env.NODE_ENV || 'development',
      },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            winston.format.printf(({ timestamp, level, message, correlationId, service, stack, ...meta }) => {
              const metaString = Object.keys(meta).length ? JSON.stringify(meta) : '';
              const corr = correlationId ? `[CorrID: ${correlationId}]` : '';
              return `[${timestamp}] [${level.toUpperCase()}] [${service}] ${corr} ${message} ${metaString} ${stack ? '\n' + stack : ''}`;
            }),
          ),
        }),
      ],
    });
  }

  log(message: string, context?: any) {
    this.logger.info(message, this.formatContext(context));
  }

  error(message: string, trace?: string, context?: any) {
    this.logger.error(message, { stack: trace, ...this.formatContext(context) });
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
