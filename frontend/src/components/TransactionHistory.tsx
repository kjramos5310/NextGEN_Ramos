import React, { useState } from 'react';
import { Transaction } from '../types';
import { CheckCircle2, XCircle, Copy, Check, Clock, ArrowUpDown } from 'lucide-react';

interface TransactionHistoryProps {
  transactions: Transaction[];
  currentAccountNumber?: string;
  onRefresh: () => void;
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  transactions,
  currentAccountNumber,
  onRefresh,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="bank-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight">Libro Mayor de Movimientos</h3>
          <p className="text-xs text-slate-400">Auditoría transaccional con Correlation IDs y latencia de base de datos</p>
        </div>
        <button
          onClick={onRefresh}
          className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
        >
          Actualizar
        </button>
      </div>

      {transactions.length === 0 ? (
        <div className="text-center py-10 text-slate-500">
          <Clock className="w-6 h-6 mx-auto mb-2 text-slate-600" />
          <p className="text-xs">No se registran movimientos en la base de datos.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-mono tracking-wider">
              <tr>
                <th className="py-2.5 px-3">Estado</th>
                <th className="py-2.5 px-3">Cuentas (Origen → Destino)</th>
                <th className="py-2.5 px-3">Categoría</th>
                <th className="py-2.5 px-3 text-right">Monto</th>
                <th className="py-2.5 px-3 text-center">Latencia BD</th>
                <th className="py-2.5 px-3">Correlation ID</th>
                <th className="py-2.5 px-3 text-right">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono text-slate-300 text-[11px]">
              {transactions.map((tx) => {
                const isDebit = currentAccountNumber && tx.sourceAccountNumber === currentAccountNumber;
                return (
                  <tr key={tx.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {tx.status === 'COMPLETED' ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>ACID OK</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 text-[10px] font-semibold border border-rose-500/20">
                          <XCircle className="w-3 h-3" />
                          <span>ROLLBACK</span>
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex items-center space-x-1.5 font-semibold">
                        <span className="text-slate-300">#{tx.sourceAccountNumber}</span>
                        <span className="text-slate-500 text-[10px]">→</span>
                        <span className="text-blue-400">#{tx.targetAccountNumber}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[200px] font-sans">
                        {tx.description}
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] border border-slate-700 font-sans">
                        {tx.category}
                      </span>
                    </td>

                    <td className="py-2.5 px-3 text-right font-bold amount-num">
                      <span className={isDebit ? 'text-rose-400' : 'text-emerald-400'}>
                        {isDebit ? '-' : '+'}${Number(tx.amount).toFixed(2)}
                      </span>
                    </td>

                    <td className="py-2.5 px-3 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        tx.executionTimeMs < 50 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                      }`}>
                        {tx.executionTimeMs} ms
                      </span>
                    </td>

                    <td className="py-2.5 px-3 text-slate-400 text-[10px]">
                      <div className="flex items-center space-x-1">
                        <span className="truncate max-w-[120px]" title={tx.correlationId}>
                          {tx.correlationId}
                        </span>
                        <button
                          onClick={() => handleCopy(tx.correlationId)}
                          className="p-0.5 hover:text-white"
                          title="Copiar Correlation ID"
                        >
                          {copiedId === tx.correlationId ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3 text-slate-500" />
                          )}
                        </button>
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-right text-slate-400 text-[10px] whitespace-nowrap">
                      {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
