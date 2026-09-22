import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CustomLoggerService } from '../logger/logger.service';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: CustomLoggerService,
    private readonly metricsService: MetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const correlationId = req.headers['x-correlation-id'] || 'N/A';
    const method = req.method;
    const url = req.originalUrl || req.url;
    // Etiqueta de métrica con el patrón de ruta (/api/v1/transactions/:id), no la URL con IDs:
    // evita una serie nueva por cada id (cardinalidad sin límite)
    const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched';
    const recordMetrics = route !== '/metrics';
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = res.statusCode;

          if (recordMetrics) this.metricsService.recordHttpRequest(method, route, statusCode, duration / 1000);

          this.logger.log(`HTTP ${method} ${url} - Status: ${statusCode} - Latency: ${duration}ms`, {
            correlationId,
            method,
            url,
            route,
            statusCode,
            durationMs: duration,
          });
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const statusCode = error.status || 500;

          if (recordMetrics) this.metricsService.recordHttpRequest(method, route, statusCode, duration / 1000);

          this.logger.error(
            `HTTP ${method} ${url} FAILED - Status: ${statusCode} - Latency: ${duration}ms - Error: ${error.message}`,
            error.stack,
            {
              correlationId,
              method,
              url,
              statusCode,
              durationMs: duration,
            },
          );
        },
      }),
    );
  }
}
