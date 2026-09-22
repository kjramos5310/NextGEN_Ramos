/**
 * G4 — Prueba de integración de concurrencia contra un PostgreSQL REAL (R3.1e, R3.5c).
 *
 * Crea una base aislada `smartbancs_test`, aplica sql/schema.sql y ejecuta el
 * TransactionsService real con su lógica de locks, timeouts, reintentos, outbox
 * e idempotencia. No usa mocks de base de datos.
 *
 * Requisito: un PostgreSQL accesible (por ejemplo `docker compose up -d postgres`).
 *   npm run test:int
 * Variables opcionales: TEST_DB_HOST, TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { BadRequestException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Account } from '../src/modules/accounts/entities/account.entity';
import { Transaction } from '../src/modules/transactions/entities/transaction.entity';
import { AIRecommendation } from '../src/modules/recommendations/entities/recommendation.entity';
import { OutboxEvent } from '../src/modules/outbox/entities/outbox-event.entity';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { OutboxRelayService } from '../src/modules/outbox/outbox-relay.service';
import { MetricsService } from '../src/common/metrics/metrics.service';

const DB = {
  host: process.env.TEST_DB_HOST ?? 'localhost',
  port: Number(process.env.TEST_DB_PORT ?? 5432),
  user: process.env.TEST_DB_USER ?? 'postgres',
  password: process.env.TEST_DB_PASSWORD ?? 'postgrespassword',
};
const TEST_DB = 'smartbancs_test';

const silentLogger: any = { log: () => {}, warn: () => {}, error: () => {} };
const config = { get: (_k: string, d: any) => d } as unknown as ConfigService;

let ds: DataSource;
let service: TransactionsService;
let metrics: MetricsService;

async function resetAccounts(balances: Record<string, number>) {
  await ds.query('TRUNCATE outbox_events, transactions, ai_recommendations, accounts');
  for (const [num, balance] of Object.entries(balances)) {
    await ds.query(
      `INSERT INTO accounts (account_number, account_holder, client_id, balance) VALUES ($1, $2, $3, $4)`,
      [num, `Titular ${num}`, `CLI-${num}`, balance],
    );
  }
}

/** Saldos como texto NUMERIC, para comparar sin pasar por float. */
async function balancesText(): Promise<Record<string, string>> {
  const rows = await ds.query('SELECT account_number, balance::text AS balance FROM accounts');
  return Object.fromEntries(rows.map((r: any) => [r.account_number, r.balance]));
}

async function balances(): Promise<Record<string, number>> {
  const rows = await ds.query('SELECT account_number, balance FROM accounts');
  return Object.fromEntries(rows.map((r: any) => [r.account_number, Number(r.balance)]));
}

beforeAll(async () => {
  const admin = new Client({ ...DB, database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const schema = new Client({ ...DB, database: TEST_DB });
  await schema.connect();
  await schema.query(readFileSync(join(__dirname, '..', 'sql', 'schema.sql'), 'utf8'));
  await schema.end();

  ds = new DataSource({
    type: 'postgres',
    host: DB.host,
    port: DB.port,
    username: DB.user,
    password: DB.password,
    database: TEST_DB,
    entities: [Account, Transaction, AIRecommendation, OutboxEvent],
    synchronize: false,
    extra: { max: 20 }, // pool acotado, igual que en producción: fuerza contención real
  });
  await ds.initialize();

  metrics = new MetricsService();
  service = new TransactionsService(ds, ds.getRepository(Transaction), metrics, silentLogger, config);
});

afterAll(async () => {
  await ds?.destroy();
});

describe('Concurrencia transaccional contra PostgreSQL real', () => {
  it('400 transferencias cruzadas en paralelo conservan el dinero total y no dejan saldos negativos', async () => {
    const accounts = ['1000000001', '1000000002', '1000000003', '1000000004'];
    await resetAccounts(Object.fromEntries(accounts.map((a) => [a, 1000])));
    const totalBefore = 4000;

    // Pares en ambos sentidos (A->B y B->A a la vez): el caso clásico de deadlock
    const jobs = Array.from({ length: 400 }, (_, i) => {
      const src = accounts[i % 4];
      const tgt = accounts[(i + 1 + (i % 3)) % 4];
      return service
        .processTransaction({ sourceAccountNumber: src, targetAccountNumber: tgt, amount: 1 + (i % 7) }, `INT-${i}`)
        .then(() => 'ok')
        .catch((e) => (e instanceof BadRequestException ? 'fondos' : `error:${e.message}`));
    });
    const results = await Promise.all(jobs);

    const unexpected = results.filter((r) => r.startsWith('error'));
    expect(unexpected).toEqual([]); // ni deadlocks sin resolver ni timeouts

    const after = await balances();
    const totalAfter = Object.values(after).reduce((a, b) => a + b, 0);
    expect(totalAfter).toBeCloseTo(totalBefore, 2);
    Object.values(after).forEach((b) => expect(b).toBeGreaterThanOrEqual(0));

    const ok = results.filter((r) => r === 'ok').length;
    const [{ count: txCount }] = await ds.query(`SELECT count(*)::int AS count FROM transactions WHERE status = 'COMPLETED'`);
    const [{ count: outboxCount }] = await ds.query(`SELECT count(*)::int AS count FROM outbox_events`);
    expect(txCount).toBe(ok);
    expect(outboxCount).toBe(ok * 2); // un evento para IA y otro para Bancs por transacción confirmada
  });

  it('evita el doble gasto: 50 débitos simultáneos de $10 sobre $100 → exactamente 10 aprobados', async () => {
    await resetAccounts({ '2000000001': 100, '2000000002': 0 });

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        service
          .processTransaction({ sourceAccountNumber: '2000000001', targetAccountNumber: '2000000002', amount: 10 }, `DS-${i}`)
          .then(() => 'ok')
          .catch((e) => (e instanceof BadRequestException ? 'fondos' : `error:${e.message}`)),
      ),
    );

    expect(results.filter((r) => r === 'ok')).toHaveLength(10);
    expect(results.filter((r) => r === 'fondos')).toHaveLength(40);
    const after = await balances();
    expect(after['2000000001']).toBe(0);
    expect(after['2000000002']).toBe(100);

    // Las transferencias rechazadas no dejan eventos: el outbox comparte la transacción
    const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM outbox_events`);
    expect(count).toBe(20);
  });

  it('idempotencia: 20 reintentos concurrentes con la misma Idempotency-Key debitan una sola vez', async () => {
    await resetAccounts({ '3000000001': 500, '3000000002': 0 });

    const txs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        service.processTransaction(
          { sourceAccountNumber: '3000000001', targetAccountNumber: '3000000002', amount: 50 },
          `IDEMP-${i}`,
          'pago-factura-123',
        ),
      ),
    );

    expect(new Set(txs.map((t) => t.id)).size).toBe(1);
    const after = await balances();
    expect(after['3000000001']).toBe(450);
    expect(after['3000000002']).toBe(50);
  });

  it('outbox: si RabbitMQ está caído los eventos quedan pendientes y se publican al recuperarse', async () => {
    await resetAccounts({ '4000000001': 100, '4000000002': 0 });
    await service.processTransaction(
      { sourceAccountNumber: '4000000001', targetAccountNumber: '4000000002', amount: 5 },
      'OUTBOX-1',
    );

    let brokerUp = false;
    const published: string[] = [];
    const rabbit: any = {
      publishEvent: async (routingKey: string) => {
        if (!brokerUp) return false;
        published.push(routingKey);
        return true;
      },
    };
    const relay = new OutboxRelayService(ds, rabbit, metrics, silentLogger, config);

    expect(await relay.flush()).toBe(0); // broker caído: nada se pierde, nada se marca
    const [{ pending }] = await ds.query(`SELECT count(*)::int AS pending FROM outbox_events WHERE published_at IS NULL`);
    expect(pending).toBe(2);

    brokerUp = true;
    expect(await relay.flush()).toBe(2);
    expect(published.sort()).toEqual(['bancs.sync', 'transaction.created']);
    const [{ left }] = await ds.query(`SELECT count(*)::int AS left FROM outbox_events WHERE published_at IS NULL`);
    expect(left).toBe(0);
  });
});

describe('Montos exactos (NUMERIC) e idempotencia estricta', () => {
  it('0.10 + 0.20: el débito y el crédito son exactamente 0.30, sin error de float', async () => {
    await resetAccounts({ '5000000001': 1000, '5000000002': 0 });
    await service.processTransaction({ sourceAccountNumber: '5000000001', targetAccountNumber: '5000000002', amount: 0.1 }, 'CENT-1');
    await service.processTransaction({ sourceAccountNumber: '5000000001', targetAccountNumber: '5000000002', amount: 0.2 }, 'CENT-2');
    expect(await balancesText()).toEqual({ '5000000001': '999.70', '5000000002': '0.30' });

    const [{ moved }] = await ds.query(`SELECT sum(amount)::text AS moved FROM transactions`);
    expect(moved).toBe('0.30');
  });

  it('300 transferencias concurrentes de 0.01/0.10/0.20 conservan el total al centavo', async () => {
    await resetAccounts({ '5100000001': 500.03, '5100000002': 700.07 });
    const amounts = [0.01, 0.1, 0.2];
    await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        service.processTransaction(
          {
            sourceAccountNumber: i % 2 ? '5100000001' : '5100000002',
            targetAccountNumber: i % 2 ? '5100000002' : '5100000001',
            amount: amounts[i % 3],
          },
          `CENT-C-${i}`,
        ),
      ),
    );
    const [{ total }] = await ds.query(`SELECT sum(balance)::text AS total FROM accounts`);
    expect(total).toBe('1200.10');
  });

  it('fondos insuficientes al centavo: 0.01 más que el saldo se rechaza sin mover dinero', async () => {
    await resetAccounts({ '5200000001': 10, '5200000002': 0 });
    await expect(
      service.processTransaction({ sourceAccountNumber: '5200000001', targetAccountNumber: '5200000002', amount: 10.01 }, 'NSF'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await balancesText()).toEqual({ '5200000001': '10.00', '5200000002': '0.00' });
  });

  it('misma Idempotency-Key con otro monto o destino -> 422 y no hay segundo débito', async () => {
    await resetAccounts({ '6000000001': 500, '6000000002': 0, '6000000003': 0 });
    const first = await service.processTransaction(
      { sourceAccountNumber: '6000000001', targetAccountNumber: '6000000002', amount: 50 },
      'IDEM-A',
      'clave-reusada',
    );

    await expect(
      service.processTransaction({ sourceAccountNumber: '6000000001', targetAccountNumber: '6000000002', amount: 999 }, 'IDEM-B', 'clave-reusada'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.processTransaction({ sourceAccountNumber: '6000000001', targetAccountNumber: '6000000003', amount: 50 }, 'IDEM-C', 'clave-reusada'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    // El reintento legítimo (mismo payload) sigue devolviendo la original
    const replay = await service.processTransaction(
      { sourceAccountNumber: '6000000001', targetAccountNumber: '6000000002', amount: 50 },
      'IDEM-D',
      'clave-reusada',
    );
    expect(replay.id).toBe(first.id);
    expect(await balancesText()).toEqual({ '6000000001': '450.00', '6000000002': '50.00', '6000000003': '0.00' });
  });

  it('carrera con la misma clave y distinto payload: una gana, la otra recibe 422', async () => {
    await resetAccounts({ '6100000001': 500, '6100000002': 0 });
    const results = await Promise.allSettled([
      service.processTransaction({ sourceAccountNumber: '6100000001', targetAccountNumber: '6100000002', amount: 10 }, 'R-1', 'clave-carrera'),
      service.processTransaction({ sourceAccountNumber: '6100000001', targetAccountNumber: '6100000002', amount: 20 }, 'R-2', 'clave-carrera'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(UnprocessableEntityException);
    const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM transactions`);
    expect(count).toBe(1);
  });
});

describe('Pool agotado', () => {
  it('sin conexiones libres responde 503 y registra POOL_TIMEOUT en smartbancs_db_errors_total', async () => {
    await resetAccounts({ '7000000001': 100, '7000000002': 0 });
    const tiny = new DataSource({
      type: 'postgres',
      host: DB.host,
      port: DB.port,
      username: DB.user,
      password: DB.password,
      database: TEST_DB,
      entities: [Account, Transaction, AIRecommendation, OutboxEvent],
      synchronize: false,
      extra: { max: 1, connectionTimeoutMillis: 200 },
    });
    await tiny.initialize();
    const localMetrics = new MetricsService();
    const tinyService = new TransactionsService(tiny, tiny.getRepository(Transaction), localMetrics, silentLogger, config);
    const holder = tiny.createQueryRunner();
    await holder.connect(); // ocupa la única conexión
    try {
      await expect(
        tinyService.processTransaction({ sourceAccountNumber: '7000000001', targetAccountNumber: '7000000002', amount: 1 }, 'POOL', 'clave-pool'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      const text = await localMetrics.getMetrics();
      expect(text).toMatch(/smartbancs_db_errors_total\{sqlstate="POOL_TIMEOUT"[^}]*\} 1/);
    } finally {
      await holder.release();
      await tiny.destroy();
    }
  });
});

describe('Relay del outbox con confirmaciones', () => {
  it('solo marca published_at en los eventos que el broker confirmó (un UPDATE por lote)', async () => {
    await resetAccounts({ '8000000001': 100, '8000000002': 0 });
    await service.processTransaction({ sourceAccountNumber: '8000000001', targetAccountNumber: '8000000002', amount: 5 }, 'RELAY-1');

    // El broker confirma transaction.created y rechaza (nack) bancs.sync
    const rabbit: any = { publishEvent: async (routingKey: string) => routingKey === 'transaction.created' };
    const relay = new OutboxRelayService(ds, rabbit, metrics, silentLogger, config);
    expect(await relay.flush()).toBe(1);

    const rows = await ds.query(`SELECT event_type, published_at IS NOT NULL AS published, attempts, last_error FROM outbox_events ORDER BY event_type`);
    expect(rows).toEqual([
      expect.objectContaining({ event_type: 'bancs.sync', published: false, attempts: 1, last_error: expect.stringContaining('no confirmó') }),
      expect.objectContaining({ event_type: 'transaction.created', published: true, attempts: 1 }),
    ]);
  });

  it('si la BD corta la conexión a mitad del lote, flush no rechaza la promesa', async () => {
    const rabbit: any = { publishEvent: async () => true };
    const brokenDs: any = {
      createQueryRunner: () => ({
        connect: async () => undefined,
        startTransaction: async () => undefined,
        query: async () => {
          throw new Error('Connection terminated unexpectedly');
        },
        isTransactionActive: true,
        rollbackTransaction: async () => {
          throw new Error('Connection terminated unexpectedly');
        },
        release: async () => {
          throw new Error('Connection terminated unexpectedly');
        },
      }),
    };
    const relay = new OutboxRelayService(brokenDs, rabbit, metrics, silentLogger, config);
    await expect(relay.drain()).resolves.toBe(0);
  });
});
