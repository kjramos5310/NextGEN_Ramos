import React, { useState } from 'react';
import { Account } from '../types';
import { api } from '../services/api';
import { X, Send, AlertCircle, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  defaultSourceAccount: Account | null;
  onSuccess: () => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  accounts,
  defaultSourceAccount,
  onSuccess,
}) => {
  if (!isOpen) return null;

  const [sourceAccountNumber, setSourceAccountNumber] = useState(
    defaultSourceAccount?.accountNumber || (accounts[0]?.accountNumber ?? '')
  );
  const [targetAccountNumber, setTargetAccountNumber] = useState(
    accounts.find((a) => a.accountNumber !== (defaultSourceAccount?.accountNumber || accounts[0]?.accountNumber))?.accountNumber || ''
  );
  const [amount, setAmount] = useState('180.00');
  const [category, setCategory] = useState('FOOD');
  const [description, setDescription] = useState('Consumo Restaurante Corporativo');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<any | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessResult(null);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Ingresa un monto válido mayor a 0');
      return;
    }

    if (sourceAccountNumber === targetAccountNumber) {
      setErrorMsg('La cuenta de origen y destino deben ser distintas');
      return;
    }

    try {
      setIsLoading(true);
      const res = await api.createTransaction({
        sourceAccountNumber,
        targetAccountNumber,
        amount: parsedAmount,
        category,
        description,
      });

      setSuccessResult(res);
      onSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error en el procesamiento transaccional');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#111827] border border-slate-700 w-full max-w-lg rounded-xl p-6 relative shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-5">
          <h3 className="text-base font-bold text-white tracking-tight">Emisión de Transferencia Monetaria</h3>
          <p className="text-xs text-slate-400">
            Transacción ACID con bloqueo pesimista ordenado y despacho no bloqueante hacia IA
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-start space-x-2 text-rose-400 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successResult && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs space-y-1">
            <div className="flex items-center space-x-1.5 font-bold text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>Transacción ejecutada con éxito en {successResult.executionTimeMs} ms</span>
            </div>
            <p className="font-mono text-[10px] text-slate-400">ID: {successResult.id}</p>
            <p className="font-mono text-[10px] text-slate-400">Correlation-ID: {successResult.correlationId}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Cuenta Débito (Origen):</label>
              <select
                value={sourceAccountNumber}
                onChange={(e) => setSourceAccountNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.accountNumber}>
                    {a.accountHolder} (#{a.accountNumber}) - ${Number(a.balance).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Cuenta Crédito (Destino):</label>
              <select
                value={targetAccountNumber}
                onChange={(e) => setTargetAccountNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.accountNumber}>
                    {a.accountHolder} (#{a.accountNumber})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">Monto a Transferir (USD):</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-slate-400 font-mono text-xs">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-blue-500"
                placeholder="0.00"
                required
              />
            </div>

            <div className="flex items-center space-x-1.5 mt-2">
              <span className="text-[10px] text-slate-400">Montos rápidos:</span>
              {[50, 180, 500, 1500].map((quick) => (
                <button
                  type="button"
                  key={quick}
                  onClick={() => setAmount(quick.toFixed(2))}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-300 border border-slate-700"
                >
                  ${quick}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Categoría:</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="FOOD">Alimentación (FOOD)</option>
                <option value="ENTERTAINMENT">Entretenimiento (ENTERTAINMENT)</option>
                <option value="TRANSFER">Transferencia Directa (TRANSFER)</option>
                <option value="SALARY">Nómina / Salario (SALARY)</option>
                <option value="SHOPPING">Compras (SHOPPING)</option>
                <option value="UTILITIES">Servicios Básicos (UTILITIES)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Concepto / Glosa:</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                placeholder="Descripción del movimiento"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800"
            >
              Cerrar
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Procesando ACID...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Confirmar Transferencia</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
