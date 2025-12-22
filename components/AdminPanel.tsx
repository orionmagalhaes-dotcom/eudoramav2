
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AppCredential, ClientDBRow, User } from '../types';
import { fetchCredentials, saveCredential, deleteCredential, getClientsUsingCredential } from '../services/credentialService';
import { getAllClients, saveClientToDB, deleteClientFromDB, restoreClient, permanentlyDeleteClient, hardDeleteAllClients, resetAllClientPasswords, resetAllNamesAndFixDates } from '../services/clientService';
import { Plus, Trash2, Edit2, LogOut, Users, Search, AlertTriangle, X, ShieldAlert, Key, Activity, Clock, CheckCircle2, RefreshCw, FileUp, MessageCircle, Phone, Copy, Check, Lock, Loader2, Eye, EyeOff, PieChart, Calendar, Download, Upload, Shield, ChevronDown, Filter, Moon, Sun, DollarSign, TrendingUp, ArrowRight, Wallet, ArrowUpRight, ArrowDownRight, Ban, LayoutGrid, SortAsc, SortDesc, RotateCw, BadgeDollarSign, FileSpreadsheet, ShieldCheck, UsersRound, CreditCard, Mail } from 'lucide-react';

interface AdminPanelProps {
  onLogout: () => void;
}

const SERVICES = ['Viki Pass', 'Kocowa+', 'IQIYI', 'WeTV', 'DramaBox', 'Youku'];

const CAPACITY_LIMITS: Record<string, number> = {
    'viki pass': 6,
    'kocowa+': 7,
    'iqiyi': 15,
    'wetv': 9999,
    'dramabox': 9999,
    'youku': 9999
};

const PRICES: Record<string, number> = {
    'viki': 19.90,
    'kocowa': 14.90,
    'iqiyi': 14.90,
    'wetv': 14.90,
    'dramabox': 14.90,
    'youku': 14.90,
    'default': 14.90
};

// Helper to handle CSV splitting that respects quotes
const parseCSVLine = (text: string) => {
    const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    return text.split(regex).map(val => val.replace(/^"|"$/g, '').trim());
};

const toLocalInput = (isoString: string) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        const offset = date.getTimezoneOffset() * 60000;
        const localDate = new Date(date.getTime() - offset);
        return localDate.toISOString().slice(0, 16);
    } catch(e) { return ''; }
};

// --- HELPER FUNCTIONS ---

function normalizeSubscriptions(subs: any): string[] {
    let list: any[] = [];
    if (Array.isArray(subs)) {
        list = subs;
    } else if (typeof subs === 'string') {
        let cleaned = (subs as string).replace(/^\{|\}$/g, '');
        if (!cleaned) {
            list = [];
        } else if (cleaned.includes(';')) {
            list = cleaned.split(';'); 
        } else if (cleaned.includes(',')) {
            list = cleaned.split(',');
        } else if (cleaned.includes('+')) {
            list = cleaned.split('+');
        } else {
            list = [cleaned];
        }
    }
    
    return (list || [])
        .map((s: any): string => {
            let str = String(s).trim().replace(/^"|"$/g, '');
            const parts = str.split('|');
            if (parts.length === 2) return `${str}|1`; 
            if (parts.length === 1 && parts[0] !== '') return `${str}|${new Date().toISOString()}|1`;
            return str;
        })
        .filter((s: string): boolean => s.length > 0 && s.toLowerCase() !== 'null' && s !== '""' && !s.startsWith('|'));
}

const calculateExpiry = (dateStr: string, months: number) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date(); 
    d.setMonth(d.getMonth() + months);
    return d;
};

const getDaysRemaining = (expiryDate: Date) => {
    const now = new Date();
    expiryDate.setHours(0,0,0,0);
    now.setHours(0,0,0,0);
    return Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

const getCredentialHealth = (service: string, publishedAt: string, currentUsers: number) => {
    const pubDate = new Date(publishedAt);
    const now = new Date();
    const diffTime = now.getTime() - pubDate.getTime();
    const daysActive = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    const serviceLower = service.toLowerCase();
    const limit = CAPACITY_LIMITS[serviceLower] || 10;
    
    let expiryLimit = 30;
    if (serviceLower.includes('viki')) expiryLimit = 14;
    else if (serviceLower.includes('kocowa')) expiryLimit = 25;
    
    const daysRemaining = expiryLimit - daysActive;
    const isOvercrowded = currentUsers >= limit && limit < 9000;

    if (daysRemaining < 0) return { label: 'Vencida', color: 'text-red-600 bg-red-50 border-red-200', icon: <AlertTriangle size={14}/> };
    if (isOvercrowded) return { label: 'Superlotada', color: 'text-purple-600 bg-purple-50 border-purple-200', icon: <UsersRound size={14}/> };
    if (daysRemaining <= 3) return { label: 'Vence em breve', color: 'text-orange-600 bg-orange-50 border-orange-200', icon: <Clock size={14}/> };
    
    return { label: 'Saudável', color: 'text-green-600 bg-green-50 border-green-200', icon: <CheckCircle2 size={14}/> };
};

export const AdminPanel: React.FC<AdminPanelProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'clients' | 'credentials' | 'finance' | 'danger'>('clients'); 
  const [clientFilterStatus, setClientFilterStatus] = useState<'all' | 'active' | 'expiring' | 'debtor' | 'trash'>('all');
  const [darkMode, setDarkMode] = useState(false);
  const [credentials, setCredentials] = useState<AppCredential[]>([]);
  const [clients, setClients] = useState<ClientDBRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingClient, setSavingClient] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  
  const [credForm, setCredForm] = useState<Partial<AppCredential>>({ service: SERVICES[0], email: '', password: '', isVisible: true, publishedAt: new Date().toISOString() });
  const [credSortOrder, setCredSortOrder] = useState<'asc' | 'desc'>('desc');
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [credModalOpen, setCredModalOpen] = useState(false);
  const [showClientPass, setShowClientPass] = useState(false);
  
  const [newSubService, setNewSubService] = useState(SERVICES[0]);
  const [newSubDate, setNewSubDate] = useState(new Date().toISOString().split('T')[0]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [lastFinancialReset, setLastFinancialReset] = useState<string>(() => {
      try {
          return localStorage.getItem('eudorama_finance_reset') || new Date().toISOString();
      } catch { return new Date().toISOString(); }
  });

  const [clientForm, setClientForm] = useState<Partial<ClientDBRow>>({
      phone_number: '', client_name: '', client_password: '', subscriptions: [], duration_months: 1, is_debtor: false, purchase_date: toLocalInput(new Date().toISOString())
  });

  useEffect(() => {
    loadData();
  }, []);

  const credentialUsage = useMemo<Record<string, number>>(() => {
      const usage: Record<string, number> = {};
      if (credentials.length === 0 || clients.length === 0) return usage;

      const activeClients = clients.filter(c => !c.deleted);
      activeClients.forEach(client => {
          normalizeSubscriptions(client.subscriptions || []).forEach(sub => {
              const parts = sub.split('|');
              const sName = parts[0].trim().toLowerCase();
              const serviceCreds = credentials
                  .filter(c => c.isVisible && c.service.toLowerCase().includes(sName))
                  .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
              
              if (serviceCreds.length > 0) {
                  const clientsForService = activeClients
                      .filter(c => normalizeSubscriptions(c.subscriptions || []).some(s => s.toLowerCase().includes(sName)))
                      .sort((a, b) => a.phone_number.localeCompare(b.phone_number));
                  
                  const rank = clientsForService.findIndex(c => c.id === client.id);
                  if (rank !== -1) {
                      const credIndex = rank % serviceCreds.length;
                      const assigned = serviceCreds[credIndex];
                      if (assigned) usage[assigned.id] = (usage[assigned.id] || 0) + 1;
                  }
              }
          });
      });
      return usage;
  }, [clients, credentials]);

  // Função Auxiliar para calcular atribuição síncrona para exibição no card
  const getAssignedAccount = (clientId: string, phoneNumber: string, serviceName: string) => {
      const cleanService = serviceName.toLowerCase().trim();
      const serviceCreds = credentials
          .filter(c => c.isVisible && !c.email.includes('demo') && c.service.toLowerCase().includes(cleanService))
          .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

      if (serviceCreds.length === 0) return null;

      const activeClientsWithService = clients
          .filter(c => !c.deleted && normalizeSubscriptions(c.subscriptions || []).some(s => s.toLowerCase().includes(cleanService)))
          .sort((a, b) => a.phone_number.localeCompare(b.phone_number));

      const userRank = activeClientsWithService.findIndex(c => c.id === clientId);
      if (userRank === -1) return serviceCreds[0];

      const credIndex = userRank % serviceCreds.length;
      return serviceCreds[credIndex];
  };

  const loadData = async () => {
    setLoading(true);
    try {
        const [creds, allClients] = await Promise.all([fetchCredentials(), getAllClients()]);
        setCredentials(creds.filter(c => c.service !== 'SYSTEM_CONFIG'));
        setClients(allClients);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleExportCSV = () => {
      if (clients.length === 0) return;
      const headers = ['id', 'phone_number', 'client_name', 'client_password', 'subscriptions', 'purchase_date', 'duration_months', 'is_debtor', 'deleted', 'created_at'];
      const rows = clients.map(c => [
          `"${c.id}"`,
          `"${c.phone_number}"`,
          `"${(c.client_name || '').replace(/"/g, '""')}"`,
          `"${(c.client_password || '').replace(/"/g, '""')}"`,
          `"${(c.subscriptions || []).join(';')}"`,
          `"${c.purchase_date}"`,
          c.duration_months,
          c.is_debtor ? '1' : '0',
          c.deleted ? '1' : '0',
          `"${c.created_at}"`
      ]);
      const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.body.appendChild(document.createElement("a"));
      const datestamp = new Date().toISOString().split('T')[0].replace(/-/g, '_');
      link.href = url;
      link.download = `backup_eudorama_${datestamp}.csv`;
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
          try {
              const text = event.target?.result as string;
              if (!text) throw new Error('Arquivo vazio');
              const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
              if (lines.length < 2) throw new Error('Cabeçalho não encontrado');
              
              setLoading(true);
              const importedCount = { success: 0, fail: 0 };
              
              for (let i = 1; i < lines.length; i++) {
                  const columns = parseCSVLine(lines[i]);
                  if (columns.length < 5) {
                      importedCount.fail++;
                      continue;
                  }
                  const payload: Partial<ClientDBRow> = {
                      phone_number: columns[1],
                      client_name: columns[2],
                      client_password: columns[3],
                      subscriptions: columns[4] ? columns[4].split(';') : [],
                      purchase_date: columns[5] || new Date().toISOString(),
                      duration_months: parseInt(columns[6]) || 1,
                      is_debtor: columns[7] === '1',
                      deleted: columns[8] === '1',
                  };
                  const res = await saveClientToDB(payload);
                  if (res.success) importedCount.success++;
                  else importedCount.fail++;
              }
              alert(`Importação concluída!\nSucesso: ${importedCount.success}\nFalhas: ${importedCount.fail}`);
              loadData();
          } catch (err: any) {
              alert(`Erro ao processar arquivo: ${err.message}`);
          } finally {
              setLoading(false);
              if (fileInputRef.current) fileInputRef.current.value = '';
          }
      };
      reader.onerror = () => alert("Erro ao ler o arquivo.");
      reader.readAsText(file);
  };

  const handleResetFinance = () => {
    const now = new Date().toISOString();
    setLastFinancialReset(now);
    try {
        localStorage.setItem('eudorama_finance_reset', now);
        const currentTrashIds = clients.filter(c => c.deleted).map(c => c.id);
        localStorage.setItem('eudorama_loss_baseline', JSON.stringify(currentTrashIds));
        alert("Simulador financeiro resetado com sucesso!");
    } catch { alert("Erro ao salvar reset local."); }
  };

  const groupedCredentials = useMemo<Record<string, AppCredential[]>>(() => {
      const sorted = [...credentials].sort((a, b) => {
          const timeA = new Date(a.publishedAt).getTime() || 0;
          const timeB = new Date(b.publishedAt).getTime() || 0;
          return credSortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      });
      const groups: Record<string, AppCredential[]> = {};
      sorted.forEach(c => {
          if (!groups[c.service]) groups[c.service] = [];
          groups[c.service].push(c);
      });
      return groups;
  }, [credentials, credSortOrder]);

  const financialProjection = useMemo(() => {
      let totalMonthlyRevenue = 0;
      let gainedRevenue = 0;
      let lostRevenue = 0;
      const serviceBreakdown: Record<string, { total: number, gained: number, lost: number }> = {};
      SERVICES.forEach(s => { serviceBreakdown[s] = { total: 0, gained: 0, lost: 0 }; });

      const resetDate = new Date(lastFinancialReset);
      let baselineLossIds: string[] = [];
      try {
          baselineLossIds = JSON.parse(localStorage.getItem('eudorama_loss_baseline') || '[]');
      } catch { baselineLossIds = []; }

      clients.forEach(c => {
          const subs = normalizeSubscriptions(c.subscriptions || []);
          const isNewClient = c.created_at ? new Date(c.created_at) >= resetDate : false;
          
          subs.forEach(s => {
              const parts = s.split('|');
              const rawName = parts[0].trim();
              const nameKey = rawName.toLowerCase();
              const isPaid = parts[2] === '1';

              let price = 14.90;
              let serviceMatch = SERVICES.find(srv => srv.toLowerCase() === nameKey) || 'Outros';

              for (const key of Object.keys(PRICES)) {
                  if (nameKey.includes(key)) {
                      price = PRICES[key];
                      break;
                  }
              }

              if (!serviceBreakdown[serviceMatch]) {
                  serviceBreakdown[serviceMatch] = { total: 0, gained: 0, lost: 0 };
              }

              if (!c.deleted && isPaid) {
                  totalMonthlyRevenue += price;
                  serviceBreakdown[serviceMatch].total += price;
                  if (isNewClient) {
                      gainedRevenue += price;
                      serviceBreakdown[serviceMatch].gained += price;
                  }
              } else if (c.deleted && !baselineLossIds.includes(c.id)) {
                  lostRevenue += price;
                  serviceBreakdown[serviceMatch].lost += price;
              }
          });
      });

      const netGrowth = gainedRevenue - lostRevenue;
      const daysSinceReset = Math.max(1, Math.ceil((new Date().getTime() - resetDate.getTime()) / (1000 * 60 * 60 * 24)));
      const projected30Days = totalMonthlyRevenue + ((netGrowth / daysSinceReset) * 30);
      
      return { totalMonthlyRevenue, gainedRevenue, lostRevenue, netGrowth, projected30Days, serviceBreakdown };
  }, [clients, lastFinancialReset]);

  const filteredClients = useMemo<ClientDBRow[]>(() => {
    let list = clients;
    if (clientFilterStatus === 'trash') list = list.filter(c => c.deleted);
    else list = list.filter(c => !c.deleted);
    
    if (clientFilterStatus === 'debtor') {
        list = list.filter(c => {
            const subs = normalizeSubscriptions(c.subscriptions || []);
            const hasUnpaid = subs.some(s => s.split('|')[2] === '0');
            const hasExpired = subs.some(s => getDaysRemaining(calculateExpiry(s.split('|')[1] || c.purchase_date, c.duration_months)) < 0);
            return c.is_debtor || hasUnpaid || hasExpired;
        });
    } else if (clientFilterStatus === 'active') {
        list = list.filter(c => {
            const subs = normalizeSubscriptions(c.subscriptions || []);
            const allPaid = subs.every(s => s.split('|')[2] === '1');
            const noneExpired = subs.every(s => getDaysRemaining(calculateExpiry(s.split('|')[1] || c.purchase_date, c.duration_months)) > 5);
            return !c.is_debtor && allPaid && noneExpired;
        });
    } else if (clientFilterStatus === 'expiring') {
        list = list.filter(c => normalizeSubscriptions(c.subscriptions || []).some(s => {
            const days = getDaysRemaining(calculateExpiry(s.split('|')[1] || c.purchase_date, c.duration_months));
            return days <= 5 && days >= 0;
        }));
    }
    if (clientSearch) {
        const lower = clientSearch.toLowerCase();
        list = list.filter(c => c.phone_number.includes(lower) || c.client_name?.toLowerCase().includes(lower));
    }
    return list;
  }, [clients, clientSearch, clientFilterStatus]);

  const handleSaveClient = async () => {
      setSavingClient(true);
      const res = await saveClientToDB(clientForm);
      if (!res.success) alert(res.msg);
      setSavingClient(false);
      setClientModalOpen(false);
      loadData();
  };

  const handleOpenClientModal = (client?: ClientDBRow) => {
      if (client) setClientForm(client);
      else setClientForm({ phone_number: '', client_name: '', client_password: '', subscriptions: [], duration_months: 1, is_debtor: false, purchase_date: toLocalInput(new Date().toISOString()) });
      setClientModalOpen(true);
      setShowClientPass(false);
  };

  const handleOpenCredModal = (cred?: AppCredential) => {
      if (cred) {
          setCredForm({
              ...cred,
              publishedAt: cred.publishedAt || new Date().toISOString()
          });
      } else {
          setCredForm({ service: SERVICES[0], email: '', password: '', isVisible: true, publishedAt: new Date().toISOString() });
      }
      setCredModalOpen(true);
  };

  const handleSaveCred = async () => {
      setLoading(true);
      await saveCredential(credForm as AppCredential);
      setCredModalOpen(false);
      loadData();
      setLoading(false);
  };

  const handleRenewSubscription = (sub: string) => {
      const parts = sub.split('|');
      const serviceName = parts[0];
      const today = new Date().toISOString();
      const updatedSubs = normalizeSubscriptions(clientForm.subscriptions || []).map(s => {
          if (s === sub) return `${serviceName}|${today}|1`;
          return s;
      });
      setClientForm({ ...clientForm, subscriptions: updatedSubs });
  };

  const handleToggleSubStatus = (sub: string) => {
      const parts = sub.split('|');
      const currentStatus = parts[2] || '1';
      const newStatus = currentStatus === '1' ? '0' : '1';
      const updatedSubs = normalizeSubscriptions(clientForm.subscriptions || []).map(s => {
          if (s === sub) return `${parts[0]}|${parts[1]}|${newStatus}`;
          return s;
      });
      setClientForm({ ...clientForm, subscriptions: updatedSubs });
  };

  return (
    <div className={`min-h-screen font-sans pb-10 transition-colors duration-300 ${darkMode ? "dark bg-slate-950 text-slate-100" : "bg-indigo-50/30 text-indigo-950"}`}>
      <div className="bg-white dark:bg-slate-900 px-6 py-5 flex justify-between items-center shadow-sm sticky top-0 z-30 mb-6 border-b border-indigo-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
              <div className="bg-indigo-600 p-2.5 rounded-2xl text-white shadow-lg">
                  <ShieldAlert className="w-7 h-7" />
              </div>
              <h1 className="font-black text-2xl">EuDorama Admin</h1>
          </div>
          <div className="flex items-center gap-3">
              <button onClick={() => setDarkMode(!darkMode)} className="p-3 rounded-full bg-indigo-50 dark:bg-slate-800 text-indigo-600 transition-colors">
                  {darkMode ? <Sun className="w-6 h-6"/> : <Moon className="w-6 h-6"/>}
              </button>
              <button onClick={onLogout} className="flex items-center gap-2 text-red-500 hover:bg-red-50 px-4 py-2 rounded-xl font-bold text-sm border border-red-100 transition-all">
                  <LogOut className="w-5 h-5" /> Sair
              </button>
          </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 space-y-8">
          <div className="flex bg-white dark:bg-slate-900 p-1.5 rounded-full shadow-sm border border-indigo-100 dark:border-slate-800 overflow-x-auto scrollbar-hide">
              {[
                  {id: 'clients', icon: Users, label: 'Clientes'},
                  {id: 'credentials', icon: Key, label: 'Contas'},
                  {id: 'finance', icon: DollarSign, label: 'Financeiro'},
                  {id: 'danger', icon: AlertTriangle, label: 'Perigo'}
              ].map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 py-3 px-6 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center justify-center gap-2 ${activeTab === tab.id ? 'bg-indigo-600 text-white shadow-md' : 'text-indigo-400 hover:bg-indigo-50'}`}>
                      <tab.icon className="w-5 h-5" /> {tab.label}
                  </button>
              ))}
          </div>

          {activeTab === 'clients' && (
              <div className="space-y-6 animate-fade-in pb-24">
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-4">
                      <div className="flex flex-wrap gap-3 mb-2">
                          <button onClick={handleExportCSV} className="flex-1 bg-indigo-50 text-indigo-600 px-4 py-3 rounded-2xl text-xs font-black uppercase flex items-center justify-center gap-2 hover:bg-indigo-100 transition-colors">
                              <Download size={16}/> Backup (CSV)
                          </button>
                          <button onClick={() => fileInputRef.current?.click()} className="flex-1 bg-emerald-50 text-emerald-600 px-4 py-3 rounded-2xl text-xs font-black uppercase flex items-center justify-center gap-2 hover:bg-emerald-100 transition-colors">
                              <Upload size={16}/> Importar (CSV)
                          </button>
                          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleImportCSV} className="hidden" />
                      </div>
                      <div className="flex items-center gap-3 bg-indigo-50 dark:bg-slate-800 px-5 py-4 rounded-3xl border border-indigo-100">
                          <Search className="w-6 h-6 text-indigo-400" />
                          <input className="bg-transparent outline-none text-base font-bold text-indigo-900 dark:text-white w-full" placeholder="Buscar por nome ou telefone..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                          {[
                              {id: 'all', label: 'Todos', color: 'bg-indigo-600 text-white'},
                              {id: 'active', label: 'Em Dia', color: 'bg-green-100 text-green-700'},
                              {id: 'expiring', label: 'Vencendo', color: 'bg-orange-100 text-orange-700'},
                              {id: 'debtor', label: 'Pendentes', color: 'bg-red-100 text-red-700'},
                              {id: 'trash', label: 'Lixeira', color: 'bg-gray-200 text-gray-600'}
                          ].map(f => (
                              <button key={f.id} onClick={() => setClientFilterStatus(f.id as any)} className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wide border transition-all ${clientFilterStatus === f.id ? f.color : 'bg-white dark:bg-slate-900 text-indigo-300 border-indigo-100'}`}>{f.label}</button>
                          ))}
                      </div>
                      <button onClick={() => handleOpenClientModal()} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-transform active:scale-95 shadow-lg shadow-indigo-100">
                          <Plus className="w-6 h-6"/> Novo Cliente
                      </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {filteredClients.map((client) => (
                          <div key={client.id} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-7 shadow-sm border border-indigo-50 dark:border-slate-800 hover:border-indigo-200 transition-all group relative overflow-hidden flex flex-col">
                              <div className="flex justify-between items-start mb-6">
                                  <div>
                                      <h3 className="font-black text-gray-900 dark:text-white text-xl leading-tight">{client.client_name || 'Sem Nome'}</h3>
                                      <p className="text-xs font-bold text-indigo-400 mt-1 flex items-center gap-1.5"><Phone size={12}/> {client.phone_number}</p>
                                  </div>
                                  <button onClick={() => handleOpenClientModal(client)} className="p-3.5 rounded-2xl bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"><Edit2 size={18}/></button>
                              </div>
                              
                              <div className="flex flex-wrap gap-2.5 mb-6">
                                  {(normalizeSubscriptions(client.subscriptions || []) as string[]).map((sub, i) => {
                                      const parts = sub.split('|');
                                      const expiry = calculateExpiry(parts[1] || client.purchase_date, client.duration_months);
                                      const daysLeft = getDaysRemaining(expiry);
                                      const isPaid = parts[2] === '1';

                                      let statusColor = "bg-green-100 text-green-700 border-green-200";
                                      if (!isPaid) statusColor = "bg-red-50 text-red-600 border-red-100";
                                      else if (daysLeft < 0) statusColor = "bg-red-100 text-red-700 border-red-200";
                                      else if (daysLeft <= 5) statusColor = "bg-orange-100 text-orange-700 border-orange-200";

                                      return (
                                          <div key={i} className={`px-3 py-2 rounded-2xl text-[10px] font-black uppercase border flex flex-col gap-0.5 shadow-sm transition-all ${statusColor}`}>
                                              <span className="flex items-center gap-1">{parts[0]} {!isPaid && <AlertTriangle size={10}/>}</span>
                                              <span className="opacity-70 text-[9px] font-bold">Vence: {expiry.toLocaleDateString('pt-BR')} ({daysLeft}d)</span>
                                          </div>
                                      );
                                  })}
                              </div>

                              {/* RE-ADICIONADO: Área de Acessos Atribuídos (O que o cliente vê) */}
                              <div className="mt-auto pt-5 border-t border-indigo-50 space-y-3">
                                  <p className="text-[10px] font-black uppercase text-indigo-300 tracking-widest px-1">Acessos Atribuídos:</p>
                                  <div className="space-y-2">
                                      {(normalizeSubscriptions(client.subscriptions || []) as string[]).map((sub, i) => {
                                          const parts = sub.split('|');
                                          const account = getAssignedAccount(client.id, client.phone_number, parts[0]);
                                          
                                          return (
                                              <div key={i} className="bg-indigo-50/50 dark:bg-slate-800/50 p-3 rounded-2xl border border-indigo-50/50 flex flex-col gap-1">
                                                  <span className="text-[9px] font-black text-indigo-400 uppercase tracking-tighter">{parts[0]}</span>
                                                  {account ? (
                                                      <div className="flex flex-col gap-0.5">
                                                          <div className="flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-100">
                                                              <Mail size={12} className="text-indigo-400"/>
                                                              <span className="truncate">{account.email}</span>
                                                          </div>
                                                          <div className="flex items-center gap-2 text-xs font-mono font-medium text-indigo-500">
                                                              <Lock size={12} className="text-indigo-300"/>
                                                              <span>{account.password}</span>
                                                          </div>
                                                      </div>
                                                  ) : (
                                                      <span className="text-[10px] font-bold text-gray-400 italic">Sem conta disponível</span>
                                                  )}
                                              </div>
                                          );
                                      })}
                                  </div>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          )}

          {activeTab === 'credentials' && (
              <div className="space-y-12 animate-fade-in pb-24">
                  <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-sm border border-indigo-100">
                      <div className="flex justify-between items-center mb-8">
                        <h3 className="font-bold text-2xl flex items-center gap-3"><Key className="text-indigo-600"/> Gestão de Contas</h3>
                        <button onClick={() => handleOpenCredModal()} className="bg-indigo-600 text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase flex items-center gap-2 transition-transform active:scale-95 shadow-md">
                            <Plus size={16}/> Adicionar Conta
                        </button>
                      </div>
                      
                      <div className="flex justify-end mb-6">
                        <button onClick={() => setCredSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} className="p-3 bg-indigo-50 rounded-2xl text-indigo-600 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider">
                            {credSortOrder === 'asc' ? <SortAsc size={14}/> : <SortDesc size={14}/>} Ordenar por Data
                        </button>
                      </div>

                      <div className="space-y-10">
                        {(Object.entries(groupedCredentials) as [string, AppCredential[]][]).map(([serviceName, creds]) => (
                            <div key={serviceName} className="space-y-4">
                                <h4 className="flex items-center gap-2 px-4 text-sm font-black text-indigo-400 uppercase tracking-widest">
                                    <LayoutGrid size={14}/> {serviceName}
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    {creds.map(c => {
                                        const count = credentialUsage[c.id] || 0;
                                        const health = getCredentialHealth(c.service, c.publishedAt, count);
                                        const serviceLimit = CAPACITY_LIMITS[c.service.toLowerCase()] || 10;
                                        
                                        return (
                                            <div key={c.id} className="bg-white dark:bg-slate-900 p-7 rounded-[2.5rem] shadow-sm border border-indigo-50 hover:border-indigo-200 transition-all">
                                                <div className="flex justify-between items-center mb-5">
                                                    <div className={`px-3 py-1.5 rounded-xl flex items-center gap-2 text-[10px] font-black uppercase border ${health.color}`}>
                                                        {health.icon} {health.label}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button onClick={() => handleOpenCredModal(c)} className="text-gray-400 hover:text-indigo-600 transition-colors"><Edit2 size={18}/></button>
                                                        <button onClick={async () => { if(confirm("Excluir conta?")) {await deleteCredential(c.id); loadData();} }} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={18}/></button>
                                                    </div>
                                                </div>
                                                <p className="font-bold text-indigo-950 dark:text-white text-lg break-all">{c.email}</p>
                                                <p className="font-mono text-sm text-indigo-400 mt-1 bg-indigo-50/50 p-2 rounded-lg inline-block">{c.password}</p>
                                                <div className="mt-6 pt-5 border-t border-indigo-50 flex justify-between items-center text-xs font-bold text-gray-400">
                                                    <span className="flex items-center gap-1.5"><Calendar size={14}/> {new Date(c.publishedAt).toLocaleDateString('pt-BR')}</span>
                                                    <span className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${count >= serviceLimit && serviceLimit < 9000 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                                        <Users size={14}/> {count}{serviceLimit < 9000 ? `/${serviceLimit}` : ''} ativos
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                      </div>
                  </div>
              </div>
          )}

          {activeTab === 'finance' && (
              <div className="space-y-8 animate-fade-in pb-24">
                  <div className="bg-gradient-to-br from-indigo-600 to-blue-700 text-white p-8 rounded-[3rem] shadow-2xl relative overflow-hidden">
                      <div className="relative z-10 flex justify-between items-start">
                          <div className="text-left">
                              <p className="text-indigo-100 font-bold text-sm uppercase tracking-widest mb-2">Faturamento Mensal Atual</p>
                              <h2 className="text-5xl font-black">R$ {financialProjection.totalMonthlyRevenue.toFixed(2).replace('.', ',')}</h2>
                              <div className="mt-6 flex gap-4">
                                  <div className="bg-white/20 px-4 py-2 rounded-xl backdrop-blur-sm"><p className="text-[10px] uppercase font-bold text-indigo-200">Ganhos (Total)</p><p className="font-black text-green-300">+ R$ {financialProjection.gainedRevenue.toFixed(2)}</p></div>
                                  <div className="bg-white/20 px-4 py-2 rounded-xl backdrop-blur-sm"><p className="text-[10px] uppercase font-bold text-indigo-200">Perdas (Total)</p><p className="font-black text-red-300">- R$ {financialProjection.lostRevenue.toFixed(2)}</p></div>
                              </div>
                          </div>
                          <button onClick={handleResetFinance} className="bg-white/10 hover:bg-white/20 p-4 rounded-2xl backdrop-blur-sm border border-white/20 transition-all flex flex-col items-center gap-1">
                              <RefreshCw className="w-6 h-6"/>
                              <span className="text-[10px] font-black uppercase">Resetar</span>
                          </button>
                      </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-sm border border-indigo-100 text-center">
                      <h3 className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-4">Projeção Próximos 30 Dias</h3>
                      <div className={`text-6xl font-black ${financialProjection.netGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          R$ {financialProjection.projected30Days.toFixed(2).replace('.', ',')}
                      </div>
                      <p className="text-sm text-gray-500 mt-4 font-medium italic">Baseado no ritmo de crescimento/evasão desde {new Date(lastFinancialReset).toLocaleDateString()}.</p>
                  </div>

                  <div className="space-y-4">
                      <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest px-4">Desempenho por Aplicativo</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {(Object.entries(financialProjection.serviceBreakdown) as [string, { total: number, gained: number, lost: number }][])
                            .filter(([_, data]) => data.total > 0 || data.gained > 0 || data.lost > 0)
                            .map(([name, data]) => (
                              <div key={name} className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-sm border border-indigo-50 flex flex-col gap-4">
                                  <div className="flex justify-between items-center">
                                      <span className="font-black text-indigo-900 dark:text-white text-lg">{name}</span>
                                      <span className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider">R$ {data.total.toFixed(2)}</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                      <div className="bg-green-50 p-3 rounded-2xl border border-green-100">
                                          <p className="text-[9px] font-black text-green-700 uppercase mb-0.5 flex items-center gap-1"><ArrowUpRight size={10}/> Ganho</p>
                                          <p className="font-black text-green-600 text-sm">+R$ {data.gained.toFixed(2)}</p>
                                      </div>
                                      <div className="bg-red-50 p-3 rounded-2xl border border-red-100">
                                          <p className="text-[9px] font-black text-red-700 uppercase mb-0.5 flex items-center gap-1"><ArrowDownRight size={10}/> Perda</p>
                                          <p className="font-black text-red-600 text-sm">-R$ {data.lost.toFixed(2)}</p>
                                      </div>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          )}

          {activeTab === 'danger' && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-10 animate-fade-in pb-24">
                  <div className="bg-red-50 p-8 rounded-full animate-pulse">
                      <Shield className="w-16 h-16 text-red-500" />
                  </div>
                  <div className="text-center">
                      <h2 className="text-3xl font-black text-red-600 mb-3">Zona de Perigo</h2>
                  </div>
                  <div className="w-full max-w-md space-y-5 px-4">
                      <button onClick={async () => { if(confirm("Mestre, deseja resetar TODAS as senhas dos clientes?")) await resetAllClientPasswords(); loadData(); }} className="w-full bg-white border-2 border-red-100 text-red-500 font-bold py-5 rounded-3xl shadow-sm hover:bg-red-50 transition-colors text-lg">
                          Resetar Senhas Clientes
                      </button>
                      <button onClick={async () => { if(prompt("DIGITE 1202 PARA APAGAR TUDO") === "1202") await hardDeleteAllClients(); loadData(); }} className="w-full bg-red-600 text-white font-bold py-5 rounded-3xl shadow-xl hover:bg-red-700 transition-transform active:scale-95 text-lg">
                          DESTRUIR BANCO DE DADOS
                      </button>
                  </div>
              </div>
          )}
      </main>

      {credModalOpen && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative animate-slide-up border-4 border-indigo-50">
                  <div className="flex justify-between items-center mb-8">
                      <h3 className="font-extrabold text-2xl text-indigo-950 dark:text-white leading-none">{credForm.id ? 'Editar Conta' : 'Nova Conta'}</h3>
                      <button onClick={() => setCredModalOpen(false)} className="p-3 bg-indigo-50 rounded-full hover:bg-indigo-100 transition-colors"><X className="w-6 h-6 text-indigo-400"/></button>
                  </div>
                  <div className="space-y-5">
                      <div className="bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl">
                          <label className="text-xs font-black uppercase text-indigo-400 mb-1 block">Serviço</label>
                          <select className="w-full bg-transparent font-bold text-gray-800 dark:text-white outline-none" value={credForm.service} onChange={e => setCredForm({...credForm, service: e.target.value})}>
                              {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                      </div>
                      <div className="bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl">
                          <label className="text-xs font-black uppercase text-indigo-400 mb-1 block">E-mail</label>
                          <input className="w-full bg-transparent font-bold text-gray-800 dark:text-white outline-none" value={credForm.email} onChange={e => setCredForm({...credForm, email: e.target.value})} placeholder="email@exemplo.com" />
                      </div>
                      <div className="bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl">
                          <label className="text-xs font-black uppercase text-indigo-400 mb-1 block">Senha</label>
                          <input className="w-full bg-transparent font-bold text-gray-800 dark:text-white outline-none" value={credForm.password} onChange={e => setCredForm({...credForm, password: e.target.value})} placeholder="******" />
                      </div>
                      <div className="bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl">
                          <label className="text-xs font-black uppercase text-indigo-400 mb-1 block">Data de Publicação</label>
                          <input type="datetime-local" className="w-full bg-transparent font-bold text-gray-800 dark:text-white outline-none" value={toLocalInput(credForm.publishedAt || new Date().toISOString())} onChange={e => setCredForm({...credForm, publishedAt: new Date(e.target.value).toISOString()})} />
                      </div>
                      <button onClick={handleSaveCred} disabled={loading} className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-xl hover:scale-[1.02] transition-transform flex justify-center items-center">
                          {loading ? <Loader2 className="animate-spin w-5 h-5"/> : 'Salvar Dados'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {clientModalOpen && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative animate-slide-up max-h-[90vh] overflow-y-auto border-4 border-indigo-50">
                  <div className="flex justify-between items-center mb-8">
                      <h3 className="font-extrabold text-2xl text-indigo-950 dark:text-white leading-none">{clientForm.id ? 'Editar Cliente' : 'Novo Cliente'}</h3>
                      <button onClick={() => setClientModalOpen(false)} className="p-3 bg-indigo-50 rounded-full hover:bg-indigo-100 transition-colors"><X className="w-6 h-6 text-indigo-400"/></button>
                  </div>
                  <div className="space-y-6">
                      <div className="bg-indigo-50 dark:bg-slate-800 p-5 rounded-3xl">
                          <label className="text-xs font-bold text-indigo-400 uppercase block mb-1.5 ml-1">WhatsApp</label>
                          <input className="w-full bg-transparent text-xl font-bold outline-none" value={clientForm.phone_number} onChange={e => setClientForm({...clientForm, phone_number: e.target.value})} placeholder="88999991234" />
                      </div>
                      <div className="bg-indigo-50 dark:bg-slate-800 p-5 rounded-3xl">
                          <label className="text-xs font-bold text-indigo-400 uppercase block mb-1.5 ml-1">Nome Completo</label>
                          <input className="w-full bg-transparent text-xl font-bold outline-none" value={clientForm.client_name} onChange={e => setClientForm({...clientForm, client_name: e.target.value})} placeholder="Ex: Maria Silva" />
                      </div>

                      <div className="bg-indigo-50 dark:bg-slate-800 p-5 rounded-3xl">
                          <label className="text-xs font-bold text-indigo-400 uppercase block mb-1.5 ml-1">Senha de Acesso</label>
                          <div className="flex items-center gap-2">
                              <input 
                                  type={showClientPass ? "text" : "password"} 
                                  className="w-full bg-transparent text-xl font-bold outline-none" 
                                  value={clientForm.client_password || ''} 
                                  onChange={e => setClientForm({...clientForm, client_password: e.target.value})} 
                                  placeholder="Senha do cliente..." 
                              />
                              <button type="button" onClick={() => setShowClientPass(!showClientPass)} className="text-indigo-400 hover:text-indigo-600 transition-colors">
                                  {showClientPass ? <EyeOff size={20} /> : <Eye size={20} />}
                              </button>
                          </div>
                      </div>
                      
                      <div className="pt-4 space-y-4">
                          <p className="text-xs font-black uppercase text-indigo-400 tracking-wider">Gestão de Assinaturas</p>
                          <div className="space-y-3">
                              {(normalizeSubscriptions(clientForm.subscriptions || []) as string[]).map((sub, i) => {
                                  const parts = sub.split('|');
                                  const expiry = calculateExpiry(parts[1] || clientForm.purchase_date || new Date().toISOString(), clientForm.duration_months || 1);
                                  const isPaid = parts[2] === '1';

                                  return (
                                      <div key={i} className="flex flex-col p-5 bg-white dark:bg-slate-800 border border-indigo-50 rounded-[2rem] shadow-sm gap-4">
                                          <div className="flex justify-between items-center">
                                              <div>
                                                  <p className="font-black text-indigo-950 dark:text-white text-lg">{parts[0]}</p>
                                                  <p className="text-[10px] text-indigo-300 font-bold uppercase tracking-widest">Expira em: {expiry.toLocaleDateString('pt-BR')}</p>
                                              </div>
                                              <button 
                                                  onClick={() => setClientForm({...clientForm, subscriptions: normalizeSubscriptions(clientForm.subscriptions || []).filter(s => s !== sub)})} 
                                                  className="p-3 bg-red-50 text-red-500 rounded-2xl hover:bg-red-100 transition-all shadow-sm"
                                              >
                                                  <Trash2 size={18} />
                                              </button>
                                          </div>
                                          
                                          <div className="grid grid-cols-2 gap-2">
                                              <button 
                                                  onClick={() => handleToggleSubStatus(sub)}
                                                  className={`flex-1 py-3.5 rounded-xl font-black text-[10px] uppercase flex items-center justify-center gap-2 border-2 transition-all ${isPaid ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-gray-100 text-gray-400'}`}
                                              >
                                                  {isPaid ? <ShieldCheck size={16}/> : <AlertTriangle size={16}/>}
                                                  {isPaid ? 'Cobrado' : 'Pendente'}
                                              </button>
                                              <button 
                                                  onClick={() => handleRenewSubscription(sub)} 
                                                  className="flex-1 py-3.5 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all shadow-sm border-2 border-transparent font-black text-[10px] uppercase flex items-center justify-center gap-2"
                                              >
                                                  <RotateCw size={16} /> Renovar
                                              </button>
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>

                          <div className="p-6 bg-indigo-50 dark:bg-slate-800 rounded-[2.5rem] space-y-3 border border-indigo-100">
                              <p className="text-[10px] font-black uppercase text-indigo-400">Novo Aplicativo</p>
                              <div className="space-y-2">
                                  <select className="w-full bg-white dark:bg-slate-900 p-3 rounded-2xl font-bold text-xs outline-none border border-indigo-100" value={newSubService} onChange={e => setNewSubService(e.target.value)}>
                                      {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                  <div className="flex gap-2">
                                      <input type="date" className="flex-1 bg-white dark:bg-slate-900 p-3 rounded-2xl font-bold text-xs border border-indigo-100 outline-none" value={newSubDate} onChange={e => setNewSubDate(e.target.value)} />
                                      <button onClick={() => {
                                          const subDate = new Date(newSubDate).toISOString();
                                          setClientForm({...clientForm, subscriptions: [...normalizeSubscriptions(clientForm.subscriptions || []), `${newSubService}|${subDate}|1`]});
                                      }} className="bg-indigo-950 text-white p-3 rounded-2xl hover:bg-black transition-all shadow-md">
                                          <Plus size={20}/>
                                      </button>
                                  </div>
                              </div>
                          </div>
                      </div>

                      <button onClick={handleSaveClient} disabled={savingClient} className="w-full bg-indigo-600 text-white font-black py-5 rounded-[2.5rem] shadow-2xl mt-6 hover:scale-[1.02] active:scale-95 transition-all">
                          {savingClient ? <Loader2 className="w-6 h-6 animate-spin mx-auto"/> : 'Salvar Alterações'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
