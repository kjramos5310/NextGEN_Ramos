import React from 'react';
import { Building2, Activity, Database, Sparkles, CheckCircle2 } from 'lucide-react';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  unreadAiCount: number;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, unreadAiCount }) => {
  return (
    <header className="border-b border-slate-800 bg-[#0e1422] sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand & Corporate Logo */}
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shadow-sm">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-bold tracking-tight text-white">
                  SmartBancs
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Banca Digital
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Plataforma Transaccional de Alta Concurrencia</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center space-x-1">
            <button
              onClick={() => setActiveTab('banking')}
              className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'banking'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              Cuentas & Transferencias
            </button>

            <button
              onClick={() => setActiveTab('ai-advisor')}
              className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors relative ${
                activeTab === 'ai-advisor'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center space-x-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-300" />
                <span>Análisis Cognitivo (Gemini)</span>
                {unreadAiCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-blue-500 text-white">
                    {unreadAiCount}
                  </span>
                )}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('operations')}
              className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'operations'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center space-x-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>Simulación de Quincena (SRE)</span>
              </span>
            </button>

            <button
              onClick={() => setActiveTab('etl-bancs')}
              className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'etl-bancs'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center space-x-1.5">
                <Database className="w-3.5 h-3.5 text-amber-400" />
                <span>Integración Core Bancs</span>
              </span>
            </button>
          </nav>

          {/* System Status Indicators */}
          <div className="flex items-center space-x-2.5">
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="font-mono text-slate-400">PostgreSQL ACID</span>
            </div>
            <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
              <span>SLA &lt; 2s</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
