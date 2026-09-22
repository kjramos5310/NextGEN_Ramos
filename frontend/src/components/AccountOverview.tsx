import React, { useState } from 'react';
import { Account } from '../types';
import { CreditCard, Wallet, TrendingUp, ArrowUpRight, Copy, Check, CheckCircle2 } from 'lucide-react';

interface AccountOverviewProps {
  accounts: Account[];
  selectedAccount: Account | null;
  onSelectAccount: (acc: Account) => void;
  onOpenTransferModal: () => void;
}

export const AccountOverview: React.FC<AccountOverviewProps> = ({
  accounts,
  selectedAccount,
  onSelectAccount,
  onOpenTransferModal,
}) => {
  const [copiedAccount, setCopiedAccount] = useState<string | null>(null);

  const handleCopy = (accNum: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(accNum);
    setCopiedAccount(accNum);
    setTimeout(() => setCopiedAccount(null), 2000);
  };

  const getAccountTypeLabel = (type: string) => {
    switch (type) {
      case 'CHECKING':
        return 'Cuenta Corriente';
      case 'SAVINGS':
        return 'Cuenta de Ahorros';
      case 'INVESTMENT':
        return 'Fondo de Inversión';
      default:
        return type;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Posición Consolidada</h2>
          <p className="text-xs text-slate-400">Selecciona una cuenta para auditar movimientos o emitir pagos</p>
        </div>
        <button
          onClick={onOpenTransferModal}
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-colors"
        >
          <ArrowUpRight className="w-4 h-4" />
          <span>Emitir Transferencia</span>
        </button>
      </div>

      {/* Grid de Cuentas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {accounts.map((acc) => {
          const isSelected = selectedAccount?.id === acc.id;
          return (
            <div
              key={acc.id}
              onClick={() => onSelectAccount(acc)}
              className={`p-4 rounded-xl cursor-pointer transition-all duration-150 relative border ${
                isSelected
                  ? 'bank-card-active'
                  : 'bank-card hover:bg-[#161f33]'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300 border border-slate-700">
                    {acc.type === 'CHECKING' ? (
                      <Wallet className="w-4 h-4 text-blue-400" />
                    ) : acc.type === 'SAVINGS' ? (
                      <CreditCard className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <TrendingUp className="w-4 h-4 text-amber-400" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-200">{getAccountTypeLabel(acc.type)}</h3>
                    <p className="text-[11px] text-slate-400">{acc.accountHolder}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-1">
                  <span className="text-[10px] font-mono text-slate-400">#{acc.accountNumber}</span>
                  <button
                    onClick={(e) => handleCopy(acc.accountNumber, e)}
                    className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
                    title="Copiar número de cuenta"
                  >
                    {copiedAccount === acc.accountNumber ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>

              <div className="my-2">
                <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Saldo Disponible</span>
                <div className="flex items-baseline space-x-1.5 mt-0.5">
                  <span className="text-sm font-semibold text-slate-400">$</span>
                  <span className="text-2xl font-bold text-white tracking-tight amount-num font-mono">
                    {Number(acc.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs font-medium text-slate-400">{acc.currency}</span>
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                <span className="inline-flex items-center space-x-1 text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{acc.status}</span>
                </span>
                <span className="text-slate-500 font-mono text-[10px]">v{acc.version}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
