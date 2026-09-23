import React, { useState } from 'react';
import { AIRecommendation } from '../types';
import { api } from '../services/api';
import { aiEngineLabel } from '../utils/aiEngine';
import { Sparkles, AlertTriangle, TrendingUp, PiggyBank, ShieldAlert, Check, CheckCheck, Filter, RefreshCw, Cpu } from 'lucide-react';

interface AIAdvisorFeedProps {
  recommendations: AIRecommendation[];
  onRefresh: () => void;
}

export const AIAdvisorFeed: React.FC<AIAdvisorFeedProps> = ({ recommendations, onRefresh }) => {
  const [filterType, setFilterType] = useState<string>('ALL');

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.markRecommendationAsRead(id);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const filteredRecs = recommendations.filter((r) => {
    if (filterType === 'ALL') return true;
    return r.type === filterType;
  });

  const getBadgeStyle = (type: string) => {
    switch (type) {
      case 'SAVINGS_ADVICE':
        return {
          icon: <PiggyBank className="w-4 h-4 text-emerald-400" />,
          label: 'Plan de Ahorro',
          badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        };
      case 'SPENDING_ALERT':
        return {
          icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
          label: 'Alerta de Consumo',
          badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        };
      case 'INVESTMENT_OPPORTUNITY':
        return {
          icon: <TrendingUp className="w-4 h-4 text-blue-400" />,
          label: 'Oportunidad de Inversión',
          badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        };
      case 'FRAUD_WARNING':
        return {
          icon: <ShieldAlert className="w-4 h-4 text-rose-400" />,
          label: 'Monitoreo de Seguridad',
          badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
        };
      default:
        return {
          icon: <Sparkles className="w-4 h-4 text-blue-400" />,
          label: 'Análisis Financiero',
          badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
        };
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Status */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl bank-card">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-white tracking-tight">Motor de Análisis Cognitivo y Gestión de Riesgo</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-semibold">
                Gemini 3.6 Flash · fallback heurístico
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Evaluación asíncrona: el evento sale de la tabla outbox hacia RabbitMQ y no bloquea la transferencia. El motor real se indica en cada recomendación.
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          className="inline-flex items-center space-x-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Actualizar Feed</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
        <span className="text-slate-400 font-medium flex items-center space-x-1 mr-1">
          <Filter className="w-3.5 h-3.5" />
          <span>Filtrar:</span>
        </span>
        {[
          { id: 'ALL', label: 'Todas las Evaluaciones' },
          { id: 'SPENDING_ALERT', label: 'Alertas de Consumo' },
          { id: 'SAVINGS_ADVICE', label: 'Ahorro Automático' },
          { id: 'INVESTMENT_OPPORTUNITY', label: 'Inversión' },
          { id: 'FRAUD_WARNING', label: 'Seguridad' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterType(tab.id)}
            className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
              filterType === tab.id
                ? 'bg-slate-700 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Empty State */}
      {filteredRecs.length === 0 ? (
        <div className="bank-card rounded-xl p-10 text-center text-slate-400">
          <Sparkles className="w-8 h-8 mx-auto mb-2 text-slate-600" />
          <h4 className="text-sm font-semibold text-slate-300 mb-1">Sin recomendaciones en esta categoría</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Ejecuta transferencias desde la pestaña de cuentas para observar el análisis y sugerencias de ahorro generadas por el modelo.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRecs.map((rec) => {
            const style = getBadgeStyle(rec.type);
            const riskLevel = typeof rec.metadata?.riskLevel === 'string' ? rec.metadata.riskLevel : '—';

            return (
              <div
                key={rec.id}
                className={`p-4 rounded-xl transition-colors border ${
                  rec.isRead
                    ? 'bg-[#0f1522] border-slate-800 opacity-60'
                    : 'bank-card border-slate-700/80 hover:border-slate-600'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2.5">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                      {style.icon}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${style.badgeClass}`}>
                          {style.label}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">#{rec.accountNumber}</span>
                      </div>
                      <h4 className="text-xs font-bold text-white mt-1">{rec.title}</h4>
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end">
                    <span className={`text-[10px] font-mono font-bold ${Number(rec.confidenceScore) < 0.6 ? 'text-amber-400' : 'text-blue-400'}`}>
                      {(Number(rec.confidenceScore) * 100).toFixed(0)}% Confianza
                    </span>
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">
                      Riesgo: {riskLevel}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed mb-3">{rec.message}</p>

                {rec.metadata?.needsClientConfirmation === true && (
                  <div className="mb-3 px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
                    Operación atípica: requiere confirmación del cliente
                    {typeof rec.metadata.confidenceReason === 'string' && rec.metadata.confidenceReason && (
                      <span className="block text-amber-200/80 mt-0.5">{rec.metadata.confidenceReason}</span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2.5 border-t border-slate-800 text-[11px] text-slate-400">
                  <span className="font-mono text-[10px]">
                    Motor: {aiEngineLabel(rec)} ·{' '}
                    {new Date(rec.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  {!rec.isRead ? (
                    <button
                      onClick={() => handleMarkAsRead(rec.id)}
                      className="inline-flex items-center space-x-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Marcar revisado</span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center space-x-1 text-slate-400 text-[10px]">
                      <CheckCheck className="w-3 h-3 text-slate-400" />
                      <span>Revisado</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
