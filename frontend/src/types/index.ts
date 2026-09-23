export interface Account {
  id: string;
  accountNumber: string;
  accountHolder: string;
  clientId: string;
  type: 'SAVINGS' | 'CHECKING' | 'INVESTMENT';
  balance: number;
  currency: string;
  status: 'ACTIVE' | 'BLOCKED' | 'INACTIVE';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  correlationId: string;
  sourceAccountNumber: string;
  targetAccountNumber: string;
  amount: number;
  currency: string;
  description: string;
  category: 'TRANSFER' | 'SERVICES' | 'FOOD' | 'ENTERTAINMENT' | 'SHOPPING' | 'SALARY' | 'OTHER';
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  errorMessage?: string;
  executionTimeMs: number;
  createdAt: string;
}

export interface AIRecommendation {
  id: string;
  accountNumber: string;
  transactionId?: string;
  type: 'SAVINGS_ADVICE' | 'SPENDING_ALERT' | 'FRAUD_WARNING' | 'INVESTMENT_OPPORTUNITY' | 'BUDGET_OPTIMIZATION';
  title: string;
  message: string;
  confidenceScore: number;
  metadata?: AIRecommendationMetadata | null;
  isRead: boolean;
  createdAt: string;
}

/** Motor que generó la recomendación (lo informa el ai-service en metadata.engine). */
export type AIEngine = 'gemini-3.6-flash' | 'heuristic-fallback';

export interface AIRecommendationMetadata {
  engine?: AIEngine | string;
  riskLevel?: string;
  [key: string]: unknown;
}

export interface SimulationResult {
  simulationName: string;
  totalDurationMs: number;
  totalRequested: number;
  successfulTransactions: number;
  failedTransactions: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  slaTargetUnder2s: boolean;
  errors: string[];
  /** Transferencias completadas por segundo (medido en el backend) */
  throughputTps?: number;
  /** Suma de saldos antes y después (texto NUMERIC de PostgreSQL) */
  totalMoneyBefore?: string;
  totalMoneyAfter?: string;
  moneyConserved?: boolean;
}

/** Respuesta de GET /simulation/db-diagnostics. Todos los campos son opcionales: la UI muestra "—" si faltan. */
export interface DbDiagnostics {
  timestamp?: string;
  activeConnectionsCount?: number;
  activeQueries?: Array<{
    pid: number;
    state?: string;
    query?: string;
    wait_event_type?: string | null;
    wait_event?: string | null;
    duration?: unknown;
  }>;
  blockedSessionsCount?: number;
  idleInTransactionCount?: number;
  pool?: { total?: number; idle?: number; waiting?: number } | null;
  /** Quién bloquea a quién (pg_blocking_pids): una fila por par bloqueado/bloqueante */
  blockingChains?: Array<{
    blocked_pid: number;
    blocked_query?: string;
    blocking_pid: number;
    blocking_state?: string;
    blocking_query?: string;
    blocking_xact_seconds?: number | string;
    [key: string]: unknown;
  }>;
  healthStatus?: string;
  recommendedAction?: string;
  error?: string;
}
