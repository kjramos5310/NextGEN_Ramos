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
import { BadRequestException } from '@nestjs/common';
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
