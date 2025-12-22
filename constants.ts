import { ClientDBRow, Dorama, AppCredentialDBRow } from './types';

export const LOGIN_HELP_TIPS = [
  {
    app: 'Rakuten Viki',
    steps: [
      'Abra o aplicativo Viki.',
      'Clique em "Entrar" no canto superior direito.',
      'Escolha "Continuar com Email" se sua conta for vinculada ao email.',
      'Se esqueceu a senha, clique em "Esqueceu a senha?" para receber um link de redefinição.'
    ]
  },
  {
    app: 'Kocowa',
    steps: [
      'Acesse o site ou app Kocowa.',
      'Vá em "Log In".',
      'Certifique-se de não estar logado com uma conta Google errada.',
      'Verifique se sua assinatura está ativa no painel "My Account".'
    ]
  },
  {
    app: 'WeTV',
    steps: [
      'Abra o WeTV.',
      'Clique em "Eu" ou "Me" no canto inferior.',
      'Clique na foto de perfil para fazer login.',
      'Use a opção de login vinculada (Email/Social) correta.'
    ]
  },
  {
    app: 'IQIYI',
    steps: [
      'Abra o app IQIYI.',
      'Vá na aba "Eu" no canto inferior direito.',
      'Toque em "Faça Login/Cadastre-se".',
      'Verifique se está na região correta (Brasil).'
    ]
  },
  {
    app: 'DramaBox',
    steps: [
      'Abra o DramaBox.',
      'Vá em Perfil/Profile.',
      'Verifique se suas moedas/assinatura aparecem.',
      'Se sumiu, tente "Restaurar Compras" ou relogar.'
    ]
  }
];

export const MOCK_DB_CLIENTS: ClientDBRow[] = [
    {
        id: 'mock-user-1',
        phone_number: '00000000000',
        client_name: 'Usuário Teste',
        purchase_date: new Date().toISOString(),
        duration_months: 1,
        subscriptions: ['Viki Pass', 'Kocowa+'],
        is_debtor: false,
        is_contacted: false,
        deleted: false,
        created_at: new Date().toISOString(),
        client_password: 'teste',
        game_progress: {},
        manual_credentials: {}
    }
];
