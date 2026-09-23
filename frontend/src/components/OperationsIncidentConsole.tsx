import React, { useState } from 'react';
import { api } from '../services/api';
import { SimulationResult, DbDiagnostics } from '../types';
import { Activity, Database, RefreshCw, BarChart3, AlertCircle, Clock } from 'lucide-react';

const DASH = '—';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fmtMs = (v: unknown, digits = 0) => (isNum(v) ? v.toFixed(digits) : DASH);

export const OperationsIncidentConsole: React.FC = () => {
  const [totalRequests, setTotalRequests] = useState(1000);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  const [simError, setSimError] = useState<string | null>(null);

  const [dbDiag, setDbDiag] = useState<DbDiagnostics | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);

  const handleRunSimulation = async () => {
    try {
      setIsSimulating(true);
      setSimError(null);
      const res = await api.triggerQuincenaSpike(totalRequests);
      // El backend responde { message } (sin métricas) si no hay cuentas suficientes
      if (!isNum(res?.totalRequested)) {
        setSimResult(null);
        setSimError((res as { message?: string })?.message || 'La simulación no devolvió resultados');
      } else {
        setSimResult(res);
      }
      await fetchDbDiagnostics();
    } catch (err) {
      console.error(err);
      setSimResult(null);
      setSimError(err instanceof Error ? err.message : 'Error al ejecutar la simulación');
    } finally {
      setIsSimulating(false);
    }
  };

  const fetchDbDiagnostics = async () => {
    try {
      setLoadingDiag(true);
      setDiagError(null);
      const diag = await api.getDbDiagnostics();
      setDbDiag(diag);
    } catch (err) {
      console.error(err);
      setDiagError(err instanceof Error ? err.message : 'Error al consultar la BD');
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
              Genera ráfagas concurrentes contra el servicio de transferencias, que toma los locks pesimistas en
              <strong> orden determinista (Coffman)</strong>, y mide la latencia frente al objetivo SLA (&lt; 2.0 s).
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
                <option value={1000} className="bg-slate-900">1.000 transferencias</option>
                <option value={2500} className="bg-slate-900">2.500 transferencias</option>
                <option value={5000} className="bg-slate-900">5.000 transferencias</option>
                <option value={10000} className="bg-slate-900">10.000 transferencias</option>
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

      {simError && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-start space-x-2 text-rose-400 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{simError}</span>
        </div>
      )}

      {/* Metrics Result Cards (todos los valores vienen de la respuesta de /simulation/quincena-spike) */}
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
            <p className="text-[11px] text-slate-400 mt-2 font-mono">
              Duración total: {fmtMs(simResult.totalDurationMs)} ms
              {isNum(simResult.throughputTps) && <> · {simResult.throughputTps} TPS medidos</>}
            </p>
            {typeof simResult.moneyConserved === 'boolean' && (
              <p className={`text-[11px] mt-1 font-mono ${simResult.moneyConserved ? 'text-emerald-400' : 'text-rose-400'}`}>
                Dinero total: ${simResult.totalMoneyBefore} antes · ${simResult.totalMoneyAfter} después
                {simResult.moneyConserved ? ' (se conserva)' : ' (NO se conserva)'}
              </p>
            )}
          </div>

          <div className="bank-card rounded-xl p-4">
            <span className="label-muted">Latencia Promedio</span>
            <div className="flex items-baseline space-x-1.5 mt-1">
              <span className="text-2xl font-bold text-white font-mono amount-num">
                {fmtMs(simResult.averageLatencyMs, 1)}
              </span>
              <span className="text-xs font-semibold text-slate-400">ms</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 font-mono">
              Min: {fmtMs(simResult.minLatencyMs)}ms | Max: {fmtMs(simResult.maxLatencyMs)}ms
            </p>
          </div>

          <div className="bank-card rounded-xl p-4">
            <span className="label-muted">Latencia Percentil 95 (p95)</span>
            <div className="flex items-baseline space-x-1.5 mt-1">
              <span className={`text-2xl font-bold font-mono amount-num ${
                !isNum(simResult.p95LatencyMs) ? 'text-slate-300' : simResult.p95LatencyMs < 2000 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {fmtMs(simResult.p95LatencyMs)}
              </span>
              <span className="text-xs font-semibold text-slate-400">ms</span>
            </div>
            <div className="mt-2 flex items-center space-x-1 text-[11px] font-semibold text-slate-300">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>
                Objetivo SLA: &lt; 2,000 ms
                {typeof simResult.slaTargetUnder2s === 'boolean' && (simResult.slaTargetUnder2s ? ' · cumple' : ' · no cumple')}
              </span>
            </div>
          </div>

          <div className="bank-card rounded-xl p-4">
            <span className="label-muted">Transacciones Fallidas</span>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className={`text-2xl font-bold font-mono ${
                !isNum(simResult.failedTransactions) ? 'text-slate-300' : simResult.failedTransactions > 0 ? 'text-rose-400' : 'text-emerald-400'
              }`}>
                {isNum(simResult.failedTransactions) ? simResult.failedTransactions : DASH}
              </span>
              <span className="text-xs text-slate-400 font-semibold">/ {simResult.totalRequested}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 font-mono">
              Deadlocks y timeouts por SQLSTATE: métrica smartbancs_db_errors_total en /metrics
            </p>
          </div>
        </div>
      )}

      {simResult && Array.isArray(simResult.errors) && simResult.errors.length > 0 && (
        <div className="bank-card rounded-xl p-4 text-xs">
          <span className="label-muted">Errores devueltos (primeros {simResult.errors.length})</span>
          <ul className="mt-2 space-y-1 font-mono text-[11px] text-rose-300">
            {simResult.errors.map((e, i) => (
              <li key={i} className="truncate">{e}</li>
            ))}
          </ul>
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

        {diagError && (
          <p className="text-xs text-rose-400">{diagError}</p>
        )}

        {dbDiag ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-1">Estado (según backend):</span>
                <span className={`font-semibold font-mono text-sm ${
                  !dbDiag.healthStatus ? 'text-slate-300' : dbDiag.healthStatus === 'HEALTHY' ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                  {dbDiag.healthStatus || DASH}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-1">Sesiones no inactivas:</span>
                <span className="text-white font-bold font-mono text-sm">
                  {isNum(dbDiag.activeConnectionsCount) ? dbDiag.activeConnectionsCount : DASH}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-1">Sesiones bloqueadas por otra:</span>
                <span className="text-slate-200 font-bold font-mono text-sm">
                  {isNum(dbDiag.blockedSessionsCount) ? dbDiag.blockedSessionsCount : DASH}
                </span>
              </div>
            </div>

            {dbDiag.recommendedAction && (
              <p className="text-xs text-slate-300">Acción sugerida: {dbDiag.recommendedAction}</p>
            )}

            {dbDiag.blockingChains && dbDiag.blockingChains.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-amber-500/30">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-mono">
                    <tr>
                      <th className="px-3 py-2">PID bloqueado</th>
                      <th className="px-3 py-2">Bloqueado por</th>
                      <th className="px-3 py-2">Query que retiene el lock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbDiag.blockingChains.map((c, i) => (
                      <tr key={i} className="border-t border-slate-800 text-slate-300 font-mono">
                        <td className="px-3 py-2">{c.blocked_pid}</td>
                        <td className="px-3 py-2">{c.blocking_pid}</td>
                        <td className="px-3 py-2 truncate max-w-xs">{c.blocking_query || DASH}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {dbDiag.error && <p className="text-xs text-rose-400">{dbDiag.error}</p>}

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
                    {dbDiag.activeQueries.map((q, i) => (
                      <tr key={i} className="hover:bg-slate-800/40">
                        <td className="px-3 py-1.5 text-slate-400">{q.pid}</td>
                        <td className="px-3 py-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px]">
                            {q.state}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 truncate max-w-xs">{q.query}</td>
                        <td className="px-3 py-1.5 text-slate-400">{q.wait_event || DASH}</td>
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
