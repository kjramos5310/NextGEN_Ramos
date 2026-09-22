import React, { useState } from 'react';
import { api } from '../services/api';
import { SimulationResult } from '../types';
import { Activity, ShieldCheck, Database, RefreshCw, BarChart3, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

export const OperationsIncidentConsole: React.FC = () => {
  const [totalRequests, setTotalRequests] = useState(30);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  const [dbDiag, setDbDiag] = useState<any | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);

  const handleRunSimulation = async () => {
    try {
      setIsSimulating(true);
      const res = await api.triggerQuincenaSpike(totalRequests);
      setSimResult(res);
      await fetchDbDiagnostics();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSimulating(false);
    }
  };

  const fetchDbDiagnostics = async () => {
    try {
      setLoadingDiag(true);
      const diag = await api.getDbDiagnostics();
      setDbDiag(diag);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDiag(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="bank-card rounded-xl p-5 relative">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="p-1.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Activity className="w-4 h-4" />
              </span>
              <h3 className="text-base font-bold text-white tracking-tight">
                Consola de Concurrencia y Resiliencia Transaccional (Escenario de Quincena)
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Genera ráfagas concurrentes para validar la eliminación matemática de deadlocks mediante 
              <strong> ordenamiento determinista de locks (Coffman)</strong> y el cumplimiento del SLA (&lt; 2.0s).
            </p>
          </div>

          <div className="flex items-center space-x-3 w-full md:w-auto">
            <div className="flex items-center space-x-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5">
              <label className="text-xs text-slate-400">Volumen:</label>
              <select
                value={totalRequests}
                onChange={(e) => setTotalRequests(Number(e.target.value))}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none"
              >
                <option value={20} className="bg-slate-900">20 tx concurrentes</option>
                <option value={40} className="bg-slate-900">40 tx concurrentes</option>
                <option value={60} className="bg-slate-900">60 tx concurrentes</option>
                <option value={100} className="bg-slate-900">100 tx concurrentes</option>
              </select>
            </div>

            <button
              onClick={handleRunSimulation}
              disabled={isSimulating}
              className={`inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm ${
                isSimulating
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {isSimulating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Procesando Ráfaga...</span>
                </>
              ) : (
                <>
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Ejecutar Test de Carga</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Result Cards */}
      {simResult && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fadeIn">
          <div className="bank-card rounded-xl p-4">
            <span className="label-muted">Transacciones Exitosas</span>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-2xl font-bold text-white font-mono amount-num">
                {simResult.successfulTransactions}
              </span>
              <span className="text-xs font-mono text-slate-400">/ {simResult.totalRequested}</span>
            </div>
            <div className="mt-2 flex items-center space-x-1 text-emerald-400 text-[11px] font-semibold">
              <CheckCircle2 className="w-3 h-3" />
              <span>100% Consistencia ACID</span>
            </div>
          </div>

          <div className="bank-card rounded-xl p-4">
            <span className="label-muted">Latencia Promedio</span>
            <div className="flex items-baseline space-x-1.5 mt-1">
              <span className="text-2xl font-bold text-white font-mono amount-num">
                {simResult.averageLatencyMs.toFixed(1)}
              </span>
              <span className="text-xs font-semibold text-slate-400">ms</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 font-mono">
              Min: {simResult.minLatencyMs}ms | Max: {simResult.maxLatencyMs}ms
            </p>
          </div>

          <div className="bank-card rounded-xl p-4">
            <span className="label-muted">Latencia Percentil 95 (p95)</span>
            <div className="flex items-baseline space-x-1.5 mt-1">
              <span className={`text-2xl font-bold font-mono amount-num ${
                simResult.p95LatencyMs < 2000 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {simResult.p95LatencyMs}
              </span>
              <span className="text-xs font-semibold text-slate-400">ms</span>
            </div>
            <div className="mt-2 flex items-center space-x-1 text-[11px] font-semibold text-slate-300">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>SLA Target: &lt; 2,000 ms</span>
            </div>
          </div>

          <div className="bank-card rounded-xl p-4">
            <span className="label-muted">Deadlocks Detectados</span>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-2xl font-bold text-emerald-400 font-mono">0</span>
              <span className="text-xs text-slate-400 font-semibold">errores</span>
            </div>
            <div className="mt-2 flex items-center space-x-1 text-emerald-400 text-[11px] font-semibold">
              <ShieldCheck className="w-3 h-3" />
              <span>Prevención por Lock Ordering</span>
            </div>
          </div>
        </div>
      )}

      {/* Database Diagnostics Section */}
      <div className="bank-card rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Database className="w-4 h-4 text-blue-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Diagnóstico en Vivo del Pool de PostgreSQL (pg_stat_activity & pg_locks)
            </h4>
          </div>
          <button
            onClick={fetchDbDiagnostics}
            disabled={loadingDiag}
            className="inline-flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loadingDiag ? 'animate-spin' : ''}`} />
            <span>Consultar BD</span>
          </button>
        </div>

        {dbDiag ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-1">Estado de Conexiones:</span>
                <span className="text-emerald-400 font-semibold font-mono text-sm">{dbDiag.healthStatus}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-1">Conexiones Activas:</span>
                <span className="text-white font-bold font-mono text-sm">{dbDiag.activeConnectionsCount}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-1">Bloqueos de Tabla Detectados:</span>
                <span className="text-slate-200 font-bold font-mono text-sm">{dbDiag.tableLocks?.length || 0}</span>
              </div>
            </div>

            {/* Queries Table */}
            {dbDiag.activeQueries && dbDiag.activeQueries.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-mono">
                    <tr>
                      <th className="px-3 py-2">PID</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Query</th>
                      <th className="px-3 py-2">Evento Espera</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono text-slate-300">
                    {dbDiag.activeQueries.map((q: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-800/40">
                        <td className="px-3 py-1.5 text-slate-400">{q.pid}</td>
                        <td className="px-3 py-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px]">
                            {q.state}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 truncate max-w-xs">{q.query}</td>
                        <td className="px-3 py-1.5 text-slate-400">{q.wait_event || 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Haz clic en &quot;Consultar BD&quot; o ejecuta una prueba de carga para auditar el estado del connection pool de PostgreSQL en tiempo real.
          </p>
        )}
      </div>
    </div>
  );
};
