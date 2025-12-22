
import { createClient } from '@supabase/supabase-js';
import { User, ClientDBRow, Dorama, AdminUserDBRow, SubscriptionDetail } from '../types';

// --- CONFIGURAÇÃO DO SUPABASE ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- GERENCIAMENTO DE DADOS LOCAIS ---
const getLocalUserData = (phoneNumber: string) => {
  try {
    const data = localStorage.getItem(`dorama_user_${phoneNumber}`);
    return data ? JSON.parse(data) : { watching: [], favorites: [], completed: [] };
  } catch (e) {
    return { watching: [], favorites: [], completed: [] };
  }
};

export const addLocalDorama = (phoneNumber: string, type: 'watching' | 'favorites' | 'completed', dorama: Dorama) => {
  const currentData = getLocalUserData(phoneNumber);
  
  if (!currentData[type]) {
    currentData[type] = [];
  }

  currentData[type].push(dorama);
  localStorage.setItem(`dorama_user_${phoneNumber}`, JSON.stringify(currentData));
  return currentData;
};

// --- FUNÇÕES DE CLIENTE ---

/**
 * Busca TODOS os clientes (necessário para o algoritmo de distribuição de senhas e painel admin)
 */
export const getAllClients = async (): Promise<ClientDBRow[]> => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*');
    
    if (error) {
      console.error("Erro ao buscar clientes:", error.message);
      return [];
    }
    return data as unknown as ClientDBRow[];
  } catch (e) {
    console.error("Exceção ao buscar clientes:", e);
    return [];
  }
};

/**
 * Verifica se o usuário existe e se já tem senha configurada.
 */
export const checkUserStatus = async (lastFourDigits: string): Promise<{ 
  exists: boolean; 
  matches: { phoneNumber: string; hasPassword: boolean; name?: string; photo?: string }[] 
}> => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('phone_number, client_password, client_name, profile_image, deleted')
      .like('phone_number', `%${lastFourDigits}`);

    if (error || !data || data.length === 0) {
      return { exists: false, matches: [] };
    }

    const activeClients = (data as any[]).filter(c => !c.deleted);

    if (activeClients.length === 0) {
       return { exists: false, matches: [] };
    }

    const matchesMap = new Map<string, { phoneNumber: string; hasPassword: boolean; name?: string; photo?: string }>();
    
    activeClients.forEach(client => {
        if (!matchesMap.has(client.phone_number)) {
            matchesMap.set(client.phone_number, {
                phoneNumber: client.phone_number,
                hasPassword: !!(client.client_password && client.client_password.trim() !== ''),
                name: client.client_name,
                photo: client.profile_image
            });
        }
    });

    const matches = Array.from(matchesMap.values());

    return { exists: true, matches };

  } catch (e) {
    console.error("Erro em checkUserStatus:", e);
    return { exists: false, matches: [] };
  }
};

/**
 * Registra a senha para todos os registros vinculados a aquele número de telefone
 */
export const registerClientPassword = async (phoneNumber: string, password: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .update({ client_password: password })
      .eq('phone_number', phoneNumber)
      .select();

    if (error) {
      console.error("Supabase error:", error);
      throw error;
    }

    if (!data || data.length === 0) {
      return false;
    }

    return true;
  } catch (e) {
    console.error('Erro ao salvar senha', e);
    return false;
  }
};

/**
 * Tenta fazer login validando a senha
 */
export const loginWithPassword = async (phoneNumber: string, password: string): Promise<{ user: User | null, error: string | null }> => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('phone_number', phoneNumber);

    if (error || !data || data.length === 0) {
      return { user: null, error: 'Usuário não encontrado.' };
    }

    const clientData = data[0] as unknown as ClientDBRow;
    
    if (clientData.deleted) {
      return { user: null, error: 'Acesso revogado. Entre em contato com o suporte.' };
    }

    if (String(clientData.client_password).trim() !== String(password).trim()) {
      return { user: null, error: 'Senha incorreta.' };
    }

    return processUserLogin(data as unknown as ClientDBRow[]);

  } catch (e) {
    return { user: null, error: 'Erro de conexão.' };
  }
};

// Auxiliar para processar os dados brutos e retornar o objeto User
export const processUserLogin = (userRows: ClientDBRow[]): { user: User | null, error: string | null } => {
    if (userRows.length === 0) return { user: null, error: 'Dados vazios.' };

    const primaryPhone = userRows[0].phone_number;
    const allServices = new Set<string>();
    const subscriptionMap: Record<string, SubscriptionDetail> = {};
    let bestRow = userRows[0];
    let maxExpiryTime = 0;
    let isDebtorAny = false;
    let overrideAny = false;

    const hasActiveAccount = userRows.some(row => !row.deleted);
    if (!hasActiveAccount) {
        return { user: null, error: 'Sua conta foi desativada.' };
    }

    userRows.forEach(row => {
      if (row.deleted) return; 

      let subs: string[] = [];
      if (Array.isArray(row.subscriptions)) {
        subs = row.subscriptions;
      } else if (typeof row.subscriptions === 'string') {
        const s = row.subscriptions as string;
        if (s.includes('+')) {
           subs = s.split('+').map(i => i.trim().replace(/^"|"$/g, ''));
        } else {
           subs = [s.replace(/^"|"$/g, '')];
        }
      }
      
      subs.forEach(s => {
          if (s) {
              const parts = s.split('|');
              const cleanService = parts[0].trim();
              const specificDate = parts[1] ? parts[1].trim() : null;
              // Status de pagamento da assinatura específica (0 = Pendente, 1 = Pago)
              const individualPaid = parts[2] !== '0'; 
              
              allServices.add(cleanService);
              
              subscriptionMap[cleanService] = {
                  purchaseDate: specificDate || row.purchase_date,
                  durationMonths: row.duration_months,
                  isDebtor: !individualPaid // No Dashboard, isDebtor true significa bloqueado
              };
              
              if (!individualPaid) isDebtorAny = true;
          }
      });

      if (row.is_debtor) isDebtorAny = true;
      if (row.override_expiration) overrideAny = true;

      const purchase = new Date(row.purchase_date);
      const expiry = new Date(purchase);
      expiry.setMonth(purchase.getMonth() + row.duration_months);

      if (expiry.getTime() > maxExpiryTime) {
        maxExpiryTime = expiry.getTime();
        bestRow = row;
      }
    });

    const combinedServices = Array.from(allServices);
    const localData = getLocalUserData(primaryPhone);
    const gameProgress = bestRow.game_progress || {};

    const appUser: User = {
      id: bestRow.id,
      name: bestRow.client_name || "Dorameira", 
      phoneNumber: bestRow.phone_number,
      purchaseDate: bestRow.purchase_date, 
      durationMonths: bestRow.duration_months,
      subscriptionDetails: subscriptionMap,
      services: combinedServices,
      isDebtor: isDebtorAny,
      overrideExpiration: overrideAny,
      watching: localData.watching || [],
      favorites: localData.favorites || [],
      completed: localData.completed || [],
      gameProgress: gameProgress,
      themeColor: bestRow.theme_color,
      backgroundImage: bestRow.background_image,
      profileImage: bestRow.profile_image
    };

    return { user: appUser, error: null };
};

export const refreshUserProfile = async (phoneNumber: string): Promise<{ user: User | null; error: string | null }> => {
    try {
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('phone_number', phoneNumber);
        
        if (error || !data || data.length === 0) {
             return { user: null, error: 'Usuário não encontrado.' };
        }
        
        return processUserLogin(data as unknown as ClientDBRow[]);
    } catch (e) {
        return { user: null, error: 'Erro de conexão.' };
    }
};

export const verifyAdminLogin = async (login: string, pass: string): Promise<boolean> => {
  try {
    const cleanLogin = login.trim();
    const cleanPass = pass.trim();

    const { data, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('username', cleanLogin)
      .limit(1);

    if (data && data.length > 0) {
        const admin = data[0] as AdminUserDBRow;
        return admin.password === cleanPass;
    }

    if (cleanLogin === 'admin' && cleanPass === 'admin123') {
        await supabase.from('admin_users').insert({ username: 'admin', password: 'admin123' });
        return true;
    }

    return false;
  } catch (e) {
    console.error('Erro ao verificar admin:', e);
    if (login === 'admin' && pass === 'admin123') return true;
    return false;
  }
};

export const updateAdminPassword = async (newPassword: string) => {
    const { error } = await supabase.from('admin_users').upsert({ username: 'admin', password: newPassword }, { onConflict: 'username' });
    if (error) console.error("Erro ao atualizar senha admin:", error);
    return !error;
};

export const getUserDoramasFromDB = async (phoneNumber: string): Promise<{ watching: Dorama[], favorites: Dorama[], completed: Dorama[] }> => {
    try {
        const { data, error } = await supabase.from('doramas').select('*').eq('phone_number', phoneNumber);
        if (error || !data) return { watching: [], favorites: [], completed: [] };
        const map = (d: any): Dorama => ({
            id: d.id,
            title: d.title,
            genre: d.genre || 'Drama',
            thumbnail: d.thumbnail || '',
            status: d.status,
            episodesWatched: d.episodes_watched || 0,
            totalEpisodes: d.total_episodes || 16,
            season: d.season || 1,
            rating: d.rating || 0
        });
        return {
            watching: data.filter((d: any) => d.status === 'Watching').map(map),
            favorites: data.filter((d: any) => d.status === 'Plan to Watch').map(map),
            completed: data.filter((d: any) => d.status === 'Completed').map(map)
        };
    } catch (e) { return { watching: [], favorites: [], completed: [] }; }
};

export const addDoramaToDB = async (phoneNumber: string, listType: 'watching' | 'favorites' | 'completed', dorama: Dorama): Promise<Dorama | null> => {
    try {
        let status = 'Watching';
        if (listType === 'favorites') status = 'Plan to Watch';
        if (listType === 'completed') status = 'Completed';
        const payload = {
            phone_number: phoneNumber,
            title: dorama.title,
            genre: dorama.genre || 'Drama',
            thumbnail: dorama.thumbnail || '',
            status: status,
            episodes_watched: dorama.episodesWatched || (status === 'Completed' ? dorama.totalEpisodes : 1),
            total_episodes: dorama.totalEpisodes || 16,
            season: dorama.season || 1,
            rating: dorama.rating || 0
        };
        const { data, error } = await supabase.from('doramas').insert(payload).select().single();
        if (error) return null;
        return { ...dorama, id: data.id };
    } catch (e) { return null; }
};

export const updateDoramaInDB = async (dorama: Dorama): Promise<boolean> => {
    try {
        const { error } = await supabase.from('doramas').update({
            episodes_watched: dorama.episodesWatched,
            total_episodes: dorama.totalEpisodes,
            season: dorama.season,
            rating: dorama.rating,
            status: dorama.status
        }).eq('id', dorama.id);
        return !error;
    } catch (e) { return false; }
};

export const removeDoramaFromDB = async (doramaId: string): Promise<boolean> => {
    const { error } = await supabase.from('doramas').delete().eq('id', doramaId);
    return !error;
};

export const updateClientName = async (phoneNumber: string, newName: string): Promise<boolean> => {
    const { error } = await supabase.from('clients').update({ client_name: newName }).eq('phone_number', phoneNumber);
    return !error;
};

export const updateClientPreferences = async (phoneNumber: string, preferences: any): Promise<boolean> => {
    const { error } = await supabase.from('clients').update(preferences).eq('phone_number', phoneNumber);
    return !error;
};

export const saveGameProgress = async (phoneNumber: string, gameId: string, progressData: any) => {
    const { data } = await supabase.from('clients').select('game_progress').eq('phone_number', phoneNumber).single();
    const current = data?.game_progress || {};
    const updated = { ...current, [gameId]: progressData };
    await supabase.from('clients').update({ game_progress: updated }).eq('phone_number', phoneNumber);
};

export const updateLastActive = async (phoneNumber: string): Promise<void> => {
    await supabase.from('clients').update({ last_active_at: new Date().toISOString() }).eq('phone_number', phoneNumber);
};

export const hardDeleteAllClients = async (): Promise<{success: boolean, msg: string}> => {
    try {
        await supabase.from('doramas').delete().neq('id', '0');
        await supabase.from('credentials').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        const { error } = await supabase.from('clients').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) return { success: false, msg: `Erro parcial: ${error.message}` };
        return { success: true, msg: "Limpeza completa realizada." };
    } catch (e: any) { return { success: false, msg: `Exceção: ${e.message}` }; }
};

export const resetAllClientPasswords = async (): Promise<{success: boolean, msg: string}> => {
    const { error } = await supabase.from('clients').update({ client_password: '' }).neq('id', '00000000-0000-0000-0000-000000000000');
    return error ? { success: false, msg: error.message } : { success: true, msg: "Senhas resetadas." };
};

export const resetAllNamesAndFixDates = async (): Promise<{success: boolean, msg: string}> => {
    const { error } = await supabase.from('clients').update({ client_name: '' }).neq('id', '00000000-0000-0000-0000-000000000000');
    return error ? { success: false, msg: error.message } : { success: true, msg: "Nomes resetados." };
};

export const saveClientToDB = async (client: Partial<ClientDBRow>): Promise<{ success: boolean; msg: string }> => {
    try {
        const payload = { ...client };
        if (!payload.id || payload.id === '') delete payload.id;
        
        if (!Array.isArray(payload.subscriptions)) {
            payload.subscriptions = [];
        }

        const { error } = await supabase.from('clients').upsert(payload);
        if (error) throw error;
        return { success: true, msg: "Salvo com sucesso!" };
    } catch (e: any) { return { success: false, msg: `Erro Supabase: ${e.message}` }; }
};

export const deleteClientFromDB = async (clientId: string): Promise<boolean> => {
    const { error } = await supabase.from('clients').update({ deleted: true }).eq('id', clientId);
    return !error;
};

export const restoreClient = async (clientId: string): Promise<boolean> => {
    const { error } = await supabase.from('clients').update({ deleted: false }).eq('id', clientId);
    return !error;
};

export const permanentlyDeleteClient = async (clientId: string): Promise<boolean> => {
    try {
        const { data: client } = await supabase.from('clients').select('phone_number').eq('id', clientId).single();
        if (client && client.phone_number) {
            await supabase.from('doramas').delete().eq('phone_number', client.phone_number);
        }
        const { error } = await supabase.from('clients').delete().eq('id', clientId);
        return !error;
    } catch (e) { return false; }
};
