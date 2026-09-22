import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { AccountOverview } from './components/AccountOverview';
import { TransferModal } from './components/TransferModal';
import { TransactionHistory } from './components/TransactionHistory';
import { AIAdvisorFeed } from './components/AIAdvisorFeed';
import { OperationsIncidentConsole } from './components/OperationsIncidentConsole';
import { ETLViewer } from './components/ETLViewer';
import { api } from './services/api';
import { aiEngineLabel } from './utils/aiEngine';
import { Account, Transaction, AIRecommendation } from './types';
import { RefreshCw, Shield, Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('banking');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadData = async () => {
    try {
      const [accs, txs, recs] = await Promise.all([
        api.getAccounts(),
        api.getTransactions(30),
        api.getRecommendations(),
      ]);

      setAccounts(accs);
      if (accs.length > 0 && !selectedAccount) {
        setSelectedAccount(accs[0]);
      } else if (selectedAccount) {
        const updated = accs.find((a) => a.id === selectedAccount.id);
        if (updated) setSelectedAccount(updated);
      }

      setTransactions(txs);
      setRecommendations(recs);
    } catch (err) {
      console.error('Error cargando datos de SmartBancs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const unreadAiCount = recommendations.filter((r) => !r.isRead).length;

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white">
      {/* Top Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        unreadAiCount={unreadAiCount}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
            <p className="text-xs text-slate-400 font-medium">Sincronizando SmartBancs Core...</p>
          </div>
        ) : (
          <>
            {activeTab === 'banking' && (
              <div className="space-y-6 animate-fadeIn">
                <AccountOverview
                  accounts={accounts}
                  selectedAccount={selectedAccount}
                  onSelectAccount={(acc) => setSelectedAccount(acc)}
                  onOpenTransferModal={() => setIsTransferModalOpen(true)}
                />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    <TransactionHistory
                      transactions={transactions}
                      currentAccountNumber={selectedAccount?.accountNumber}
                      onRefresh={loadData}
                    />
                  </div>

                  <div className="space-y-5">
                    {/* Recent Financial Intelligence Widget */}
                    <div className="bank-card rounded-xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Sparkles className="w-4 h-4 text-blue-400" />
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                            Análisis Cognitivo Reciente
                          </h4>
                        </div>
                        <button
                          onClick={() => setActiveTab('ai-advisor')}
                          className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold flex items-center space-x-1"
                        >
                          <span>Ver historial</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>

                      {recommendations.length > 0 ? (
                        <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-200">{recommendations[0].title}</span>
                            <span className="text-[10px] font-mono text-blue-400 font-bold">
                              {(Number(recommendations[0].confidenceScore) * 100).toFixed(0)}% Conf.
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
                            {recommendations[0].message}
                          </p>
                          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                            <span>Motor: {aiEngineLabel(recommendations[0])}</span>
                            <span>#{recommendations[0].accountNumber}</span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 py-2">
                          Emite transferencias para visualizar las evaluaciones financieras y alertas generadas de forma asíncrona.
                        </p>
                      )}
                    </div>

                    {/* Operational & SLA Guarantees Card */}
                    <div className="bank-card rounded-xl p-5 space-y-3">
                      <div className="flex items-center space-x-2 text-slate-200">
                        <Shield className="w-4 h-4 text-blue-400" />
                        <h4 className="text-xs font-bold uppercase tracking-wider">Garantías de Diseño Operativo</h4>
                      </div>
                      <ul className="text-xs text-slate-300 space-y-2.5">
                        <li className="flex items-start space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                          <span><strong>Bloqueo Pesimista Ordenado:</strong> Orden determinista de locks: evita la espera circular entre transferencias cruzadas.</span>
                        </li>
                        <li className="flex items-start space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                          <span><strong>Transactional Outbox:</strong> el evento se guarda en la misma transacción y un relay lo publica en RabbitMQ fuera del camino crítico.</span>
                        </li>
                        <li className="flex items-start space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                          <span><strong>Trazabilidad Distribuida:</strong> Propagación continua de <code className="text-blue-300">x-correlation-id</code>.</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'ai-advisor' && (
              <div className="animate-fadeIn">
                <AIAdvisorFeed
                  recommendations={recommendations}
                  onRefresh={loadData}
                />
              </div>
            )}

            {activeTab === 'operations' && (
              <div className="animate-fadeIn">
                <OperationsIncidentConsole />
              </div>
            )}

            {activeTab === 'etl-bancs' && (
              <div className="animate-fadeIn">
                <ETLViewer />
              </div>
            )}
          </>
        )}
      </main>

      {/* Transfer Modal Dialog */}
      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        accounts={accounts}
        defaultSourceAccount={selectedAccount}
        onSuccess={() => {
          setIsTransferModalOpen(false);
          loadData();
        }}
      />

      {/* Minimalist Corporate Footer */}
      <footer className="border-t border-slate-800/80 bg-[#0e1422] py-4 text-center text-[11px] text-slate-400">
        <p>SmartBancs App — Plataforma de Banca Transaccional, Observabilidad e Inteligencia Artificial</p>
      </footer>
    </div>
  );
};

export default App;
