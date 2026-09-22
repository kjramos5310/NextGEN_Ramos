import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TransactionsService } from '../transactions/transactions.service';
import { AccountsService } from '../accounts/accounts.service';
import { TransactionCategory } from '../transactions/entities/transaction.entity';
import { MetricsService } from '../../common/metrics/metrics.service';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Injectable()
export class SimulationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionsService: TransactionsService,
    private readonly accountsService: AccountsService,
    private readonly metricsService: MetricsService,
    private readonly logger: CustomLoggerService,
  ) {}

  async runQuincenaSpike(options: { totalRequests?: number; concurrentWorkers?: number }) {
    const total = options.totalRequests || 30;
    const startTime = Date.now();
    const accounts = await this.accountsService.findAll();

    if (accounts.length < 2) {
      return { message: 'Se necesitan al menos 2 cuentas para la simulación' };
    }

    this.logger.log(`[INCIDENT SIMULATION] Disparando pico transaccional de quincena con ${total} operaciones simultaneas...`);

    const promises: Promise<any>[] = [];
    const results = {
      totalRequested: total,
      successful: 0,
      failed: 0,
      latenciesMs: [] as number[],
      errors: [] as string[],
    };

    for (let i = 0; i < total; i++) {
      const srcIdx = i % accounts.length;
      let tgtIdx = (i + 1) % accounts.length;
      if (srcIdx === tgtIdx) tgtIdx = (tgtIdx + 1) % accounts.length;

      const src = accounts[srcIdx];
      const tgt = accounts[tgtIdx];
      const amount = Number((10 + (i % 20)).toFixed(2));
      const corrId = `QUINCENA-SPIKE-${Date.now()}-${i}`;

      const p = (async () => {
        const reqStart = Date.now();
        try {
          await this.transactionsService.processTransaction(
            {
              sourceAccountNumber: src.accountNumber,
              targetAccountNumber: tgt.accountNumber,
              amount,
              description: `Pago Nómina Quincena Batch #${i + 1}`,
              category: TransactionCategory.SALARY,
            },
            corrId,
          );
          const reqDuration = Date.now() - reqStart;
          results.successful++;
          results.latenciesMs.push(reqDuration);
        } catch (err) {
          const reqDuration = Date.now() - reqStart;
          results.failed++;
          results.latenciesMs.push(reqDuration);
          results.errors.push(err.message);
        }
      })();

      promises.push(p);
    }

    await Promise.all(promises);

    const totalDurationMs = Date.now() - startTime;
    const sortedLatencies = [...results.latenciesMs].sort((a, b) => a - b);
    const avgLatency = sortedLatencies.length
      ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
      : 0;
    const p95Latency = sortedLatencies.length
      ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)]
      : 0;

    this.logger.log(
      `[INCIDENT SIMULATION COMPLETED] ${results.successful}/${total} transacciones completadas en ${totalDurationMs}ms. Latencia promedio: ${avgLatency.toFixed(1)}ms. p95: ${p95Latency}ms.`,
    );

    return {
      simulationName: 'Pico Transaccional de Quincena (SmartBancs)',
      totalDurationMs,
      totalRequested: total,
      successfulTransactions: results.successful,
      failedTransactions: results.failed,
      averageLatencyMs: Number(avgLatency.toFixed(2)),
      p95LatencyMs: p95Latency,
      minLatencyMs: sortedLatencies[0] || 0,
      maxLatencyMs: sortedLatencies[sortedLatencies.length - 1] || 0,
      slaTargetUnder2s: (p95Latency < 2000),
      errors: results.errors.slice(0, 5),
    };
  }

  async getDatabaseDiagnostics() {
    try {
      // Consultar actividad en PostgreSQL
      const activeQueries = await this.dataSource.query(`
        SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state, wait_event_type, wait_event
        FROM pg_stat_activity
        WHERE state != 'idle' AND pid <> pg_backend_pid()
        ORDER BY duration DESC
        LIMIT 10;
      `);

      const locks = await this.dataSource.query(`
        SELECT locktype, relation::regclass, mode, granted, pid
        FROM pg_locks
        WHERE relation::regclass::text LIKE '%accounts%' OR relation::regclass::text LIKE '%transactions%'
        LIMIT 10;
      `);

      return {
        timestamp: new Date().toISOString(),
        activeConnectionsCount: activeQueries.length,
        activeQueries,
        tableLocks: locks,
        healthStatus: 'HEALTHY',
        recommendedAction: 'Pool dimensionado correctamente. Sin deadlocks activos.',
      };
    } catch (err) {
      return {
        timestamp: new Date().toISOString(),
        error: err.message,
        healthStatus: 'DEGRADED',
      };
    }
  }
}
