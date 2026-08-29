# Changelog

## 1.2.2

### Windows

- Integra o AltGrid Bot diretamente nas contas do Stonegy, sem instalação manual de extensão.
- Libera o recurso para os planos PRO, PLUS e FOUNDER, mantendo o FREE sem automação.
- Permite ativar ou desativar o bot individualmente pelo menu de cada conta e preserva a preferência local.
- Corrige o estado visual do botão de ativação, que podia continuar mostrando a ação anterior em uma conta aberta.
- Ignora a Venda Rápida no primeiro ciclo iniciado na cidade e preserva a preferência permanente de venda automática.
- Recupera automaticamente o fluxo que parar na seleção, reaplicando a hunt e confirmando sua entrada.
- Substitui o nome e a imagem herdados da extensão pela identidade do AltGrid Bot.
- Substitui o atualizador diferencial do Windows pelo download controlado do instalador completo, com verificação de integridade e novas tentativas automáticas.
- Impede downloads duplicados durante a verificação e inicia a instalação explicitamente após encerrar as sessões do AltGrid.
- Adiciona escala de interface independente por conta, de 50% a 100% ou automática, para exibir mais itens do HUD em grades com várias telas.
- Encerra conexões e processos auxiliares remanescentes antes de instalar a atualização, evitando arquivos antigos bloqueados pelo Windows.
- Exibe corretamente o plano PLUS nos controles de plano temporário e vitalício do painel administrativo.
- Executa o bot em um mundo isolado e somente em páginas HTTPS do domínio oficial do Stonegy.
- Restringe o envio de webhooks aos endpoints HTTPS oficiais do Discord e limita o tamanho dos dados enviados.
- Mantém Android inalterado nesta atualização.

## 1.2.0

### Windows

- Adiciona proxy exclusivo por conta para Founder, com HTTP, HTTPS, SOCKS4 e SOCKS5.
- Protege usuário e senha do proxy localmente com a criptografia de credenciais do Windows.
- Permite salvar, ativar, remover e validar a rota de cada conta sem afetar as demais sessões.
- Adiciona diagnóstico real de memória por conta na área de configurações.
- Mantém o perfil de desempenho adaptativo para contas em segundo plano.
- Corrige a atualização interna para encerrar sessões e processos antes de iniciar o instalador, evitando os avisos de que o AltGrid ainda está aberto ou não pôde ser desinstalado.

### Windows e Android

- Amplia a janela de Configurações, os textos, seletores, abas e caixas de seleção.
- Corrige o chat para reabrir diretamente nas mensagens mais recentes e preservar a posição ao carregar o histórico.
- Corrige a rolagem horizontal das contas que voltava sozinha ao usar a roda do mouse.
- Mantém a navegação de configurações responsiva em telas menores.

### Android

- Corrige a validação do tamanho do APK recebido pelo atualizador interno, que podia exibir “Os dados da atualização Android são inválidos” antes do download.
- Mantém as sessões em desempenho normal: Eco Mode, diagnóstico de RAM e proxy por conta não são ativados no Android.
- Preserva o zoom automático e o enquadramento móvel normalizado entre diferentes tamanhos de tela.

## 0.9.0-beta.7

- Reduz a poluição da barra superior, movendo Chat e Atualizações para seus painéis próprios.

## 0.9.0-beta.6

- Adiciona botão direto para ativar e desativar o Eco Mode.

## 0.9.0-beta.5

- Corrige a publicação dos instaladores Windows no GitHub Releases.

## 0.9.0-beta.4

- Otimiza sessões Electron ocultas sem perder login, cookies ou contas conectadas.
- Adiciona HUD e sessões nativas para Android com armazenamento por conta.
- Permite reorganizar contas por arrastar e soltar.
- Corrige a altura dos layouts de grade para manter todas as sessões visíveis.
- Mantém o Chat Global como primeira opção e permite selecionar chats de jogos.

## 0.9.0-beta.3

- Permite recolher e restaurar o menu lateral para ampliar a área do jogo.
- Adiciona botão para fechar sessões diretamente nas abas superiores sem excluir as contas salvas.
- Preserva chat, BP e demais janelas do Huntera ao minimizar ou alternar entre contas.
- Libera pop-ups HTTPS seguros para login com Google dentro da sessão isolada da conta.
- Corrige menus e popovers que ficavam atrás das telas nativas dos jogos.
- Aplica limite FREE de 3 sessões ao abrir Huntera e 2 para os demais jogos.
- Exibe badges verificadas de PRO e FOUNDER no chat.
- Adiciona contadores agregados de usuários ativos e totais no Chat Global e endpoint público para o futuro site.

## 0.9.0-beta.2

- Aumenta e reforça o contraste das fontes da interface, incluindo barra, contas, menus, status, notificações e chat.
- Adiciona Eco Mode por conta com indicador de status.
- Corrige a rolagem horizontal das contas na barra superior.
- Mantém todas as sessões visíveis em uma grade contínua com rolagem vertical.
- Remove o atalho duplicado de configurações da barra superior.

## 0.9.0-beta.1

- Renova a barra superior com foco nas contas e ações compactas.
- Move o Chat para a barra superior e evita que o painel cubra as sessões no desktop.
- Corrige a área das sessões para ocupar toda a altura útil da janela.
- Corrige o modo Somente telas para usar 100% da largura e altura disponíveis.
- Mantém Grades, maximização, ESC e redimensionamento sem recriar as sessões.
- Reinicia a numeração pré-lançamento; a versão pública final será 1.0.0.

## 2.0.1

- Corrige a abertura de jogos nas sessões Electron sem perder o contexto do launcher.
- Habilita o feed público de atualizações internas pelo GitHub Releases.
- Inclui e valida `latest.yml` e a configuração do atualizador em cada pacote Windows.

## 2.0.0

- Aplicativo desktop Electron com sessões persistentes e isoladas por conta.
- Identidade final AltGrid com monograma AG no aplicativo e nos executáveis.
- Interface AltGrid dark com abas, sidebar, Grades e modo Somente telas.
- Autenticação Supabase, planos FREE/PRO/FOUNDER e limite de sessões simultâneas.
- Presets remotos de jogos, cache local e links de criação de conta separados.
- Chat global/por jogo, notificações, painel administrativo e moderação.
- Pagamentos PIX via backend Mercado Pago com processamento idempotente.
- Atualizações pelo GitHub Releases e licença offline assinada.
- Recuperação de sessão interrompida, áudio por conta e limpeza explícita dos dados locais.
- Registro de dispositivo por identificador aleatório com hash, sem serial de hardware.
