
import { AppCredential, User, ClientDBRow } from '../types';
import { supabase } from './clientService';
import { getAllClients } from './clientService';

// Limites atualizados conforme solicitado
const CREDENTIAL_LIMITS: Record<string, number> = {
    'viki': 6,
    'kocowa': 7,
    'iqiyi': 15,
    'wetv': 9999,
    'dramabox': 9999,
    'default': 10
};

export const fetchCredentials = async (): Promise<AppCredential[]> => {
    try {
        const { data, error } = await supabase
            .from('credentials')
            .select('*');
        
        if (error) {
            console.error("Erro ao buscar credenciais do Supabase:", error.message || error);
            return [];
        }
        if (!data) return [];

        return data.map((row: any) => ({
            id: row.id,
            service: row.service,
            email: row.email,
            password: row.password,
            publishedAt: row.published_at,
            isVisible: row.is_visible
        }));
    } catch (e: any) {
        console.error("Exceção ao buscar credenciais:", e.message || e);
        return [];
    }
};

export const saveCredential = async (cred: AppCredential): Promise<string | null> => {
    try {
        const payload: any = {
            service: cred.service,
            email: cred.email,
            password: cred.password,
            published_at: cred.publishedAt,
            is_visible: cred.isVisible
        };

        if (cred.id && cred.id.trim() !== '') {
            payload.id = cred.id;
        }

        const { data, error } = await supabase
            .from('credentials')
            .upsert(payload)
            .select()
            .single();

        if (error) {
            console.error("Erro ao salvar credencial:", error.message);
            return null;
        }
        return data.id;
    } catch (e: any) {
        console.error("Exceção ao salvar credencial:", e.message);
        return null;
    }
};

export const deleteCredential = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('credentials').delete().eq('id', id);
    return !error;
};

// --- ESTRATÉGIA DE DISTRIBUIÇÃO DINÂMICA (LOAD BALANCING) ---
// Quando uma nova conta é criada, o 'serviceCreds.length' aumenta,
// o que faz o cálculo 'userIndex % serviceCreds.length' realocar os usuários automaticamente.
export const getAssignedCredential = async (user: User, serviceName: string, preloadedClients?: ClientDBRow[]): Promise<{ credential: AppCredential | null, alert: string | null, daysActive: number }> => {
  
  const credentialsList = await fetchCredentials();
  const cleanServiceName = serviceName.split('|')[0].trim().toLowerCase();

  const serviceCreds = credentialsList
    .filter(c => {
        if (!c.isVisible) return false;
        if (c.email.toLowerCase().includes('demo')) return false;
        const dbService = c.service.toLowerCase();
        return dbService.includes(cleanServiceName) || cleanServiceName.includes(dbService);
    })
    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

  if (serviceCreds.length === 0) return { credential: null, alert: "Nenhuma conta disponível.", daysActive: 0 };

  const allClients = preloadedClients || await getAllClients();
  
  const activeClientsWithService = allClients
      .filter(c => !c.deleted && c.subscriptions.some(s => s.toLowerCase().includes(cleanServiceName)))
      .sort((a, b) => a.phone_number.localeCompare(b.phone_number));

  const userIndex = activeClientsWithService.findIndex(c => c.phone_number === user.phoneNumber);
  
  let assignedCred: AppCredential;

  if (userIndex === -1) {
      assignedCred = serviceCreds[0];
  } else {
      const credIndex = userIndex % serviceCreds.length;
      assignedCred = serviceCreds[credIndex];
  }

  const alertMsg = null;
  const health = calculateHealth(assignedCred, serviceName);
  
  return { 
      credential: assignedCred, 
      alert: alertMsg || health.alert, 
      daysActive: health.daysActive 
  };
};

const calculateHealth = (cred: AppCredential, serviceName: string) => {
  const dateCreated = new Date(cred.publishedAt);
  const today = new Date();
  dateCreated.setHours(0,0,0,0);
  today.setHours(0,0,0,0);
  
  const diffTime = today.getTime() - dateCreated.getTime();
  const daysPassed = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  let alertMsg = null;
  const sName = serviceName.toLowerCase();

  // Alertas de expiração temporal
  if (sName.includes('viki')) {
      if (daysPassed >= 14) alertMsg = "⚠️ Conta Expirada (14 Dias).";
  } 
  else if (sName.includes('kocowa')) {
      if (daysPassed >= 25) alertMsg = "⚠️ Próximo do vencimento.";
  }

  return { alert: alertMsg, daysActive: daysPassed };
};

export const getClientsUsingCredential = async (credential: AppCredential, clients: ClientDBRow[]): Promise<ClientDBRow[]> => {
    const credServiceLower = credential.service.toLowerCase().split('|')[0].trim();
    const allCreds = await fetchCredentials();
    const serviceCreds = allCreds
        .filter(c => c.isVisible && !c.email.includes('demo') && c.service.toLowerCase().includes(credServiceLower))
        .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
    
    const myIndex = serviceCreds.findIndex(c => c.id === credential.id);
    if (myIndex === -1) return [];

    const activeClientsWithService = clients
      .filter(c => !c.deleted && c.subscriptions.some(s => s.toLowerCase().includes(credServiceLower)))
      .sort((a, b) => a.phone_number.localeCompare(b.phone_number));

    return activeClientsWithService.filter((_, idx) => idx % serviceCreds.length === myIndex);
};
