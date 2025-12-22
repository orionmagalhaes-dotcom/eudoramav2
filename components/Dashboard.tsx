
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { User, AppCredential } from '../types';
import { getAssignedCredential } from '../services/credentialService';
import { getAllClients, updateClientName, updateClientPreferences } from '../services/clientService';
import { 
  Copy, Check, CreditCard, Star, Crown, Sparkles, Loader2, 
  RotateCw, Key, Smartphone, Mail, Lock, AlertTriangle, PlusCircle, ArrowRight, Edit3, Fingerprint, ShieldAlert, Palette, Camera, X, CheckCircle2, Upload, Trash2
} from 'lucide-react';

interface DashboardProps {
  user: User;
  onOpenSupport: () => void;
  onOpenCheckout: (type: 'renewal' | 'gift' | 'new_sub' | 'early_renewal', targetService?: string) => void;
  showPalette: boolean; 
  setShowPalette: (show: boolean) => void;
  onUpdateUser: (updatedUser: User) => void;
  syncTrigger?: number; // Recebe o trigger de refresh real-time
}

const THEME_OPTIONS = [
    { name: 'Rosa Dorama', color: 'bg-pink-50', value: 'pink' },
    { name: 'Lavanda', color: 'bg-purple-50', value: 'purple' },
    { name: 'Céu Azul', color: 'bg-blue-50', value: 'blue' },
    { name: 'Menta', color: 'bg-emerald-50', value: 'emerald' },
    { name: 'Âmbar', color: 'bg-amber-50', value: 'amber' },
    { name: 'Noite', color: 'bg-slate-900', value: 'dark' },
];

const ALL_POSSIBLE_SERVICES = [
    { name: 'Viki Pass', price: '19,90', color: 'from-blue-500 to-indigo-600', icon: '💎' },
    { name: 'Kocowa+', price: '14,90', color: 'from-pink-500 to-rose-600', icon: '✨' },
    { name: 'IQIYI', price: '14,90', color: 'from-emerald-400 to-teal-600', icon: '🐉' },
    { name: 'WeTV', price: '14,90', color: 'from-orange-400 to-red-500', icon: '🏹' },
    { name: 'DramaBox', price: '14,90', color: 'from-purple-500 to-violet-700', icon: '🎬' },
    { name: 'Youku', price: '14,90', color: 'from-cyan-400 to-blue-500', icon: '🎋' }
];

const Dashboard: React.FC<DashboardProps> = ({ user, onOpenCheckout, showPalette, setShowPalette, onUpdateUser, syncTrigger = 0 }) => {
  const [mergedData, setMergedData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(user.name);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validServices = useMemo(() => (user.services || []).filter(s => s && s.trim().length > 0), [user.services]);
  const availableToBuy = useMemo(() => ALL_POSSIBLE_SERVICES.filter(s => !validServices.some(v => v.includes(s.name))), [validServices]);

  const expiredServices = useMemo(() => {
      return mergedData.filter(item => item.daysLeft < 0);
  }, [mergedData]);

  // Classes de fundo baseadas no tema
  const getBgClass = () => {
      switch(user.themeColor) {
          case 'purple': return 'bg-purple-50';
          case 'blue': return 'bg-blue-50';
          case 'emerald': return 'bg-emerald-50';
          case 'amber': return 'bg-amber-50';
          case 'dark': return 'bg-slate-950';
          default: return 'bg-pink-50';
      }
  };

  const getTextColorClass = () => user.themeColor === 'dark' ? 'text-white' : 'text-gray-900';
  const getSubTextColorClass = () => user.themeColor === 'dark' ? 'text-slate-400' : 'text-gray-400';

  useEffect(() => {
      const loadUnifiedData = async () => {
          // Mantém o loading visível apenas se não for um refresh silencioso (opcional)
          setLoading(true);
          const allClients = await getAllClients();
          const results = await Promise.all(validServices.map(async (raw) => {
              const name = raw.split('|')[0].trim();
              let details = user.subscriptionDetails ? user.subscriptionDetails[name] : null;
              let purchaseDate = details ? new Date(details.purchaseDate) : new Date(user.purchaseDate);
              let duration = details ? details.durationMonths : (user.durationMonths || 1);
              const expiryDate = new Date(purchaseDate);
              expiryDate.setMonth(purchaseDate.getMonth() + duration);
              const daysLeft = Math.ceil((expiryDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
              
              // getAssignedCredential recalcula o rank do usuário no pool e atribui a conta correta em real-time
              const result = await getAssignedCredential(user, name, allClients);
              const isStrictlyBlocked = daysLeft < -3 && !user.overrideExpiration;

              return { 
                  name, 
                  daysLeft, 
                  isBlocked: user.isDebtor || isStrictlyBlocked, 
                  cred: result.credential, 
                  alert: result.alert,
                  expiryDate
              };
          }));
          setMergedData(results);
          setLoading(false);
      };

      if (validServices.length > 0) loadUnifiedData();
      else setLoading(false);

      // syncTrigger forçado pelo App.tsx faz esse efeito rodar instantaneamente após o admin salvar algo
  }, [validServices, user.phoneNumber, user.subscriptionDetails, user.isDebtor, user.name, syncTrigger]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleEditName = async () => {
      if (isEditingName && tempName !== user.name && tempName.trim()) {
          await updateClientName(user.phoneNumber, tempName.trim());
          onUpdateUser({ ...user, name: tempName.trim() });
      }
      setIsEditingName(!isEditingName);
  };

  const handleUpdateTheme = async (colorValue: string) => {
      const success = await updateClientPreferences(user.phoneNumber, { theme_color: colorValue });
      if (success) {
          onUpdateUser({ ...user, themeColor: colorValue });
      }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validar tamanho (máximo 1MB para Base64 não sobrecarregar o DB)
      if (file.size > 1024 * 1024) {
          alert("A imagem é muito grande! Escolha uma de até 1MB.");
          return;
      }

      setUploading(true);
      const reader = new FileReader();
      reader.onloadend = async () => {
          const base64String = reader.result as string;
          const success = await updateClientPreferences(user.phoneNumber, { profile_image: base64String });
          if (success) {
              onUpdateUser({ ...user, profileImage: base64String });
          }
          setUploading(false);
      };
      reader.readAsDataURL(file);
  };

  const removeProfilePhoto = async () => {
      if (!confirm("Deseja remover sua foto de perfil?")) return;
      setUploading(true);
      const success = await updateClientPreferences(user.phoneNumber, { profile_image: null });
      if (success) {
          onUpdateUser({ ...user, profileImage: undefined });
      }
      setUploading(false);
  };

  const handleLoginAssistant = () => {
      alert("Assistente de Login: Vou te levar para o nosso WhatsApp para te ajudar agora mesmo!");
      window.open(`https://wa.me/558894875029?text=${encodeURIComponent('Oi! Preciso de ajuda para fazer login na minha conta.')}`, '_blank');
  };

  return (
    <div className={`${getBgClass()} min-h-screen pb-32 transition-all duration-500`}>
      
      {/* PAINEL DE PERSONALIZAÇÃO (AQUARELA) */}
      {showPalette && (
          <div className="px-5 pt-4 animate-slide-down sticky top-20 z-40">
              <div className="bg-white/95 backdrop-blur-md rounded-[2.5rem] p-6 shadow-2xl border border-white space-y-6">
                  <div className="flex justify-between items-center">
                      <h3 className="text-sm font-black uppercase text-gray-800 flex items-center gap-2">
                          <Palette size={18} className="text-pink-500" /> Personalizar Estilo
                      </h3>
                      <button onClick={() => setShowPalette(false)} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
                          <X size={20} className="text-gray-400" />
                      </button>
                  </div>

                  <div className="space-y-4">
                      <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest px-1">Cor do Painel</p>
                      <div className="grid grid-cols-6 gap-3">
                          {THEME_OPTIONS.map((opt) => (
                              <button 
                                key={opt.value}
                                onClick={() => handleUpdateTheme(opt.value)}
                                className={`aspect-square rounded-2xl border-4 transition-all transform active:scale-90 ${opt.color} ${user.themeColor === opt.value ? 'border-pink-500 scale-110 shadow-lg' : 'border-gray-50 hover:border-pink-200'}`}
                                title={opt.name}
                              />
                          ))}
                      </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100">
                      <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest px-1 mb-4">Gerenciar Perfil</p>
                      <div className="flex gap-3">
                          <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="flex-1 bg-indigo-600 text-white px-5 py-3.5 rounded-2xl text-xs font-black uppercase shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform"
                          >
                              <Upload size={16} /> Trocar Foto
                          </button>
                          {user.profileImage && (
                              <button 
                                onClick={removeProfilePhoto}
                                className="bg-red-50 text-red-600 px-4 py-3.5 rounded-2xl text-xs font-black shadow-sm active:scale-95 transition-transform border border-red-100"
                              >
                                  <Trash2 size={18} />
                              </button>
                          )}
                      </div>
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileChange} 
                        accept="image/*" 
                        className="hidden" 
                      />
                  </div>
              </div>
          </div>
      )}

      {/* Alerta Consolidado de Vencidos */}
      {expiredServices.length > 0 && (
          <div className="px-5 pt-6 animate-fade-in">
              <div className="bg-gradient-to-r from-orange-500 to-red-600 rounded-[2rem] p-5 shadow-xl flex flex-col gap-4 border-2 border-white">
                  <div className="flex items-center gap-3">
                      <div className="bg-white/20 p-2.5 rounded-full">
                        <ShieldAlert size={22} className="text-white" />
                      </div>
                      <div className="flex-1">
                          <p className="text-xs font-black uppercase text-white tracking-widest leading-none">Atenção Necessária</p>
                          <p className="text-[10px] font-bold text-white/90 mt-1 leading-tight">
                            {expiredServices.length === 1 
                                ? `Seu plano de ${expiredServices[0].name} venceu.` 
                                : `Você tem ${expiredServices.length} planos vencidos.`} 
                            {" "}Renove para evitar o bloqueio total.
                          </p>
                      </div>
                  </div>
                  <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          if (expiredServices.length === 1) {
                            onOpenCheckout('renewal', expiredServices[0].name);
                          } else {
                            onOpenCheckout('renewal', expiredServices.map(s => s.name).join(','));
                          }
                        }}
                        className="flex-1 bg-white text-red-600 py-3 rounded-xl text-xs font-black uppercase shadow-sm active:scale-95 transition-all"
                      >
                        {expiredServices.length === 1 ? 'Renovar Plano' : 'Renovar Todos'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      <div className="flex justify-between items-center px-6 pt-8 pb-4">
          <div className="flex items-center gap-4">
              {/* Foto de Perfil com Botão de Edição */}
              <div className="relative group" onClick={() => setShowPalette(true)}>
                  <div className={`w-16 h-16 rounded-full overflow-hidden border-4 border-white shadow-xl ring-4 ring-pink-200 shrink-0 bg-white flex items-center justify-center ${uploading ? 'opacity-50' : ''}`}>
                      {uploading ? (
                          <Loader2 className="w-6 h-6 animate-spin text-pink-500" />
                      ) : (
                          <img src={user.profileImage || `https://ui-avatars.com/api/?name=${user.name}&background=random`} alt="Profile" className="w-full h-full object-cover" />
                      )}
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-pink-600 text-white p-1.5 rounded-full shadow-lg border-2 border-white hover:scale-110 transition-transform active:scale-90">
                      <Camera size={12} />
                  </div>
              </div>

              <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {isEditingName ? (
                        <input 
                            autoFocus
                            className="bg-white border border-pink-300 rounded-lg px-2 py-1 text-sm font-bold outline-none w-32 text-gray-900"
                            value={tempName}
                            onChange={(e) => setTempName(e.target.value)}
                            onBlur={handleEditName}
                            onKeyDown={(e) => e.key === 'Enter' && handleEditName()}
                        />
                    ) : (
                        <h2 className={`text-2xl font-black tracking-tight leading-none truncate ${getTextColorClass()}`}>{user.name}</h2>
                    )}
                    <button onClick={handleEditName} className="p-1 text-gray-400 hover:text-pink-600 transition-colors">
                        <Edit3 size={16} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                      <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-full border border-pink-100 shadow-sm w-fit">
                          <Crown size={10} className="text-yellow-500 fill-current" />
                          <span className="text-[9px] font-black text-pink-600 uppercase tracking-widest">VIP</span>
                      </div>
                      <button 
                        onClick={handleLoginAssistant}
                        className="flex items-center gap-1.5 bg-indigo-600 text-white px-2.5 py-1 rounded-full shadow-md hover:bg-indigo-700 transition-all"
                      >
                          <Fingerprint size={10} />
                          <span className="text-[9px] font-black uppercase tracking-widest">Assistente Login</span>
                      </button>
                  </div>
              </div>
          </div>
      </div>

      <div className="px-5 pt-4 space-y-8">
          {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-pink-500" />
                  <p className="font-bold text-sm uppercase tracking-widest">Sincronizando...</p>
              </div>
          ) : (
              <>
                  {mergedData.length > 0 && (
                      <div className="space-y-4">
                          <h4 className={`text-[10px] font-black uppercase px-2 tracking-widest ${getSubTextColorClass()}`}>Meus Aplicativos</h4>
                          <div className="grid grid-cols-1 gap-5">
                              {mergedData.map((item, i) => {
                                  const showRenewButton = item.daysLeft <= 5;
                                  const renewButtonColor = item.daysLeft < 0 ? 'bg-red-600 text-white' : 'bg-yellow-400 text-yellow-950';

                                  return (
                                    <div key={i} className={`bg-white rounded-[2.5rem] p-6 shadow-xl border relative overflow-hidden transition-all ${item.daysLeft < 0 ? 'border-red-100' : 'border-gray-100'}`}>
                                        <div className="flex justify-between items-start mb-6">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-14 h-14 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-lg ring-4 ring-pink-50`}>{item.name[0]}</div>
                                                <div>
                                                    <h3 className="font-black text-gray-800 text-lg leading-none">{item.name}</h3>
                                                    <span className={`inline-block px-2 py-0.5 mt-2 rounded-lg text-[10px] font-black uppercase ${item.daysLeft < 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                                                        {item.daysLeft < 0 ? 'Vencido' : `${item.daysLeft} dias restantes`}
                                                    </span>
                                                </div>
                                            </div>
                                            
                                            {showRenewButton && (
                                                <button 
                                                    onClick={() => onOpenCheckout(item.daysLeft < 0 ? 'renewal' : 'early_renewal', item.name)} 
                                                    className={`px-4 py-2 rounded-2xl font-black text-[10px] uppercase shadow-md transition-transform active:scale-90 flex items-center gap-1.5 ${renewButtonColor}`}
                                                >
                                                    <RotateCw size={14} /> Renovar
                                                </button>
                                            )}
                                        </div>

                                        <div className="space-y-3">
                                            <div className="bg-gray-50 p-4 rounded-[1.5rem] border border-gray-100 flex justify-between items-center group">
                                                <div className="flex flex-col min-w-0 flex-1 text-gray-800">
                                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Email de Acesso</span>
                                                    <span className={`font-mono font-bold text-sm break-all ${item.isBlocked ? 'text-red-300 blur-[2px]' : 'text-gray-700'}`}>
                                                        {item.isBlocked ? 'BLOQUEADO' : (item.cred?.email || 'Aguarde...')}
                                                    </span>
                                                </div>
                                                {!item.isBlocked && (
                                                    <button onClick={() => item.cred && copyToClipboard(item.cred.email, `e-${i}`)} className="p-3 text-indigo-600 bg-white border border-gray-100 rounded-xl shadow-sm active:scale-90 flex items-center gap-1">
                                                        {copiedId === `e-${i}` ? <Check size={14}/> : <Copy size={14}/>}
                                                        <span className="text-[10px] font-black uppercase">Copiar</span>
                                                    </button>
                                                )}
                                            </div>
                                            <div className="bg-gray-50 p-4 rounded-[1.5rem] border border-gray-100 flex justify-between items-center group">
                                                <div className="flex flex-col min-w-0 flex-1 text-gray-800">
                                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Senha Exclusiva</span>
                                                    <span className={`font-mono font-bold tracking-widest ${item.isBlocked ? 'text-red-300 blur-[2px]' : 'text-gray-700'}`}>
                                                        {item.isBlocked ? '••••••••' : (item.cred?.password || '••••••')}
                                                    </span>
                                                </div>
                                                {!item.isBlocked && (
                                                    <button onClick={() => item.cred && copyToClipboard(item.cred.password, `p-${i}`)} className="p-3 text-indigo-600 bg-white border border-gray-100 rounded-xl shadow-sm active:scale-90 flex items-center gap-1">
                                                        {copiedId === `p-${i}` ? <Check size={14}/> : <Copy size={14}/>}
                                                        <span className="text-[10px] font-black uppercase">Copiar</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {item.isBlocked && (
                                            <div className="mt-4 bg-red-50 p-4 rounded-2xl border border-red-100 flex items-center gap-3">
                                                <Lock className="text-red-500 shrink-0" size={18} />
                                                <p className="text-[10px] font-bold text-red-700 uppercase leading-tight">
                                                    Acesso Suspenso. Por favor, regularize clicando no botão "Renovar".
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                  );
                              })}
                          </div>
                      </div>
                  )}

                  {availableToBuy.length > 0 && (
                      <div className="space-y-5">
                          <h4 className={`text-[10px] font-black uppercase px-2 tracking-widest ${getSubTextColorClass()}`}>Loja de Aplicativos</h4>
                          <div className="grid grid-cols-1 gap-4">
                              {availableToBuy.map(svc => (
                                  <button 
                                    key={svc.name} 
                                    onClick={() => onOpenCheckout('new_sub', svc.name)} 
                                    className="bg-white border border-gray-100 p-5 rounded-[2rem] flex items-center justify-between shadow-lg shadow-pink-100/20 group hover:border-pink-200 transition-all active:scale-[0.98]"
                                  >
                                      <div className="flex items-center gap-4">
                                          <div className={`w-14 h-14 bg-gradient-to-br ${svc.color} rounded-2xl flex items-center justify-center text-3xl shadow-md transform transition-transform group-hover:scale-110 group-hover:rotate-6`}>
                                              {svc.icon}
                                          </div>
                                          <div>
                                              <h3 className="font-black text-gray-800 text-lg leading-none mb-1">{svc.name}</h3>
                                              <p className="text-pink-600 font-black text-sm">R$ {svc.price}</p>
                                          </div>
                                      </div>
                                      <div className="bg-pink-600 text-white px-5 py-2.5 rounded-2xl flex items-center gap-2 shadow-lg shadow-pink-200 group-hover:bg-pink-700 transition-all">
                                          <span className="text-[10px] font-black uppercase">Comprar</span>
                                          <ArrowRight size={16} />
                                      </div>
                                  </button>
                              ))}
                          </div>
                      </div>
                  )}
              </>
          )}
      </div>
    </div>
  );
};

export default Dashboard;
