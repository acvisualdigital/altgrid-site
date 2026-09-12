export type AppLocale = 'pt-BR' | 'en' | 'es'

export const APP_LOCALES: readonly AppLocale[] = ['pt-BR', 'en', 'es']
export const APP_LOCALE_STORAGE_KEY = 'altgrid.preference.language.v1'

const translations: Record<Exclude<AppLocale, 'pt-BR'>, Record<string, string>> = {
  en: {
    'Inativas': 'Inactive',
    'Contas inativas': 'Inactive accounts',
    'Ver contas inativas': 'View inactive accounts',
    'Fechar contas inativas': 'Close inactive accounts',
    'Contas salvas': 'Saved accounts',
    'Suas contas salvas, prontas para abrir.': 'Your saved accounts, ready to open.',
    'Nenhuma conta inativa.': 'No inactive accounts.',
    'As contas encerradas aparecem aqui.': 'Closed accounts appear here.',
    'Fixar': 'Pin',
    'Desafixar': 'Unpin',
    'Acesso à conta': 'Account access',
    'Adicionar': 'Add',
    'Adicionar primeira conta': 'Add first account',
    'AltGrid protegido': 'AltGrid protected',
    'Anuncie no AltGrid': 'Advertise on AltGrid',
    'Abrir ou fechar chat': 'Open or close chat',
    'Acesse suas sessões e configurações.': 'Access your sessions and settings.',
    'Atalhos': 'Shortcuts',
    'Atualizações': 'Updates',
    'Atualizações do AltGrid': 'AltGrid updates',
    'Autenticação protegida': 'Protected authentication',
    'Avisos do AltGrid': 'AltGrid notices',
    'Aguarde…': 'Please wait…',
    'Abrindo…': 'Opening…',
    'Abrindo Google…': 'Opening Google…',
    'Bem-vindo de volta': 'Welcome back',
    'Bloquear localmente': 'Block locally',
    'Buscar jogo': 'Search game',
    'Buscar jogo…': 'Search game…',
    'Carregando conversa…': 'Loading conversation…',
    'Carregando plano e jogos…': 'Loading plan and games…',
    'Catálogo': 'Catalog',
    'Canais do chat': 'Chat channels',
    'Central de notificações': 'Notification center',
    'Conectado': 'Connected',
    'Conectada': 'Connected',
    'Conectado à internet': 'Connected to the internet',
    'Configurações': 'Settings',
    'Confirmar antes de fechar': 'Confirm before closing',
    'Confirmar senha': 'Confirm password',
    'Conheça o AltGrid': 'Discover AltGrid',
    'Contas': 'Accounts',
    'Contas anteriores': 'Previous accounts',
    'Contas configuradas': 'Configured accounts',
    'Contas e desempenho': 'Accounts and performance',
    'Contas organizadas': 'Organized accounts',
    'Criar conta': 'Create account',
    'Criar conta com Google': 'Create account with Google',
    'Criando…': 'Creating…',
    'Denunciar': 'Report',
    'Desktop e Android': 'Desktop and Android',
    'Digite sua senha': 'Enter your password',
    'Eco inteligente': 'Smart Eco',
    'Eco Mode adaptativo': 'Adaptive Eco Mode',
    'Em descanso': 'Resting',
    'Entrar': 'Sign in',
    'Entrar na AltGrid': 'Sign in to AltGrid',
    'Entrando…': 'Signing in…',
    'Enviar link de recuperação': 'Send recovery link',
    'Enviar mensagem': 'Send message',
    'Enviando…': 'Sending…',
    'Escreva uma mensagem…': 'Write a message…',
    'Esqueci minha senha': 'Forgot my password',
    'Experiência': 'Experience',
    'Fechar': 'Close',
    'Fechar chat': 'Close chat',
    'Fechar sessão': 'Close session',
    'Geral': 'General',
    'Gerencie suas sessões': 'Manage your sessions',
    'Grades': 'Grids',
    'Idioma': 'Language',
    'Idioma do aplicativo': 'Application language',
    'Instalar atualização': 'Install update',
    'Já tenho uma conta': 'I already have an account',
    'Jogador': 'Player',
    'Jogos suportados': 'Supported games',
    'Marcar lidas': 'Mark as read',
    'Máximo em segundo plano': 'Background maximum',
    'Medindo…': 'Measuring…',
    'Medir agora': 'Measure now',
    'Memória monitorada': 'Monitored memory',
    'Mensagem': 'Message',
    'Mensagem direta': 'Direct message',
    'Mensagens anteriores': 'Previous messages',
    'Mencionar @nick': 'Mention @nickname',
    'Minha conta': 'My account',
    'Meu plano': 'My plan',
    'Mínimo de 6 caracteres': 'At least 6 characters',
    'Mostrar senha': 'Show password',
    'Multissessão': 'Multi-session',
    'Nenhum chat de jogo disponível.': 'No game chat available.',
    'Nenhum jogo disponível no momento.': 'No games available right now.',
    'Notificações': 'Notifications',
    'Nova conta': 'New account',
    'Nova senha': 'New password',
    'Ocultar senha': 'Hide password',
    'Offline': 'Offline',
    'Opções da mensagem': 'Message options',
    'Outras opções': 'Other options',
    'Páginas da grade': 'Grid pages',
    'Preferências': 'Preferences',
    'Preferências do aplicativo': 'Application preferences',
    'Privacidade': 'Privacy',
    'Próxima página': 'Next page',
    'Próximas contas': 'Next accounts',
    'Recuperar senha': 'Recover password',
    'Recursos de desempenho': 'Performance features',
    'Recursos principais': 'Main features',
    'Restaurar': 'Restore',
    'Restaurar última sessão': 'Restore last session',
    'Sair': 'Exit',
    'Sair da conta': 'Sign out',
    'Saindo…': 'Signing out…',
    'Selecionar chats': 'Select chats',
    'Senha': 'Password',
    'Salvando…': 'Saving…',
    'Sem conexão': 'No connection',
    'Somente telas': 'Screens only',
    'Sobre': 'About',
    'Só um instante…': 'Just a moment…',
    'Status da conexão': 'Connection status',
    'Suas contas.': 'Your accounts.',
    'Seu grid começa aqui': 'Your grid starts here',
    'Seu ritmo.': 'Your pace.',
    'Tela cheia': 'Full screen',
    'Tentar novamente': 'Try again',
    'Tudo em um só lugar': 'Everything in one place',
    'Tudo tranquilo por aqui.': 'Everything is quiet here.',
    'Uso das sessões': 'Session usage',
    'Use seu e-mail para acessar suas contas.': 'Use your email to access your accounts.',
    'Ver contas em grade': 'View accounts in a grid',
    'Ver mais jogos': 'View more games',
    'Verificar atualização': 'Check for updates',
    'Verificando sua sessão': 'Checking your session',
    'Visual': 'Appearance',
    'Voltar': 'Back',
    'Voltar ao login': 'Back to sign in',
    'Você já está usando a versão mais recente.': 'You are already using the latest version.',
    'Digite um e-mail válido.': 'Enter a valid email address.',
    'Digite sua senha.': 'Enter your password.',
    'A senha deve ter pelo menos 6 caracteres.': 'The password must contain at least 6 characters.',
    'As senhas não são iguais.': 'The passwords do not match.',
    'Não foi possível conectar. Tente novamente em instantes.': 'Could not connect. Try again shortly.',
    'Este e-mail já está cadastrado.': 'This email is already registered.',
    'Confirme seu e-mail antes de entrar.': 'Confirm your email before signing in.',
    'E-mail ou senha incorretos.': 'Incorrect email or password.',
    'Sem conexão. Verifique sua internet e tente novamente.': 'No connection. Check your internet and try again.',
    'Muitas tentativas. Aguarde um pouco e tente novamente.': 'Too many attempts. Wait a moment and try again.',
    'Serviço temporariamente indisponível. Tente mais tarde.': 'Service temporarily unavailable. Try again later.',
    'Não foi possível concluir a operação. Tente novamente.': 'The operation could not be completed. Try again.',
    'A senha não atende aos requisitos mínimos.': 'The password does not meet the minimum requirements.',
    'SEU HUB DE JOGOS IDLE': 'YOUR IDLE GAME HUB',
    'CENTRAL PRONTA': 'HUB READY',
    'Organize múltiplas sessões, acompanhe seus jogos e mantenha o controle em qualquer tela.': 'Organize multiple sessions, follow your games, and stay in control on any screen.',
    'Abra suas contas em ambientes isolados e organize tudo em uma única central.': 'Open your accounts in isolated environments and organize everything in one place.',
    'Serviços AltGrid protegidos e online': 'AltGrid services protected and online',
    'Sessões isoladas': 'Isolated sessions',
    'Prioridade para a tela em uso': 'Priority for the active screen',
    'Consumo visível em tempo real': 'Usage visible in real time',
    'Sessões ocultas mais leves': 'Lighter hidden sessions',
    'Reabre as contas usadas na inicialização anterior.': 'Reopens the accounts used during the previous session.',
    'Evita encerrar sessões por acidente.': 'Prevents sessions from being closed accidentally.',
    'Escolha o idioma usado nos menus, mensagens e configurações.': 'Choose the language used in menus, messages, and settings.',
    'Avisos, atualizações e alertas do sistema.': 'Notices, updates, and system alerts.',
    'Atualizações, anúncios e alertas do sistema.': 'Updates, ads, and system alerts.',
    'Abrir perfil': 'Open profile',
    'Biblioteca': 'Library',
    'Benefícios e limites': 'Benefits and limits',
    'Conta e preferências': 'Account and preferences',
    'Conta AltGrid': 'AltGrid account',
    'Gerenciar o AltGrid': 'Manage AltGrid',
    'Jogos': 'Games',
    'Meu plano AltGrid': 'My AltGrid plan',
    'Navegação principal': 'Main navigation',
    'Painel administrativo': 'Admin dashboard',
    'Perfil e informações': 'Profile and information',
    'Plano ativo': 'Active plan',
    'Sobre o AltGrid': 'About AltGrid',
    'Categorias das configurações': 'Settings categories',
    'Cookies, sessões e proxies ficam somente neste dispositivo, isolados por conta.': 'Cookies, sessions, and proxies stay only on this device, isolated by account.',
    'Abra suas contas e clique em “Medir agora” para ver o consumo por sessão.': 'Open your accounts and click “Measure now” to see usage per session.',
    'O perfil de 10 FPS reduz trabalho de CPU/GPU das contas em segundo plano. Como cada jogo mantém um navegador isolado e ativo, a RAM só é totalmente liberada ao fechar a conta.': 'The 10 FPS profile reduces CPU/GPU work for background accounts. Because each game keeps an isolated browser active, RAM is fully released only when the account is closed.',
    'O tema escuro premium acompanha automaticamente o AltGrid.': 'The premium dark theme follows AltGrid automatically.',
    'Disponível nos planos PRO e FOUNDER.': 'Available on PRO and FOUNDER plans.',
    'Reduz atividade de telas em segundo plano sem recarregar o jogo.': 'Reduces background screen activity without reloading the game.',
    'Disponível no aplicativo instalado.': 'Available in the installed application.',
    'Escolha entre 2, 5, 10, 20 ou 30 FPS para as contas secundárias. A conta em uso continua limitada separadamente a 30 FPS.': 'Choose 2, 5, 10, 20, or 30 FPS for secondary accounts. The active account remains separately limited to 30 FPS.',
    'Concluir': 'Done',
    'Destaque': 'Featured',
    'Selecionado': 'Selected',
    'Disponível': 'Available',
    'Todos os jogos suportados': 'All supported games',
    'Usuários ativos neste jogo pelo AltGrid': 'Users active in this game through AltGrid',
    'O catálogo será carregado quando os serviços estiverem disponíveis.': 'The catalog will load when services are available.',
    'Divulgue seu jogo, produto ou site': 'Promote your game, product, or website',
    'Encerrar esta sessão': 'End this session',
    'Confirmação necessária': 'Confirmation required',
    'Verifique seu e-mail': 'Check your email',
    'Confira a caixa de entrada': 'Check your inbox',
    'Veja também Spam ou Lixo eletrônico': 'Also check Spam or Junk',
    'O remetente será AltGrid': 'The sender will be AltGrid',
    'Reenviar e-mail': 'Resend email',
    'Reenviando…': 'Resending…',
    'Voltar para o login': 'Back to sign in',
    'Recuperação de conta': 'Account recovery',
    'Definir nova senha': 'Set a new password',
    'Escolha uma nova senha para sua conta.': 'Choose a new password for your account.',
    'Confirmar nova senha': 'Confirm new password',
    'Salvar nova senha': 'Save new password',
  },
  es: {
    'Inativas': 'Inactivas',
    'Contas inativas': 'Cuentas inactivas',
    'Ver contas inativas': 'Ver cuentas inactivas',
    'Fechar contas inativas': 'Cerrar cuentas inactivas',
    'Contas salvas': 'Cuentas guardadas',
    'Suas contas salvas, prontas para abrir.': 'Tus cuentas guardadas, listas para abrir.',
    'Nenhuma conta inativa.': 'No hay cuentas inactivas.',
    'As contas encerradas aparecem aqui.': 'Las cuentas cerradas aparecen aquí.',
    'Fixar': 'Fijar',
    'Desafixar': 'Desfijar',
    'Acesso à conta': 'Acceso a la cuenta',
    'Adicionar': 'Añadir',
    'Adicionar primeira conta': 'Añadir primera cuenta',
    'Anuncie no AltGrid': 'Anúnciate en AltGrid',
    'Abrir ou fechar chat': 'Abrir o cerrar el chat',
    'Acesse suas sessões e configurações.': 'Accede a tus sesiones y ajustes.',
    'Atalhos': 'Atajos',
    'Atualizações': 'Actualizaciones',
    'Atualizações do AltGrid': 'Actualizaciones de AltGrid',
    'Autenticação protegida': 'Autenticación protegida',
    'Avisos do AltGrid': 'Avisos de AltGrid',
    'Aguarde…': 'Espera…',
    'Abrindo…': 'Abriendo…',
    'Abrindo Google…': 'Abriendo Google…',
    'Bem-vindo de volta': 'Bienvenido de nuevo',
    'Bloquear localmente': 'Bloquear localmente',
    'Buscar jogo': 'Buscar juego',
    'Buscar jogo…': 'Buscar juego…',
    'Carregando conversa…': 'Cargando conversación…',
    'Carregando plano e jogos…': 'Cargando plan y juegos…',
    'Catálogo': 'Catálogo',
    'Canais do chat': 'Canales del chat',
    'Central de notificações': 'Centro de notificaciones',
    'Conectado': 'Conectado',
    'Conectada': 'Conectada',
    'Conectado à internet': 'Conectado a internet',
    'Configurações': 'Configuración',
    'Confirmar antes de fechar': 'Confirmar antes de cerrar',
    'Confirmar senha': 'Confirmar contraseña',
    'Conheça o AltGrid': 'Conoce AltGrid',
    'Contas': 'Cuentas',
    'Contas anteriores': 'Cuentas anteriores',
    'Contas configuradas': 'Cuentas configuradas',
    'Contas e desempenho': 'Cuentas y rendimiento',
    'Contas organizadas': 'Cuentas organizadas',
    'Criar conta': 'Crear cuenta',
    'Criar conta com Google': 'Crear cuenta con Google',
    'Criando…': 'Creando…',
    'Denunciar': 'Denunciar',
    'Desktop e Android': 'Escritorio y Android',
    'Digite sua senha': 'Escribe tu contraseña',
    'Eco inteligente': 'Eco inteligente',
    'Eco Mode adaptativo': 'Modo Eco adaptativo',
    'Em descanso': 'En descanso',
    'Entrar': 'Iniciar sesión',
    'Entrar na AltGrid': 'Iniciar sesión en AltGrid',
    'Entrando…': 'Iniciando sesión…',
    'Enviar link de recuperação': 'Enviar enlace de recuperación',
    'Enviar mensagem': 'Enviar mensaje',
    'Enviando…': 'Enviando…',
    'Escreva uma mensagem…': 'Escribe un mensaje…',
    'Esqueci minha senha': 'Olvidé mi contraseña',
    'Experiência': 'Experiencia',
    'Fechar': 'Cerrar',
    'Fechar chat': 'Cerrar chat',
    'Fechar sessão': 'Cerrar sesión',
    'Geral': 'General',
    'Gerencie suas sessões': 'Gestiona tus sesiones',
    'Grades': 'Cuadrículas',
    'Idioma': 'Idioma',
    'Idioma do aplicativo': 'Idioma de la aplicación',
    'Instalar atualização': 'Instalar actualización',
    'Já tenho uma conta': 'Ya tengo una cuenta',
    'Jogador': 'Jugador',
    'Jogos suportados': 'Juegos compatibles',
    'Marcar lidas': 'Marcar como leídas',
    'Máximo em segundo plano': 'Máximo en segundo plano',
    'Medindo…': 'Midiendo…',
    'Medir agora': 'Medir ahora',
    'Memória monitorada': 'Memoria supervisada',
    'Mensagem': 'Mensaje',
    'Mensagem direta': 'Mensaje directo',
    'Mensagens anteriores': 'Mensajes anteriores',
    'Mencionar @nick': 'Mencionar @usuario',
    'Minha conta': 'Mi cuenta',
    'Meu plano': 'Mi plan',
    'Mínimo de 6 caracteres': 'Mínimo 6 caracteres',
    'Mostrar senha': 'Mostrar contraseña',
    'Multissessão': 'Multisesión',
    'Nenhum chat de jogo disponível.': 'No hay chats de juegos disponibles.',
    'Nenhum jogo disponível no momento.': 'No hay juegos disponibles ahora.',
    'Notificações': 'Notificaciones',
    'Nova conta': 'Nueva cuenta',
    'Nova senha': 'Nueva contraseña',
    'Ocultar senha': 'Ocultar contraseña',
    'Offline': 'Sin conexión',
    'Opções da mensagem': 'Opciones del mensaje',
    'Outras opções': 'Otras opciones',
    'Páginas da grade': 'Páginas de la cuadrícula',
    'Preferências': 'Preferencias',
    'Preferências do aplicativo': 'Preferencias de la aplicación',
    'Privacidade': 'Privacidad',
    'Próxima página': 'Página siguiente',
    'Próximas contas': 'Cuentas siguientes',
    'Recuperar senha': 'Recuperar contraseña',
    'Recursos de desempenho': 'Funciones de rendimiento',
    'Recursos principais': 'Funciones principales',
    'Restaurar': 'Restaurar',
    'Restaurar última sessão': 'Restaurar última sesión',
    'Sair': 'Salir',
    'Sair da conta': 'Cerrar sesión',
    'Saindo…': 'Cerrando sesión…',
    'Selecionar chats': 'Seleccionar chats',
    'Senha': 'Contraseña',
    'Salvando…': 'Guardando…',
    'Sem conexão': 'Sin conexión',
    'Somente telas': 'Solo pantallas',
    'Sobre': 'Acerca de',
    'Só um instante…': 'Un momento…',
    'Status da conexão': 'Estado de la conexión',
    'Suas contas.': 'Tus cuentas.',
    'Seu grid começa aqui': 'Tu cuadrícula empieza aquí',
    'Seu ritmo.': 'Tu ritmo.',
    'Tela cheia': 'Pantalla completa',
    'Tentar novamente': 'Intentar de nuevo',
    'Tudo em um só lugar': 'Todo en un solo lugar',
    'Tudo tranquilo por aqui.': 'Todo tranquilo por aquí.',
    'Uso das sessões': 'Uso de las sesiones',
    'Use seu e-mail para acessar suas contas.': 'Usa tu correo para acceder a tus cuentas.',
    'Ver contas em grade': 'Ver cuentas en cuadrícula',
    'Ver mais jogos': 'Ver más juegos',
    'Verificar atualização': 'Buscar actualizaciones',
    'Verificando sua sessão': 'Verificando tu sesión',
    'Visual': 'Apariencia',
    'Voltar': 'Volver',
    'Voltar ao login': 'Volver al inicio de sesión',
    'Você já está usando a versão mais recente.': 'Ya estás usando la versión más reciente.',
    'Digite um e-mail válido.': 'Escribe un correo válido.',
    'Digite sua senha.': 'Escribe tu contraseña.',
    'A senha deve ter pelo menos 6 caracteres.': 'La contraseña debe tener al menos 6 caracteres.',
    'As senhas não são iguais.': 'Las contraseñas no coinciden.',
    'Não foi possível conectar. Tente novamente em instantes.': 'No se pudo conectar. Inténtalo de nuevo en unos instantes.',
    'Este e-mail já está cadastrado.': 'Este correo ya está registrado.',
    'Confirme seu e-mail antes de entrar.': 'Confirma tu correo antes de iniciar sesión.',
    'E-mail ou senha incorretos.': 'Correo o contraseña incorrectos.',
    'Sem conexão. Verifique sua internet e tente novamente.': 'Sin conexión. Comprueba tu internet e inténtalo de nuevo.',
    'Muitas tentativas. Aguarde um pouco e tente novamente.': 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
    'Serviço temporariamente indisponível. Tente mais tarde.': 'Servicio temporalmente no disponible. Inténtalo más tarde.',
    'Não foi possível concluir a operação. Tente novamente.': 'No se pudo completar la operación. Inténtalo de nuevo.',
    'A senha não atende aos requisitos mínimos.': 'La contraseña no cumple los requisitos mínimos.',
    'SEU HUB DE JOGOS IDLE': 'TU CENTRO DE JUEGOS IDLE',
    'CENTRAL PRONTA': 'CENTRO LISTO',
    'Organize múltiplas sessões, acompanhe seus jogos e mantenha o controle em qualquer tela.': 'Organiza varias sesiones, sigue tus juegos y mantén el control en cualquier pantalla.',
    'Abra suas contas em ambientes isolados e organize tudo em uma única central.': 'Abre tus cuentas en entornos aislados y organiza todo en un solo lugar.',
    'Serviços AltGrid protegidos e online': 'Servicios de AltGrid protegidos y en línea',
    'Sessões isoladas': 'Sesiones aisladas',
    'Prioridade para a tela em uso': 'Prioridad para la pantalla activa',
    'Consumo visível em tempo real': 'Consumo visible en tiempo real',
    'Sessões ocultas mais leves': 'Sesiones ocultas más ligeras',
    'Reabre as contas usadas na inicialização anterior.': 'Reabre las cuentas usadas en la sesión anterior.',
    'Evita encerrar sessões por acidente.': 'Evita cerrar sesiones por accidente.',
    'Escolha o idioma usado nos menus, mensagens e configurações.': 'Elige el idioma de los menús, mensajes y ajustes.',
    'Avisos, atualizações e alertas do sistema.': 'Avisos, actualizaciones y alertas del sistema.',
    'Atualizações, anúncios e alertas do sistema.': 'Actualizaciones, anuncios y alertas del sistema.',
    'Abrir perfil': 'Abrir perfil',
    'Biblioteca': 'Biblioteca',
    'Benefícios e limites': 'Beneficios y límites',
    'Conta e preferências': 'Cuenta y preferencias',
    'Conta AltGrid': 'Cuenta AltGrid',
    'Gerenciar o AltGrid': 'Administrar AltGrid',
    'Jogos': 'Juegos',
    'Meu plano AltGrid': 'Mi plan AltGrid',
    'Navegação principal': 'Navegación principal',
    'Painel administrativo': 'Panel administrativo',
    'Perfil e informações': 'Perfil e información',
    'Plano ativo': 'Plan activo',
    'Sobre o AltGrid': 'Acerca de AltGrid',
    'Categorias das configurações': 'Categorías de configuración',
    'Cookies, sessões e proxies ficam somente neste dispositivo, isolados por conta.': 'Las cookies, sesiones y proxies permanecen solo en este dispositivo, aislados por cuenta.',
    'Abra suas contas e clique em “Medir agora” para ver o consumo por sessão.': 'Abre tus cuentas y pulsa “Medir ahora” para ver el consumo por sesión.',
    'O perfil de 10 FPS reduz trabalho de CPU/GPU das contas em segundo plano. Como cada jogo mantém um navegador isolado e ativo, a RAM só é totalmente liberada ao fechar a conta.': 'El perfil de 10 FPS reduce el trabajo de CPU/GPU de las cuentas en segundo plano. Como cada juego mantiene un navegador aislado activo, la RAM solo se libera por completo al cerrar la cuenta.',
    'O tema escuro premium acompanha automaticamente o AltGrid.': 'El tema oscuro premium acompaña automáticamente a AltGrid.',
    'Disponível nos planos PRO e FOUNDER.': 'Disponible en los planes PRO y FOUNDER.',
    'Reduz atividade de telas em segundo plano sem recarregar o jogo.': 'Reduce la actividad de las pantallas en segundo plano sin recargar el juego.',
    'Disponível no aplicativo instalado.': 'Disponible en la aplicación instalada.',
    'Escolha entre 2, 5, 10, 20 ou 30 FPS para as contas secundárias. A conta em uso continua limitada separadamente a 30 FPS.': 'Elige 2, 5, 10, 20 o 30 FPS para las cuentas secundarias. La cuenta activa permanece limitada por separado a 30 FPS.',
    'Concluir': 'Listo',
    'Destaque': 'Destacado',
    'Selecionado': 'Seleccionado',
    'Disponível': 'Disponible',
    'Todos os jogos suportados': 'Todos los juegos compatibles',
    'Usuários ativos neste jogo pelo AltGrid': 'Usuarios activos en este juego mediante AltGrid',
    'O catálogo será carregado quando os serviços estiverem disponíveis.': 'El catálogo se cargará cuando los servicios estén disponibles.',
    'Divulgue seu jogo, produto ou site': 'Promociona tu juego, producto o sitio web',
    'Encerrar esta sessão': 'Cerrar esta sesión',
    'Confirmação necessária': 'Confirmación necesaria',
    'Verifique seu e-mail': 'Revisa tu correo',
    'Confira a caixa de entrada': 'Revisa tu bandeja de entrada',
    'Veja também Spam ou Lixo eletrônico': 'Revisa también Spam o Correo no deseado',
    'O remetente será AltGrid': 'El remitente será AltGrid',
    'Reenviar e-mail': 'Reenviar correo',
    'Reenviando…': 'Reenviando…',
    'Voltar para o login': 'Volver al inicio de sesión',
    'Recuperação de conta': 'Recuperación de cuenta',
    'Definir nova senha': 'Establecer nueva contraseña',
    'Escolha uma nova senha para sua conta.': 'Elige una nueva contraseña para tu cuenta.',
    'Confirmar nova senha': 'Confirmar nueva contraseña',
    'Salvar nova senha': 'Guardar nueva contraseña',
  },
}

export function normalizeAppLocale(value: unknown): AppLocale | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt-BR'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es'
  return null
}

export function readPreferredLocale(userId?: string | null): AppLocale {
  try {
    const userLocale = userId
      ? normalizeAppLocale(localStorage.getItem(`${APP_LOCALE_STORAGE_KEY}:${userId}`))
      : null
    const sharedLocale = normalizeAppLocale(localStorage.getItem(APP_LOCALE_STORAGE_KEY))
    if (userLocale || sharedLocale) return userLocale ?? sharedLocale!
  } catch {
    // Fall back to the operating-system language when storage is unavailable.
  }
  return normalizeAppLocale(typeof navigator === 'undefined' ? null : navigator.language) ?? 'pt-BR'
}

export function storePreferredLocale(locale: AppLocale, userId?: string | null): void {
  try {
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale)
    if (userId) localStorage.setItem(`${APP_LOCALE_STORAGE_KEY}:${userId}`, locale)
  } catch {
    // The selected language remains active for the current application run.
  }
}

export function localeTag(locale: AppLocale): string {
  return locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'pt-BR'
}

export function translateUiText(value: string, locale: AppLocale): string {
  if (locale === 'pt-BR') return value
  const direct = translations[locale][value]
  if (direct) return direct

  if (/^\d+ online$/.test(value)) {
    return locale === 'es' ? value.replace('online', 'en línea') : value
  }
  if (/^Mensagem para .+…$/.test(value)) {
    return locale === 'en'
      ? value.replace(/^Mensagem para /, 'Message to ')
      : value.replace(/^Mensagem para /, 'Mensaje para ')
  }
  const activeMinutes = value.match(/^Ativos nos últimos (\d+) minutos$/)
  if (activeMinutes) {
    return locale === 'en'
      ? `Active in the last ${activeMinutes[1]} minutes`
      : `Activos en los últimos ${activeMinutes[1]} minutos`
  }
  if (/^Apagar conversa com .+$/.test(value)) {
    return locale === 'en'
      ? value.replace(/^Apagar conversa com /, 'Delete conversation with ')
      : value.replace(/^Apagar conversa com /, 'Eliminar conversación con ')
  }
  if (/^\d+ sessões abertas · ilimitadas$/.test(value)) {
    return locale === 'en'
      ? value.replace('sessões abertas · ilimitadas', 'open sessions · unlimited')
      : value.replace('sessões abertas · ilimitadas', 'sesiones abiertas · ilimitadas')
  }
  if (/^\d+\/\d+ sessões abertas$/.test(value)) {
    return locale === 'en'
      ? value.replace('sessões abertas', 'open sessions')
      : value.replace('sessões abertas', 'sesiones abiertas')
  }
  const catalogGames = value.match(/^(\d+) jogos no catálogo$/)
  if (catalogGames) {
    return locale === 'en'
      ? `${catalogGames[1]} games in the catalog`
      : `${catalogGames[1]} juegos en el catálogo`
  }
  const openSessions = value.match(/^(\d+) (sessão aberta|sessões abertas)$/)
  if (openSessions) {
    const count = Number(openSessions[1])
    return locale === 'en'
      ? `${count} open ${count === 1 ? 'session' : 'sessions'}`
      : `${count} ${count === 1 ? 'sesión abierta' : 'sesiones abiertas'}`
  }
  const unreadMessages = value.match(/^(\d+) (mensagem não lida|mensagens não lidas)$/)
  if (unreadMessages) {
    const count = Number(unreadMessages[1])
    return locale === 'en'
      ? `${count} unread ${count === 1 ? 'message' : 'messages'}`
      : `${count} ${count === 1 ? 'mensaje no leído' : 'mensajes no leídos'}`
  }
  return value
}

function translateNode(node: Node, locale: AppLocale): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const original = node.textContent ?? ''
    const trimmed = original.trim()
    if (!trimmed) return
    const translated = translateUiText(trimmed, locale)
    if (translated !== trimmed) {
      node.textContent = original.replace(trimmed, translated)
    }
    return
  }

  if (!(node instanceof HTMLElement)) return
  if (node.matches('[data-user-content], script, style')) return

  for (const attribute of ['aria-label', 'placeholder', 'title'] as const) {
    const value = node.getAttribute(attribute)
    if (value) node.setAttribute(attribute, translateUiText(value, locale))
  }
  node.childNodes.forEach((child) => translateNode(child, locale))
}

export function localizeDom(root: HTMLElement, locale: AppLocale): void {
  const ownerDocument = root.ownerDocument
    ?? (typeof document === 'undefined' ? null : document)
  if (ownerDocument) ownerDocument.documentElement.lang = localeTag(locale)
  if (
    locale !== 'pt-BR'
    && typeof Node !== 'undefined'
    && typeof HTMLElement !== 'undefined'
  ) {
    translateNode(root, locale)
  }
}
