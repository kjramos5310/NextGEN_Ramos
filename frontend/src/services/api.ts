import { Account, Transaction, AIRecommendation, SimulationResult } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

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
  }): Promise<Transaction> => {
    const res = await fetch(`${API_BASE_URL}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ message: 'Error procesando transacción' }));
      throw new Error(errData.message || 'Error en la transacción');
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
  triggerQuincenaSpike: async (totalRequests = 30): Promise<SimulationResult> => {
    const res = await fetch(`${API_BASE_URL}/simulation/quincena-spike`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalRequests }),
    });
    if (!res.ok) throw new Error('Error al ejecutar simulación de quincena');
    return res.json();
  },

  getDbDiagnostics: async () => {
    const res = await fetch(`${API_BASE_URL}/simulation/db-diagnostics`);
    if (!res.ok) throw new Error('Error al obtener diagnósticos de BD');
    return res.json();
  },
};
