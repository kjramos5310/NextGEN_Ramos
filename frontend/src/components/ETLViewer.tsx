import React, { useState } from 'react';
import { Database, ArrowRight, CheckCircle2, AlertCircle, FileCode, Layers, ShieldCheck } from 'lucide-react';

export const ETLViewer: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'architecture' | 'dataset'>('architecture');

  const rawSample = [
    { id: 'TX-9001', src: '1000000001', tgt: '1000000002', amount: '$ 1,500.00', curr: 'USD', dt: '2026/09/15 08:30:00', type: '01', note: 'Pago de servicios' },
    { id: 'TX-9002', src: '1000000002', tgt: '1000000003', amount: '320.50', curr: 'usd', dt: '15-09-2026 09:12:15', type: '02', note: 'Transferencia a comercio' },
    { id: 'TX-9003', src: '1000000003', tgt: '1000000001', amount: '$ 4,200.00', curr: 'NULL', dt: '2026-09-15T11:45:00Z', type: '01', note: 'NULL' },
    { id: 'TX-9004', src: '1000000004', tgt: '1000000002', amount: 'NaN', curr: 'USD', dt: '2026.09.15 14:00:22', type: '99', note: 'Error en taquilla' },
    { id: 'TX-9007', src: 'NULL', tgt: '1000000001', amount: '50.00', curr: 'USD', dt: '2026-09-17 12:00:00', type: 'NULL', note: 'Transaccion huerfana' },
    { id: 'TX-9001', src: '1000000001', tgt: '1000000002', amount: '$ 1,500.00', curr: 'USD', dt: '2026/09/15 08:30:00', type: '01', note: 'Pago de servicios (Duplicado)' },
  ];

  const cleanedSample = [
    { id: 'TX-9001', src: '1000000001', tgt: '1000000002', amount: 1500.0, curr: 'USD', dt: '2026-09-15T08:30:00Z', cat: 'TRANSFER', highVal: true, risk: 0.15 },
    { id: 'TX-9002', src: '1000000002', tgt: '1000000003', amount: 320.5, curr: 'USD', dt: '2026-09-15T09:12:15Z', cat: 'SHOPPING', highVal: false, risk: 0.10 },
    { id: 'TX-9003', src: '1000000003', tgt: '1000000001', amount: 4200.0, curr: 'USD', dt: '2026-09-15T11:45:00Z', cat: 'TRANSFER', highVal: true, risk: 0.05 },
    { id: 'TX-9005', src: '1000000001', tgt: '1000000004', amount: 85.0, curr: 'USD', dt: '2026-09-16T19:30:11Z', cat: 'FOOD_ENTERTAINMENT', highVal: false, risk: 0.20 },
    { id: 'TX-9006', src: '1000000005', tgt: '1000000003', amount: 12500.0, curr: 'USD', dt: '2026-09-17T10:00:00Z', cat: 'TRANSFER', highVal: true, risk: 0.02 },
  ];

  return (
    <div className="space-y-5">
      <div className="bank-card rounded-xl p-5">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Integración con Core Legado (Bancs) & Pipeline ETL
              </h3>
              <p className="text-xs text-slate-400">
                Estrategia de sincronización asíncrona sin saturar el core bancario legado y preparación de datos
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 bg-slate-900 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => setActiveSubTab('architecture')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                activeSubTab === 'architecture'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Estrategia de Arquitectura
            </button>
            <button
              onClick={() => setActiveSubTab('dataset')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                activeSubTab === 'dataset'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Auditoría Raw vs Cleaned
            </button>
          </div>
        </div>
      </div>

      {activeSubTab === 'architecture' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bank-card p-5 rounded-xl space-y-2.5">
            <div className="w-7 h-7 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-400 font-bold text-xs font-mono">
              01
            </div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Transactional Outbox + Buffer Asíncrono</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Las transacciones procesadas por la API SmartBancs depositan un mensaje en la cola RabbitMQ (<code className="text-blue-300">smartbancs.bancs.sync.queue</code>). Un worker consumidor con <strong>Rate Limiting</strong> envía batches controlados al Core Bancs en ventanas de baja concurrencia, protegiendo su CPU.
            </p>
          </div>

          <div className="bank-card p-5 rounded-xl space-y-2.5">
            <div className="w-7 h-7 rounded-md bg-emerald-500/10 flex items-center justify-center text-emerald-400 font-bold text-xs font-mono">
              02
            </div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Change Data Capture (CDC Ingress)</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Para los movimientos originados en sucursales físicas sobre Bancs, se implementa CDC sobre los logs de base de datos sin lanzar consultas pesadas (<code className="text-emerald-300">SELECT *</code>) en las tablas de producción del core legado.
            </p>
          </div>

          <div className="bank-card p-5 rounded-xl space-y-2.5">
            <div className="w-7 h-7 rounded-md bg-amber-500/10 flex items-center justify-center text-amber-400 font-bold text-xs font-mono">
              03
            </div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Feature Engineering para IA</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              El script Python (<code className="text-amber-300">etl_bancs_processor.py</code>) desduplica registros, unifica formatos ISO-8601 y calcula variables predictivas (<code className="text-slate-300">channelRiskScore</code>, <code className="text-slate-300">logAmount</code>) para el feature store.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bank-card rounded-xl p-4">
            <div className="flex items-center space-x-2 text-rose-400 text-xs font-semibold mb-2">
              <AlertCircle className="w-4 h-4" />
              <span>Dataset Crudo de Bancs (Con Nulos, NaN, Duplicados y Fechas No Estandarizadas)</span>
            </div>
            <div className="overflow-x-auto rounded border border-slate-800">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-3 py-1.5">TX_ID</th>
                    <th className="px-3 py-1.5">SRC</th>
                    <th className="px-3 py-1.5">TGT</th>
                    <th className="px-3 py-1.5">AMOUNT</th>
                    <th className="px-3 py-1.5">CURR</th>
                    <th className="px-3 py-1.5">DATE_RAW</th>
                    <th className="px-3 py-1.5">NOTA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {rawSample.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-800/30">
                      <td className="px-3 py-1 text-slate-400">{r.id}</td>
                      <td className="px-3 py-1">{r.src}</td>
                      <td className="px-3 py-1">{r.tgt}</td>
                      <td className="px-3 py-1 text-amber-400">{r.amount}</td>
                      <td className="px-3 py-1">{r.curr}</td>
                      <td className="px-3 py-1">{r.dt}</td>
                      <td className="px-3 py-1 text-slate-400">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bank-card rounded-xl p-4">
            <div className="flex items-center space-x-2 text-emerald-400 text-xs font-semibold mb-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Salida Limpia del Pipeline ETL (Normalizada y Lista para Features de IA)</span>
            </div>
            <div className="overflow-x-auto rounded border border-slate-800">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-3 py-1.5">ID</th>
                    <th className="px-3 py-1.5">ORIGEN</th>
                    <th className="px-3 py-1.5">DESTINO</th>
                    <th className="px-3 py-1.5">AMOUNT (FLOAT)</th>
                    <th className="px-3 py-1.5">FECHA (ISO-8601)</th>
                    <th className="px-3 py-1.5">CATEGORIA</th>
                    <th className="px-3 py-1.5">CHANNEL RISK</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {cleanedSample.map((c, i) => (
                    <tr key={i} className="hover:bg-slate-800/30">
                      <td className="px-3 py-1 text-slate-400">{c.id}</td>
                      <td className="px-3 py-1">#{c.src}</td>
                      <td className="px-3 py-1">#{c.tgt}</td>
                      <td className="px-3 py-1 text-emerald-400 font-bold">${c.amount.toFixed(2)}</td>
                      <td className="px-3 py-1 text-slate-300">{c.dt}</td>
                      <td className="px-3 py-1 text-blue-300">{c.cat}</td>
                      <td className="px-3 py-1 text-slate-300">{c.risk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
