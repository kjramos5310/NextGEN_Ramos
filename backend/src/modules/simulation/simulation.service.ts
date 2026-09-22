import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TransactionsService } from '../transactions/transactions.service';
import { AccountsService } from '../accounts/accounts.service';
import { TransactionCategory } from '../transactions/entities/transaction.entity';
import { MetricsService } from '../../common/metrics/metrics.service';
import { CustomLoggerService } from '../../common/logger/logger.service';

const QUERY_TEXT_LIMIT = 200;
const IDLE_IN_TX_THRESHOLD_S = 5;
const CRITICAL_BLOCKED = 10;
const CRITICAL_POOL_WAITING = 10;

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
    const total = Math.min(options.totalRequests || 30, 500);
    const workers = Math.min(options.concurrentWorkers || total, total);
    const startTime = Date.now();
    const accounts = await this.accountsService.findAll();

    if (accounts.length < 2) {
      return { message: 'Se necesitan al menos 2 cuentas para la simulación' };
    }

    this.logger.log(`[INCIDENT SIMULATION] Disparando pico transaccional de quincena con ${total} operaciones simultaneas...`);

    const tasks: Array<() => Promise<void>> = [];
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

      tasks.push(async () => {
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
      });
    }

    // concurrentWorkers peticiones en vuelo como máximo
    let next = 0;
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (next < tasks.length) await tasks[next++]();
      }),
    );

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
      concurrentWorkers: workers,
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

  /**
   * Diagnóstico de contención (R3.5a/c): quién bloquea a quién con pg_blocking_pids, sesiones
   * "idle in transaction" y estado del pool. Solo sesiones de la base de la app; texto de query acotado.
   */
  async getDatabaseDiagnostics() {
    try {
      const activeQueries = await this.dataSource.query(`
        SELECT pid, state, wait_event_type, wait_event,
               round(extract(epoch FROM now() - xact_start)::numeric, 3)  AS xact_seconds,
               round(extract(epoch FROM now() - query_start)::numeric, 3) AS query_seconds,
               left(query, ${QUERY_TEXT_LIMIT}) AS query
          FROM pg_stat_activity
         WHERE datname = current_database()
           AND pid <> pg_backend_pid()
           AND state IS DISTINCT FROM 'idle'
         ORDER BY xact_start NULLS LAST
         LIMIT 20
      `);

      const blockingChains = await this.dataSource.query(`
        SELECT blocked.pid  AS blocked_pid,
               left(blocked.query, ${QUERY_TEXT_LIMIT})  AS blocked_query,
               round(extract(epoch FROM now() - blocked.query_start)::numeric, 3) AS waiting_seconds,
               blocking.pid AS blocking_pid,
               blocking.state AS blocking_state,
               left(blocking.query, ${QUERY_TEXT_LIMIT}) AS blocking_query,
               round(extract(epoch FROM now() - blocking.xact_start)::numeric, 3) AS blocking_xact_seconds
          FROM pg_stat_activity blocked
          JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
          JOIN pg_stat_activity blocking ON blocking.pid = b.pid
         WHERE blocked.datname = current_database()
         ORDER BY waiting_seconds DESC NULLS LAST
         LIMIT 50
      `);

      const blockedPids = new Set(blockingChains.map((r: any) => r.blocked_pid));
      const idleInTx = activeQueries.filter(
        (q: any) => q.state === 'idle in transaction' && Number(q.xact_seconds) > IDLE_IN_TX_THRESHOLD_S,
      );
      const pool = (this.dataSource.driver as any)?.master;
      const poolStats = pool
        ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
        : null;

      const { healthStatus, recommendedAction } = this.assessHealth(
        blockedPids.size,
        idleInTx.length,
        poolStats?.waiting ?? 0,
        blockingChains,
      );

      return {
        timestamp: new Date().toISOString(),
        activeConnectionsCount: activeQueries.length,
        blockedSessionsCount: blockedPids.size,
        idleInTransactionCount: idleInTx.length,
        pool: poolStats,
        blockingChains,
        activeQueries,
        healthStatus,
        recommendedAction,
      };
    } catch (err) {
      return {
        timestamp: new Date().toISOString(),
        error: err.message,
        healthStatus: 'UNKNOWN',
        recommendedAction: 'No se pudo consultar pg_stat_activity: revisar conectividad con PostgreSQL.',
      };
    }
  }

  private assessHealth(blocked: number, idleInTx: number, poolWaiting: number, chains: any[]) {
    if (blocked === 0 && idleInTx === 0 && poolWaiting === 0) {
      return { healthStatus: 'HEALTHY', recommendedAction: 'Sin sesiones bloqueadas ni espera en el pool.' };
    }
    const actions: string[] = [];
    if (blocked > 0) {
      const heads = [...new Set(chains.map((c) => c.blocking_pid))].slice(0, 5).join(', ');
      actions.push(`${blocked} sesión(es) esperando locks; sesiones que bloquean: ${heads}. Si una está "idle in transaction", evaluar pg_terminate_backend(<pid>).`);
    }
    if (idleInTx > 0) actions.push(`${idleInTx} sesión(es) idle in transaction > ${IDLE_IN_TX_THRESHOLD_S}s: retienen locks y conexiones.`);
    if (poolWaiting > 0) actions.push(`${poolWaiting} petición(es) esperando conexión del pool: pool saturado.`);
    const critical = blocked >= CRITICAL_BLOCKED || poolWaiting >= CRITICAL_POOL_WAITING;
    return { healthStatus: critical ? 'CRITICAL' : 'DEGRADED', recommendedAction: actions.join(' ') };
  }
}
