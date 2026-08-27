# Changelog

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
