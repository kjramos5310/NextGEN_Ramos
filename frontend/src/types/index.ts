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
  metadata?: Record<string, any>;
  isRead: boolean;
  createdAt: string;
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
}
