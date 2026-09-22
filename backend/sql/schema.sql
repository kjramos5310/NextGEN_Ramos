-- ==============================================================================
-- SmartBancs App - DDL Database Schema
-- Database Engine: PostgreSQL 16
-- Concurrency Strategy: ACID Compliance, Row-Level Locks, B-Tree Indexes
-- ==============================================================================

-- 1. Tablas y Tipos Enumerados
CREATE TYPE account_status_enum AS ENUM ('ACTIVE', 'BLOCKED', 'INACTIVE');
CREATE TYPE account_type_enum AS ENUM ('SAVINGS', 'CHECKING', 'INVESTMENT');
CREATE TYPE transaction_status_enum AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE transaction_category_enum AS ENUM ('TRANSFER', 'SERVICES', 'FOOD', 'ENTERTAINMENT', 'SHOPPING', 'SALARY', 'OTHER');
CREATE TYPE recommendation_type_enum AS ENUM ('SAVINGS_ADVICE', 'SPENDING_ALERT', 'FRAUD_WARNING', 'INVESTMENT_OPPORTUNITY', 'BUDGET_OPTIMIZATION');

-- 2. Tabla de Cuentas Bancarias
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_number VARCHAR(20) NOT NULL UNIQUE,
    account_holder VARCHAR(100) NOT NULL,
    client_id VARCHAR(50) NOT NULL,
    type account_type_enum NOT NULL DEFAULT 'SAVINGS',
    balance NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0.00),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status account_status_enum NOT NULL DEFAULT 'ACTIVE',
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_account_number ON accounts(account_number);
CREATE INDEX IF NOT EXISTS idx_accounts_client_id ON accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);

-- 3. Tabla de Transacciones Financieras
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correlation_id VARCHAR(64) NOT NULL,
    source_account_number VARCHAR(20) NOT NULL,
    target_account_number VARCHAR(20) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0.00),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    description VARCHAR(255) DEFAULT 'Transferencia SmartBancs',
    category transaction_category_enum NOT NULL DEFAULT 'TRANSFER',
    status transaction_status_enum NOT NULL DEFAULT 'PENDING',
    error_message VARCHAR(500),
    execution_time_ms INT DEFAULT 0,
    -- Idempotencia (G2): un reintento del cliente con la misma clave no genera un segundo débito
    idempotency_key VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_idempotency_key
    ON transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source_account_number);
CREATE INDEX IF NOT EXISTS idx_transactions_target ON transactions(target_account_number);
CREATE INDEX IF NOT EXISTS idx_transactions_correlation ON transactions(correlation_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

-- 4. Tabla de Recomendaciones de IA
CREATE TABLE IF NOT EXISTS ai_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_number VARCHAR(20) NOT NULL,
    transaction_id VARCHAR(64),
    type recommendation_type_enum NOT NULL DEFAULT 'SAVINGS_ADVICE',
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    confidence_score NUMERIC(5, 4) DEFAULT 0.9500,
    metadata JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_recs_account ON ai_recommendations(account_number);
-- Consumidor idempotente: la entrega es at-least-once, una recomendación por transacción
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_recs_transaction
    ON ai_recommendations(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_recs_created ON ai_recommendations(created_at DESC);

-- 5. Transactional Outbox (G1)
-- El evento se inserta en la MISMA transacción que el débito/crédito. Un relay lo publica
-- en RabbitMQ después del COMMIT, así no hay dual-write: si la transacción hace rollback
-- el evento no existe, y si el broker está caído el evento espera en esta tabla.
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(50) NOT NULL,          -- 'transaction'
    aggregate_id VARCHAR(64) NOT NULL,            -- id de la transacción
    event_type VARCHAR(100) NOT NULL,             -- routing key: transaction.created, bancs.sync
    payload JSONB NOT NULL,
    correlation_id VARCHAR(64),
    attempts INT NOT NULL DEFAULT 0,
    last_error VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP WITH TIME ZONE
);

-- Índice parcial: el relay solo recorre lo pendiente, la tabla puede crecer sin penalizar el sondeo
CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox_events(created_at) WHERE published_at IS NULL;
