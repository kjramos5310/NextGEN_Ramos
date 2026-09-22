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
      help: 'Total database deadlocks or lock timeouts detected during high concurrency',
      registers: [this.registry],
    });

    this.aiRecommendationDurationSeconds = new client.Histogram({
      name: 'smartbancs_ai_recommendation_duration_seconds',
      help: 'Latency of AI financial recommendation calculation in seconds',
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1.0],
      registers: [this.registry],
    });
  }

  recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number) {
    const cleanRoute = route.split('?')[0];
    this.httpRequestsTotal.inc({ method, route: cleanRoute, status_code: statusCode.toString() });
    this.httpRequestDurationSeconds.observe({ method, route: cleanRoute, status_code: statusCode.toString() }, durationSeconds);
  }

  recordTransaction(status: string, category: string, durationSeconds: number) {
    this.transactionCounter.inc({ status, category });
    this.transactionDurationSeconds.observe({ status }, durationSeconds);
  }

  recordDeadlock() {
    this.deadlocksDetectedCounter.inc();
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
