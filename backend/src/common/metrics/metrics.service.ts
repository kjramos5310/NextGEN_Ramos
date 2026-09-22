import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry: client.Registry;

  public readonly httpRequestsTotal: client.Counter<string>;
  public readonly httpRequestDurationSeconds: client.Histogram<string>;
  public readonly transactionCounter: client.Counter<string>;
  public readonly transactionDurationSeconds: client.Histogram<string>;
  public readonly activeDbConnectionsGauge: client.Gauge<string>;
  public readonly deadlocksDetectedCounter: client.Counter<string>;
  public readonly aiRecommendationDurationSeconds: client.Histogram<string>;
  public readonly dbErrorsCounter: client.Counter<string>;
  public readonly transactionRetriesCounter: client.Counter<string>;
  public readonly outboxPendingGauge: client.Gauge<string>;
  public readonly dbPoolWaitingGauge: client.Gauge<string>;

  constructor() {
    this.registry = new client.Registry();
    this.registry.setDefaultLabels({
      app: 'smartbancs-backend',
    });

    client.collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests made to SmartBancs API',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.transactionCounter = new client.Counter({
      name: 'smartbancs_transactions_total',
      help: 'Total financial transactions processed by SmartBancs',
      labelNames: ['status', 'category'],
      registers: [this.registry],
    });

    this.transactionDurationSeconds = new client.Histogram({
      name: 'smartbancs_transaction_duration_seconds',
      help: 'End-to-end execution latency for financial transactions in seconds',
      labelNames: ['status'],
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0],
      registers: [this.registry],
    });

    this.activeDbConnectionsGauge = new client.Gauge({
      name: 'smartbancs_db_active_connections',
      help: 'Number of active connections in the database connection pool',
      registers: [this.registry],
    });

    this.deadlocksDetectedCounter = new client.Counter({
      name: 'smartbancs_deadlocks_detected_total',
      help: 'Deadlocks (40P01) y lock timeouts (55P03) detectados, por SQLSTATE',
      labelNames: ['sqlstate'],
      registers: [this.registry],
    });

    this.aiRecommendationDurationSeconds = new client.Histogram({
      name: 'smartbancs_ai_recommendation_duration_seconds',
      help: 'Latencia de inferencia de la IA reportada por ai-service (metadata.inferenceLatencyMs), en segundos',
      labelNames: ['engine'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.dbErrorsCounter = new client.Counter({
      name: 'smartbancs_db_errors_total',
      help: 'Errores de base de datos por SQLSTATE (57014 = statement_timeout, 55P03 = lock_timeout, 40P01 = deadlock, POOL_TIMEOUT = pool agotado)',
      labelNames: ['sqlstate'],
      registers: [this.registry],
    });

    this.transactionRetriesCounter = new client.Counter({
      name: 'smartbancs_transaction_retries_total',
      help: 'Reintentos automáticos de transacciones por conflicto de concurrencia',
      labelNames: ['sqlstate'],
      registers: [this.registry],
    });

    this.outboxPendingGauge = new client.Gauge({
      name: 'smartbancs_outbox_pending_events',
      help: 'Eventos en outbox_events aún no publicados en RabbitMQ (backlog hacia IA y Bancs)',
      registers: [this.registry],
    });

    this.dbPoolWaitingGauge = new client.Gauge({
      name: 'smartbancs_db_pool_waiting_requests',
      help: 'Peticiones esperando una conexión libre del pool (> 0 sostenido = pool agotado)',
      registers: [this.registry],
    });
  }

  /** route debe ser el patrón de la ruta (p. ej. /api/v1/transactions/:id), nunca la URL con IDs. */
  recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number) {
    const cleanRoute = route.split('?')[0];
    this.httpRequestsTotal.inc({ method, route: cleanRoute, status_code: statusCode.toString() });
    this.httpRequestDurationSeconds.observe({ method, route: cleanRoute, status_code: statusCode.toString() }, durationSeconds);
  }

  recordTransaction(status: string, category: string, durationSeconds: number) {
    this.transactionCounter.inc({ status, category });
    this.transactionDurationSeconds.observe({ status }, durationSeconds);
  }

  /**
   * Clasifica errores de PostgreSQL por SQLSTATE (G3), no por el texto del mensaje.
   * 40P01 deadlock_detected · 55P03 lock_not_available (lock_timeout)
   * 57014 query_canceled (statement_timeout) · 40001 serialization_failure
   */
  recordDbError(sqlstate: string) {
    this.dbErrorsCounter.inc({ sqlstate });
    if (sqlstate === '40P01' || sqlstate === '55P03') {
      this.deadlocksDetectedCounter.inc({ sqlstate });
    }
  }

  recordAiRecommendationLatency(seconds: number, engine = 'unknown') {
    this.aiRecommendationDurationSeconds.observe({ engine }, seconds);
  }

  recordTransactionRetry(sqlstate: string) {
    this.transactionRetriesCounter.inc({ sqlstate });
  }

  setPoolStats(active: number, waiting: number) {
    this.activeDbConnectionsGauge.set(active);
    this.dbPoolWaitingGauge.set(waiting);
  }

  setOutboxPending(count: number) {
    this.outboxPendingGauge.set(count);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
