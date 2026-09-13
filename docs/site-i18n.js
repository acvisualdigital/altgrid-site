(function () {
  'use strict'

  const supported = new Set(['pt', 'en', 'es'])
  const storageKey = 'altgrid.site-language.v1'
  const translations = {
    en: {
      'Ir para o conteúdo': 'Skip to content', 'Abrir menu': 'Open menu', 'Navegação principal': 'Main navigation',
      'Novidades': 'What’s new', 'Recursos': 'Features', 'Jogos idle': 'Idle games', 'Planos': 'Plans', 'visitantes': 'visitors',
      'Entrar': 'Sign in', 'Baixar 1.6': 'Download 1.6', 'Idioma do site': 'Site language', 'Idioma': 'Language',
      'AltGrid, início': 'AltGrid, home', 'Pessoas que já visitaram o AltGrid': 'People who have visited AltGrid',
      'AltGrid 1.6 disponível para Windows, macOS, Linux e Android': 'AltGrid 1.6 available for Windows, macOS, Linux and Android',
      'Seu universo idle.': 'Your idle universe.', 'Sob controle.': 'Under control.',
      'Uma central criada para quem gerencia muitas contas. Organize sessões em páginas de grades, reduza consumo e controle cada jogo sem transformar seu PC em um labirinto de janelas.': 'A hub built for people who manage many accounts. Organize sessions into grid pages, reduce resource usage and control each game without turning your PC into a maze of windows.',
      'Baixar AltGrid 1.6': 'Download AltGrid 1.6', 'Versão 1.6.8 · Windows': 'Version 1.6.8 · Windows',
      'Explorar jogos idle': 'Explore idle games', 'Catálogo oficial AltGrid': 'Official AltGrid catalog',
      'Outras plataformas do AltGrid': 'AltGrid on other platforms', 'APK 1.6.8': 'APK 1.6.8', 'Escolher versão': 'Choose version',
      'Baixar AltGrid pela Microsoft Store': 'Download AltGrid from Microsoft Store', 'AppImage e DEB': 'AppImage and DEB',
      'Destaques da versão 1.6': 'Version 1.6 highlights', 'jogos no app': 'games in the app', 'plataformas': 'platforms', 'contas no Founder': 'accounts on Founder',
      'AltGrid 1.6.8 · Atualização': 'AltGrid 1.6.8 · Update', 'Mais leve em sessões longas.': 'Lighter during long sessions.',
      'Esta versão reduz o acúmulo de memória em várias contas e mantém as limpezas espaçadas para preservar a fluidez.': 'This release reduces memory buildup across multiple accounts and spaces maintenance out to preserve smooth performance.',
      'MEMÓRIA': 'MEMORY', 'Uso de RAM mais estável.': 'More stable RAM usage.', 'Sessões grandes recebem manutenção preventiva sem recarregar o jogo ou desconectar a conta.': 'Large sessions receive preventive maintenance without reloading the game or disconnecting the account.',
      'FLUIDEZ': 'SMOOTHNESS', 'Limpezas sem sobreposição.': 'Non-overlapping maintenance.', 'As contas são tratadas uma por vez para evitar picos simultâneos e pequenas travadas.': 'Accounts are handled one at a time to avoid simultaneous spikes and stutters.',
      'EFICIÊNCIA': 'EFFICIENCY', 'Monitoramento econômico.': 'Efficient monitoring.', 'A verificação ocorre em intervalos leves e só repete a limpeza quando existe novo crescimento de memória.': 'Checks run at lightweight intervals and maintenance only repeats after new memory growth.',
      'DESKTOP': 'DESKTOP', 'Proteção para várias contas.': 'Protection for multiple accounts.', 'O novo controle atende Windows, Microsoft Store, macOS e Linux, mantendo sessões e dados ativos.': 'The new control supports Windows, Microsoft Store, macOS and Linux while keeping sessions and active data intact.',
      'ATUALIZAÇÃO': 'UPDATE', 'Mais plataformas. Mais controle.': 'More platforms. More control.',
      'AltGrid organizando várias sessões de jogos em uma grade': 'AltGrid organizing several game sessions in a grid',
      'Eco Mode adaptativo': 'Adaptive Eco Mode', 'Prioridade para a conta em uso': 'Priority for the account in use',
      'Páginas de grades': 'Grid pages', 'Separe contas por jogo ou operação': 'Separate accounts by game or activity',
      'AltGrid em números': 'AltGrid at a glance', 'Versão atual': 'Current version', 'Plataformas disponíveis': 'Available platforms', 'Usuários ativos agora': 'Active users now', 'Jogos idle no catálogo': 'Idle games in the catalog',
      'Novidades da versão 1.6': 'What’s new in version 1.6', 'Uma atualização feita para rodar em qualquer tela.': 'An update made to run on any screen.',
      'Desempenho ajustado, interface mais responsiva e o mesmo fluxo de contas no Windows, macOS, Linux, Android e Microsoft Store.': 'Optimized performance, a more responsive interface and the same account workflow on Windows, macOS, Linux, Android and Microsoft Store.',
      'ORGANIZAÇÃO': 'ORGANIZATION', 'Várias páginas de grades.': 'Multiple grid pages.',
      'Crie Grade 1, Grade 2 e quantas páginas precisar. Separe contas por jogo, objetivo ou rotina e mostre no topo apenas as sessões da página atual.': 'Create Grid 1, Grid 2 and as many pages as you need. Separate accounts by game, goal or routine and show only the current page sessions at the top.',
      'Nova grade': 'New grid', 'DESEMPENHO': 'PERFORMANCE', 'Central de CPU e memória.': 'CPU and memory center.',
      'Acompanhe o consumo das sessões em tempo real e ajuste o Eco Mode direto na barra inferior.': 'Monitor session usage in real time and adjust Eco Mode directly from the bottom bar.',
      'DESCANSO': 'REST MODE', 'Telas escuras. Contas rodando.': 'Dark screens. Accounts still running.',
      'Coloque uma conta ou toda a grade em descanso visual sem encerrar as sessões.': 'Put one account or the entire grid into visual rest without ending sessions.',
      'CONTROLE': 'CONTROL', 'Proxy por conta.': 'Proxy per account.',
      'Salve, ative, teste a rota e copie o proxy de uma conta para outra sem preencher tudo novamente.': 'Save, enable, test the route and copy a proxy from one account to another without entering everything again.',
      'Rota protegida': 'Protected route', 'ATIVA': 'ACTIVE', 'EXTENSÕES': 'EXTENSIONS', 'Isoladas por sessão.': 'Isolated per session.',
      'Cada conta pode receber sua própria extensão no Windows, respeitando o limite do plano.': 'Each account can have its own extension on Windows, according to the plan limit.',
      'PLATAFORMAS': 'PLATFORMS', 'COMPATIBILIDADE': 'COMPATIBILITY', 'Windows, Mac, Linux e Android.': 'Windows, Mac, Linux and Android.',
      'O núcleo do AltGrid agora é preparado para quatro plataformas, com downloads separados e layout adaptado a telas pequenas.': 'AltGrid is now built for four platforms, with separate downloads and a layout adapted to smaller screens.',
      'Tudo ao alcance de um clique': 'Everything one click away', 'Uma central de comando, não apenas um navegador.': 'A command center, not just a browser.',
      'Abra o chat, ative Somente telas, descanse sessões, acompanhe CPU e RAM ou altere o limite do Eco Mode sem sair dos jogos.': 'Open chat, enable Screens only, rest sessions, monitor CPU and RAM or change the Eco Mode limit without leaving your games.',
      'Contas e logins isolados localmente': 'Accounts and logins isolated locally', 'Google ou e-mail na mesma identidade AltGrid': 'Google or email under the same AltGrid identity',
      'Chat global e mensagens diretas com avisos': 'Global chat and direct messages with notifications', 'Nick único para comunidade e suporte': 'Unique nickname for community and support', 'Interface redimensionável para qualquer tela': 'Resizable interface for any screen',
      'CENTRAL PRONTA': 'HUB READY', '3 sessões organizadas': '3 organized sessions', 'Somente telas': 'Screens only', 'Descanso': 'Rest mode', 'Ligado': 'On',
      'Descubra seu próximo idle': 'Discover your next idle game', 'Um catálogo vivo, feito pela comunidade.': 'A living catalog, built by the community.',
      'Veja jogos lançados, em beta ou em desenvolvimento. Filtre estilos, favorite projetos e acesse apenas sites oficiais verificados.': 'Browse released, beta and in-development games. Filter styles, favorite projects and access verified official sites only.',
      'Ver todos os jogos': 'View all games', 'Anunciar meu jogo': 'Promote my game', 'LANÇADO': 'RELEASED', 'EM DESTAQUE': 'FEATURED',
      'Uma compra. Acesso vitalício.': 'One payment. Lifetime access.', 'Escolha o tamanho da sua operação.': 'Choose the size of your setup.',
      'FREE é grátis para sempre. PRO, PLUS e FOUNDER são pagos uma única vez, sem mensalidade.': 'FREE stays free forever. PRO, PLUS and FOUNDER require one payment with no subscription.',
      'GRÁTIS PARA SEMPRE': 'FREE FOREVER', '3 no Huntera · 2 nos demais': '3 on Huntera · 2 on other games', 'Para começar a organizar suas contas sem custo.': 'Start organizing your accounts at no cost.',
      'Grades básicas': 'Basic grids', 'Presets e sessões isoladas': 'Presets and isolated sessions', 'Dados locais preservados': 'Local data preserved', 'Baixar grátis': 'Download free',
      'VITALÍCIO': 'LIFETIME', 'Até 6 contas simultâneas': 'Up to 6 simultaneous accounts', 'Mais controle, grades avançadas e economia de recursos.': 'More control, advanced grids and lower resource usage.',
      'Tudo do FREE': 'Everything in FREE', 'Eco Mode e controle de FPS': 'Eco Mode and FPS control', 'Grades personalizadas': 'Custom grids', 'Extensões em até 3 contas': 'Extensions on up to 3 accounts', 'Começar com PRO': 'Get PRO',
      'MAIS ESCOLHIDO': 'MOST POPULAR', 'Até 10 contas simultâneas': 'Up to 10 simultaneous accounts', 'Capacidade para quem gerencia muitas contas todos os dias.': 'Capacity for people who manage many accounts every day.',
      'Tudo do PRO': 'Everything in PRO', 'Grades para operações maiores': 'Grids for larger setups', 'Eco Mode completo': 'Full Eco Mode', 'Extensões em até 9 contas': 'Extensions on up to 9 accounts', 'Começar com PLUS': 'Get PLUS',
      'Contas ilimitadas': 'Unlimited accounts', 'O nível máximo do AltGrid, sem limite de sessões ou extensões.': 'The highest AltGrid tier, with no session or extension limits.',
      'Tudo do PLUS': 'Everything in PLUS', 'Contas e extensões ilimitadas': 'Unlimited accounts and extensions', 'Proxy exclusivo por conta': 'Dedicated proxy per account', 'Recursos beta e badge Founder': 'Beta features and Founder badge', 'Quero ser Founder': 'Become a Founder',
      'Os limites indicam contas abertas ao mesmo tempo. Suas configurações continuam salvas mesmo quando o plano muda.': 'Limits refer to accounts open at the same time. Your settings remain saved when your plan changes.',
      'Pronto para organizar seu grid?': 'Ready to organize your grid?', 'Baixe o AltGrid 1.6.': 'Download AltGrid 1.6.',
      'Escolha sua plataforma. As contas, configurações e preferências locais continuam preservadas nas próximas versões.': 'Choose your platform. Local accounts, settings and preferences remain preserved in future versions.',
      'Atualização integrada': 'Built-in updates', 'Baixar para Windows': 'Download for Windows', 'AltGrid 1.6.8 · Windows 10/11': 'AltGrid 1.6.8 · Windows 10/11',
      'AltGrid para Android, macOS, Linux e Microsoft Store': 'AltGrid for Android, macOS, Linux and Microsoft Store',
      'O Windows pode exibir “Editor desconhecido” enquanto o instalador direto ainda não possui assinatura digital.': 'Windows may show “Unknown publisher” while the direct installer is not digitally signed.',
      'Perguntas frequentes': 'Frequently asked questions', 'Respostas rápidas antes de começar.': 'Quick answers before you start.',
      'Os planos pagos têm mensalidade?': 'Do paid plans have a monthly fee?', 'Não. PRO, PLUS e FOUNDER são licenças vitalícias com pagamento único. O FREE continua grátis para sempre.': 'No. PRO, PLUS and FOUNDER are lifetime licenses with a one-time payment. FREE remains free forever.',
      'Colocar a tela em descanso encerra a conta?': 'Does Rest Mode close the account?', 'Não. O descanso reduz a atividade visual e mantém a sessão rodando em segundo plano.': 'No. Rest Mode reduces visual activity and keeps the session running in the background.',
      'Posso usar um proxy diferente em cada conta?': 'Can I use a different proxy for each account?', 'Sim. No Windows, o proxy pode ser salvo, ativado e testado por conta. Também é possível copiar a configuração para outra sessão.': 'Yes. On Windows, a proxy can be saved, enabled and tested per account. You can also copy it to another session.',
      'As extensões ficam separadas?': 'Are extensions kept separate?', 'Sim. Cada conta usa sua própria configuração de extensão. PRO permite até 3, PLUS até 9 e FOUNDER não possui limite.': 'Yes. Each account has its own extension settings. PRO allows up to 3, PLUS up to 9 and FOUNDER has no limit.',
      'O AltGrid guarda a senha dos jogos?': 'Does AltGrid store game passwords?', 'As sessões e dados dos jogos ficam isolados localmente no seu dispositivo. O AltGrid não cria um banco próprio com as senhas dos jogos.': 'Game sessions and data stay locally isolated on your device. AltGrid does not maintain its own database of game passwords.',
      'Construído junto com quem joga': 'Built together with players', 'Entre na comunidade AltGrid.': 'Join the AltGrid community.',
      'Dê sugestões, acompanhe as próximas versões e fale com outros jogadores idle no chat e no Discord.': 'Share suggestions, follow upcoming releases and talk with other idle players in chat and on Discord.',
      'Entrar no Discord': 'Join Discord', 'Seguir no X': 'Follow on X', 'Sua central para jogos idle.': 'Your hub for idle games.', 'Sobre': 'About', 'Downloads': 'Downloads', 'Suporte': 'Support', 'Privacidade': 'Privacy', 'Termos': 'Terms', 'Discord oficial': 'Official Discord',
      'Ative o JavaScript para detectar automaticamente a versão mais recente dos downloads.': 'Enable JavaScript to automatically detect the latest download version.'
    },
    es: {}
  }

  translations.es = Object.assign({}, translations.en, {
    'Ir para o conteúdo': 'Ir al contenido', 'Abrir menu': 'Abrir menú', 'Navegação principal': 'Navegación principal', 'Novidades': 'Novedades', 'Recursos': 'Funciones', 'Jogos idle': 'Juegos idle', 'Planos': 'Planes', 'visitantes': 'visitantes', 'Entrar': 'Entrar', 'Baixar 1.6': 'Descargar 1.6', 'Idioma do site': 'Idioma del sitio', 'Idioma': 'Idioma',
    'AltGrid 1.6 disponível para Windows, macOS, Linux e Android': 'AltGrid 1.6 disponible para Windows, macOS, Linux y Android', 'Seu universo idle.': 'Tu universo idle.', 'Sob controle.': 'Bajo control.',
    'Uma central criada para quem gerencia muitas contas. Organize sessões em páginas de grades, reduza consumo e controle cada jogo sem transformar seu PC em um labirinto de janelas.': 'Una central creada para quienes administran muchas cuentas. Organiza sesiones en páginas de cuadrículas, reduce el consumo y controla cada juego sin convertir tu PC en un laberinto de ventanas.',
    'Baixar AltGrid 1.6': 'Descargar AltGrid 1.6', 'Versão 1.6.8 · Windows': 'Versión 1.6.8 · Windows', 'APK 1.6.8': 'APK 1.6.8', 'Explorar jogos idle': 'Explorar juegos idle', 'Catálogo oficial AltGrid': 'Catálogo oficial de AltGrid', 'Escolher versão': 'Elegir versión', 'Mais plataformas. Mais controle.': 'Más plataformas. Más control.',
    'jogos no app': 'juegos en la app', 'plataformas': 'plataformas', 'contas no Founder': 'cuentas en Founder', 'ATUALIZAÇÃO': 'ACTUALIZACIÓN', 'Versão atual': 'Versión actual', 'Plataformas disponíveis': 'Plataformas disponibles', 'Usuários ativos agora': 'Usuarios activos ahora', 'Jogos idle no catálogo': 'Juegos idle en el catálogo',
    'AltGrid 1.6.8 · Atualização': 'AltGrid 1.6.8 · Actualización', 'Mais leve em sessões longas.': 'Más ligero durante sesiones largas.',
    'Esta versão reduz o acúmulo de memória em várias contas e mantém as limpezas espaçadas para preservar a fluidez.': 'Esta versión reduce la acumulación de memoria entre varias cuentas y distribuye el mantenimiento para conservar la fluidez.',
    'MEMÓRIA': 'MEMORIA', 'Uso de RAM mais estável.': 'Uso de RAM más estable.', 'Sessões grandes recebem manutenção preventiva sem recarregar o jogo ou desconectar a conta.': 'Las sesiones grandes reciben mantenimiento preventivo sin recargar el juego ni desconectar la cuenta.',
    'FLUIDEZ': 'FLUIDEZ', 'Limpezas sem sobreposição.': 'Mantenimiento sin superposición.', 'As contas são tratadas uma por vez para evitar picos simultâneos e pequenas travadas.': 'Las cuentas se procesan una por vez para evitar picos simultáneos y pequeños tirones.',
    'EFICIÊNCIA': 'EFICIENCIA', 'Monitoramento econômico.': 'Monitoreo eficiente.', 'A verificação ocorre em intervalos leves e só repete a limpeza quando existe novo crescimento de memória.': 'La comprobación ocurre en intervalos ligeros y solo repite el mantenimiento cuando hay nuevo crecimiento de memoria.',
    'DESKTOP': 'ESCRITORIO', 'Proteção para várias contas.': 'Protección para varias cuentas.', 'O novo controle atende Windows, Microsoft Store, macOS e Linux, mantendo sessões e dados ativos.': 'El nuevo control funciona en Windows, Microsoft Store, macOS y Linux, manteniendo activas las sesiones y sus datos.',
    'Novidades da versão 1.6': 'Novedades de la versión 1.6', 'Uma atualização feita para rodar em qualquer tela.': 'Una actualización creada para funcionar en cualquier pantalla.',
    'Desempenho ajustado, interface mais responsiva e o mesmo fluxo de contas no Windows, macOS, Linux, Android e Microsoft Store.': 'Rendimiento optimizado, interfaz más adaptable y el mismo flujo de cuentas en Windows, macOS, Linux, Android y Microsoft Store.',
    'ORGANIZAÇÃO': 'ORGANIZACIÓN', 'Várias páginas de grades.': 'Varias páginas de cuadrículas.', 'Nova grade': 'Nueva cuadrícula', 'DESEMPENHO': 'RENDIMIENTO', 'Central de CPU e memória.': 'Centro de CPU y memoria.', 'DESCANSO': 'DESCANSO', 'Telas escuras. Contas rodando.': 'Pantallas oscuras. Cuentas activas.', 'CONTROLE': 'CONTROL', 'Proxy por conta.': 'Proxy por cuenta.', 'Rota protegida': 'Ruta protegida', 'ATIVA': 'ACTIVA', 'EXTENSÕES': 'EXTENSIONES', 'Isoladas por sessão.': 'Aisladas por sesión.', 'PLATAFORMAS': 'PLATAFORMAS', 'COMPATIBILIDADE': 'COMPATIBILIDAD', 'Windows, Mac, Linux e Android.': 'Windows, Mac, Linux y Android.',
    'Tudo ao alcance de um clique': 'Todo al alcance de un clic', 'Uma central de comando, não apenas um navegador.': 'Un centro de control, no solo un navegador.', 'Somente telas': 'Solo pantallas', 'Descanso': 'Descanso', 'Ligado': 'Activado',
    'Descubra seu próximo idle': 'Descubre tu próximo juego idle', 'Um catálogo vivo, feito pela comunidade.': 'Un catálogo vivo, creado por la comunidad.', 'Ver todos os jogos': 'Ver todos los juegos', 'Anunciar meu jogo': 'Promocionar mi juego', 'LANÇADO': 'PUBLICADO', 'EM DESTAQUE': 'DESTACADO',
    'Uma compra. Acesso vitalício.': 'Un pago. Acceso de por vida.', 'Escolha o tamanho da sua operação.': 'Elige el tamaño de tu operación.', 'FREE é grátis para sempre. PRO, PLUS e FOUNDER são pagos uma única vez, sem mensalidade.': 'FREE es gratis para siempre. PRO, PLUS y FOUNDER se pagan una sola vez, sin mensualidad.', 'GRÁTIS PARA SEMPRE': 'GRATIS PARA SIEMPRE', 'VITALÍCIO': 'DE POR VIDA', 'Baixar grátis': 'Descargar gratis', 'Começar com PRO': 'Elegir PRO', 'MAIS ESCOLHIDO': 'MÁS ELEGIDO', 'Começar com PLUS': 'Elegir PLUS', 'Contas ilimitadas': 'Cuentas ilimitadas', 'Quero ser Founder': 'Quiero ser Founder',
    'Pronto para organizar seu grid?': '¿Listo para organizar tu cuadrícula?', 'Baixe o AltGrid 1.6.': 'Descarga AltGrid 1.6.', 'Escolha sua plataforma. As contas, configurações e preferências locais continuam preservadas nas próximas versões.': 'Elige tu plataforma. Las cuentas, configuraciones y preferencias locales se conservarán en futuras versiones.', 'Atualização integrada': 'Actualización integrada', 'Baixar para Windows': 'Descargar para Windows', 'AltGrid 1.6.8 · Windows 10/11': 'AltGrid 1.6.8 · Windows 10/11',
    'Perguntas frequentes': 'Preguntas frecuentes', 'Respostas rápidas antes de começar.': 'Respuestas rápidas antes de empezar.', 'Os planos pagos têm mensalidade?': '¿Los planes de pago tienen mensualidad?', 'Não. PRO, PLUS e FOUNDER são licenças vitalícias com pagamento único. O FREE continua grátis para sempre.': 'No. PRO, PLUS y FOUNDER son licencias de por vida con un único pago. FREE sigue siendo gratis para siempre.', 'Colocar a tela em descanso encerra a conta?': '¿El modo descanso cierra la cuenta?', 'Não. O descanso reduz a atividade visual e mantém a sessão rodando em segundo plano.': 'No. El descanso reduce la actividad visual y mantiene la sesión activa en segundo plano.', 'Posso usar um proxy diferente em cada conta?': '¿Puedo usar un proxy diferente en cada cuenta?', 'As extensões ficam separadas?': '¿Las extensiones permanecen separadas?', 'O AltGrid guarda a senha dos jogos?': '¿AltGrid guarda las contraseñas de los juegos?',
    'Construído junto com quem joga': 'Creado junto a quienes juegan', 'Entre na comunidade AltGrid.': 'Únete a la comunidad AltGrid.', 'Entrar no Discord': 'Entrar en Discord', 'Seguir no X': 'Seguir en X', 'Sua central para jogos idle.': 'Tu centro para juegos idle.', 'Sobre': 'Acerca de', 'Downloads': 'Descargas', 'Suporte': 'Soporte', 'Privacidade': 'Privacidad', 'Termos': 'Términos', 'Discord oficial': 'Discord oficial'
  })

  const detected = (() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (supported.has(saved)) return saved
    } catch {}
    const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const value of browserLanguages) {
      const language = String(value || '').toLowerCase().split('-')[0]
      if (supported.has(language)) return language
    }
    return 'pt'
  })()

  const originals = new WeakMap()
  const remember = (node, value) => { if (!originals.has(node)) originals.set(node, value) }
  const translateText = (value, language) => {
    const trimmed = value.trim()
    const translated = translations[language]?.[trimmed]
    if (translated) return value.replace(trimmed, translated)
    const apk = trimmed.match(/^Baixar APK (.+)$/)
    if (apk && language === 'en') return value.replace(trimmed, `Download APK ${apk[1]}`)
    if (apk && language === 'es') return value.replace(trimmed, `Descargar APK ${apk[1]}`)
    const version = trimmed.match(/^Versão (.+)$/)
    if (version && language === 'en') return value.replace(trimmed, `Version ${version[1]}`)
    if (version && language === 'es') return value.replace(trimmed, `Versión ${version[1]}`)
    return value
  }
  const apply = (language) => {
    if (!supported.has(language)) language = 'pt'
    document.documentElement.lang = language === 'pt' ? 'pt-BR' : language
    document.querySelectorAll('[data-language-select]').forEach((select) => { select.value = language })
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      if (!node.nodeValue?.trim() || node.parentElement?.closest('script,style,select')) continue
      remember(node, node.nodeValue)
      node.nodeValue = translateText(originals.get(node), language)
    }
    document.querySelectorAll('[aria-label],[title],[alt]').forEach((element) => {
      for (const attribute of ['aria-label', 'title', 'alt']) {
        if (!element.hasAttribute(attribute)) continue
        const key = `data-i18n-original-${attribute}`
        if (!element.hasAttribute(key)) element.setAttribute(key, element.getAttribute(attribute))
        const original = element.getAttribute(key)
        element.setAttribute(attribute, translations[language]?.[original] || original)
      }
    })
    const metadata = {
      pt: ['AltGrid 1.6 — Central multissessão para jogos idle', 'AltGrid 1.6 é a central multiplataforma para organizar múltiplas contas de jogos idle no Windows, macOS, Linux e Android.'],
      en: ['AltGrid 1.6 — Multi-session hub for idle games', 'AltGrid 1.6 is the multiplatform hub for organizing idle game accounts on Windows, macOS, Linux and Android.'],
      es: ['AltGrid 1.6 — Centro multisesión para juegos idle', 'AltGrid 1.6 es el centro multiplataforma para organizar cuentas de juegos idle en Windows, macOS, Linux y Android.']
    }[language]
    document.title = metadata[0]
    document.querySelector('meta[name="description"]')?.setAttribute('content', metadata[1])
    window.dispatchEvent(new CustomEvent('altgrid:languagechange', { detail: { language } }))
  }

  document.addEventListener('DOMContentLoaded', () => {
    apply(detected)
    document.querySelectorAll('[data-language-select]').forEach((select) => select.addEventListener('change', () => {
      const language = select.value
      try { localStorage.setItem(storageKey, language) } catch {}
      apply(language)
    }))
  })
  window.AltGridI18n = { apply, getLanguage: () => document.documentElement.lang.split('-')[0] }
})()
