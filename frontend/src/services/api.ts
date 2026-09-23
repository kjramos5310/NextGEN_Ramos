import { Account, Transaction, AIRecommendation, SimulationResult, DbDiagnostics } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

/** Error HTTP con el mensaje que devolvió el backend (NestJS: `message` puede ser string o string[]). */
export class ApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly correlationId?: string | null) {
    super(message);
    this.name = 'ApiError';
  }
}

const toApiError = async (res: Response, fallback: string): Promise<ApiError> => {
  const body = await res.json().catch(() => null);
  const raw = body?.message;
  const message = Array.isArray(raw) ? raw.join('; ') : typeof raw === 'string' && raw ? raw : fallback;
  return new ApiError(message, res.status, res.headers.get('x-correlation-id'));
};

export const api = {
  // Accounts
  getAccounts: async (): Promise<Account[]> => {
    const res = await fetch(`${API_BASE_URL}/accounts`);
    if (!res.ok) throw new Error('Error al obtener cuentas');
    return res.json();
  },

  getAccountBalance: async (accountNumber: string) => {
    const res = await fetch(`${API_BASE_URL}/accounts/${accountNumber}/balance`);
    if (!res.ok) throw new Error('Error al obtener saldo');
    return res.json();
  },

  // Transactions
  getTransactions: async (limit = 30): Promise<Transaction[]> => {
    const res = await fetch(`${API_BASE_URL}/transactions?limit=${limit}`);
    if (!res.ok) throw new Error('Error al obtener transacciones');
    return res.json();
  },

  createTransaction: async (data: {
    sourceAccountNumber: string;
    targetAccountNumber: string;
    amount: number;
    description?: string;
    category?: string;
  }, idempotencyKey: string = crypto.randomUUID()): Promise<Transaction> => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/transactions`, {
        method: 'POST',
        // Idempotency-Key: un doble clic o un reintento de red con la misma clave no genera un segundo débito
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(data),
      });
    } catch {
      throw new ApiError('No se pudo conectar con el backend. Puedes reintentar: la misma Idempotency-Key evita un doble débito.');
    }
    if (!res.ok) {
      throw await toApiError(res, `Error en la transacción (HTTP ${res.status})`);
    }
    return res.json();
  },

  // AI Recommendations
  getRecommendations: async (accountNumber?: string): Promise<AIRecommendation[]> => {
    const url = accountNumber 
      ? `${API_BASE_URL}/recommendations/account/${accountNumber}`
      : `${API_BASE_URL}/recommendations`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error al obtener recomendaciones');
    return res.json();
  },

  markRecommendationAsRead: async (id: string): Promise<AIRecommendation> => {
    const res = await fetch(`${API_BASE_URL}/recommendations/${id}/read`, {
      method: 'PATCH',
    });
    if (!res.ok) throw new Error('Error al marcar recomendación');
    return res.json();
  },

  // Operations & Incident Simulation
  triggerQuincenaSpike: async (totalRequests = 1000): Promise<SimulationResult> => {
    const res = await fetch(`${API_BASE_URL}/simulation/quincena-spike`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalRequests }),
    });
    if (!res.ok) throw await toApiError(res, `Error al ejecutar simulación de quincena (HTTP ${res.status})`);
    return res.json();
  },

  getDbDiagnostics: async (): Promise<DbDiagnostics> => {
    const res = await fetch(`${API_BASE_URL}/simulation/db-diagnostics`);
    if (!res.ok) throw await toApiError(res, `Error al obtener diagnósticos de BD (HTTP ${res.status})`);
    return res.json();
  },
};
