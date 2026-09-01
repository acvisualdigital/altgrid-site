# Checklist de lançamento — AltGrid 1.5.5

Atualizado em 1º de setembro de 2026. Este documento separa o que está preparado localmente do que ainda precisa ser publicado.

## Implementações reunidas na 1.5.5

### Aplicativo e organização

- Sidebar e barra inferior reorganizadas, recolhíveis e adaptadas a notebooks e telas menores.
- Menus de conta, ações de sessão, planos e indicações reformulados.
- Páginas de grades para separar grandes quantidades de contas por jogo ou rotina.
- Contador de jogos suportados carregado pelo catálogo ativo.
- Layouts de sessão, modo Somente telas, Descanso e Eco Mode integrados à área de trabalho.

### Desempenho e sessões

- Redução adaptativa de FPS nas contas em segundo plano sem interromper o jogo.
- Teto de 30 FPS também na conta em foco com Eco Mode, corrigindo o caso em que ligar o recurso com uma única conta não alterava o consumo.
- Agendamento econômico dos quadros limitados, sem consultar a tela na frequência total do monitor.
- Limpeza de memória escalonada entre contas e monitor de recursos menos frequente para evitar picos de CPU.
- Monitoramento compartilhado de CPU e memória e correção do valor inválido de CPU.
- Menor retenção de memória em telas ocultas e atualização parcial da interface.
- Proteção contra atalhos de zoom persistente e ação para restaurar a escala de uma conta.
- Proxy configurável por conta e opção de reaproveitar o proxy em outra conta.
- Extensões isoladas por conta conforme o limite do plano.

### Conta, planos e chat

- Nick obrigatório usado no chat e na identificação administrativa.
- Login com Google, cadastro, confirmação de e-mail e recuperação visualmente revisados.
- Conversas diretas, menção por nick, remoção da conversa da própria lista e avisos de mensagens não lidas.
- Benefícios e limites dos planos detalhados, com pagamento único e licença vitalícia nos planos pagos.
- Limites de extensões alinhados: PRO até 3, PLUS até 9 e FOUNDER ilimitadas.
- FOUNDER mantém contas simultâneas ilimitadas.

### Catálogo e site

- Catálogo público de jogos idle com pesquisa, filtros, status, páginas individuais e logos sem deformação.
- Catálogo ativo com 22 jogos, carregado pela API e sem contagens sociais inventadas.
- Página inicial e downloads atualizados para Windows, Android e macOS.
- Contadores públicos de usuários e jogos carregados dinamicamente.
- Estrutura de AdSense, métricas e conversões do Google Ads presente no site.
- Páginas de privacidade, termos, suporte e informações do catálogo verificadas.

### Publicidade no aplicativo

- Espaço patrocinado lateral e pop-up identificado para contas FREE.
- Alternativa **Anuncie no AltGrid** quando não houver campanha ativa.
- Formulário para jogo, produto ou site com formato, duração, destino, imagem e jogo relacionado.
- Solicitação de inclusão quando o jogo ainda não estiver no catálogo.
- Aprovação administrativa manual antes da cobrança.
- PIX liberado somente após aprovação e ativação após confirmação do pagamento.
- Destaque patrocinado na lista de jogos, além de impressões e cliques da campanha.
- Avisos administrativos de tentativa de compra e pagamento aprovado no Android da conta ADM, com som, pop-up e detalhes.
- Simulação local das etapas do anúncio sem criar pedido ou cobrança real.

### Distribuição

- Launcher Velopack e atualização automática do Windows.
- Instalador, versão portátil, pacote Microsoft Store, Android e fluxos de macOS preparados.
- Site e metadados locais alinhados na versão 1.5.5.

## Validações concluídas

- 409 testes automatizados aprovados em 41 arquivos.
- Tipagem do aplicativo, Electron e Worker aprovada.
- Build de produção do aplicativo e build seco da API aprovados.
- Sete páginas e 22 jogos validados pelo preflight do site, sem avisos.
- Preflight da tag `v1.5.5` aprovado.
- Setup e portátil Windows 1.5.5 gerados localmente.
- Pacote Microsoft Store 1.5.5 gerado localmente.
- Pacote Microsoft Store refeito após a revisão final e conferido com identidade `ACVisualDigital.AltGrid`, versão interna `1.5.5.0` e executável correto.
- APK Android de teste 1.5.5 gerado novamente após a integração do Firebase, com 12.381.780 bytes e SHA-256 `C58E38C84339177C0D6181AD1BBFF0BCE8242C1D6CE9B07DE91D3B34200E8A9B`.
- Laboratório de atualização 1.5.2 → 1.5.5 gerou pacote completo e delta válidos.
- Fluxo instalado do launcher repetido em 1º de setembro: a base 1.5.2 encontrou o feed local, concluiu o download em 100%, aplicou a atualização e reiniciou com manifesto 1.5.5.
- O launcher escolheu o pacote completo no laboratório, apesar de existir delta; isso não impede a atualização, mas permanece como otimização para reduzir o tamanho do download futuro.
- Auditoria das dependências de produção sem vulnerabilidades conhecidas.
- Site, API, catálogo, feed da 1.5.2 e downloads públicos atuais respondendo normalmente.
- Domínio `auth.altgrid.com.br` verificado no Resend e dois e-mails recentes de confirmação marcados como entregues.
- Causa da reprovação anterior da Microsoft Store identificada como falha de entrega de confirmação; o envio atual já está funcional.
- Busca por credenciais expostas encontrou somente nomes de variáveis e exemplos fictícios.
- As três migrações de publicidade foram aplicadas e conferidas no Supabase remoto.
- Worker de produção publicado e validado: saúde, planos de anúncio, campanhas, métricas e CORS respondem corretamente.
- Fluxos automatizados de FREE, FOUNDER, anúncios, PIX, notificações, presença e compatibilidade foram repetidos após a publicação: 409 testes aprovados.
- Auditoria financeira isolada repetida sem cobrança real: 117 testes aprovados cobrindo a trava do PIX antes da liberação administrativa, valor aprovado, chave de idempotência, confirmação pelo provedor, assinatura do webhook e repetição segura de eventos.
- Hotfix de presença validado em produção: o contador recuperou de 0 para 43 usuários ativos sem exigir reinicialização dos aplicativos.
- Revisão manual FOUNDER concluída no aplicativo local: sessão Huntera, Descanso, Eco Mode, chat, perfil, planos e simulação completa de anúncio sem cobrança real.
- Layout validado em desktop, notebook 1280×720 e notebook compacto 1024×600, sem rolagem horizontal e com ações principais acessíveis.
- Avisos temporários conferidos manualmente: o alerta de Grades desaparece sozinho e não fica preso na interface.
- Checagem final repetida em 1º de setembro de 2026: 409 testes, tipagem, preflight da `v1.5.5` e integridade das sete páginas/22 jogos aprovados.
- Firebase Cloud Messaging configurado no projeto AltGrid para os pacotes Android final e de prévia, com credencial privada armazenada somente no cofre do Worker.
- Registro de dispositivos limitado ao papel administrativo, migrações aplicadas no Supabase e permissão exclusiva do servidor corrigida.
- Alerta real de teste recebido com sucesso no único Android ADM registrado.
- Revisão manual FREE concluída no aplicativo local: identificação do plano, limites apresentados, pop-up patrocinado no login, destaque no catálogo, anúncio lateral e formulário de contratação conferidos sem envio ou cobrança.
- Login Google e recuperação de senha no Electron local agora retornam pelo protocolo do aplicativo, em vez de deixar a sessão presa no navegador em `127.0.0.1`.
- Modal de planos ajustado para manter sua área de ações acessível, com a lista de opções rolando dentro da janela em telas menores.
- Teste local ampliado para três sessões Huntera: aproximadamente 0,4%–1,7% de CPU e 773–804 MB no medidor das sessões, sem reproduzir o pico de 75% relatado na 1.5.2.
- Comparação com a 1.2.3 concluída: o limitador visual que consultava `requestAnimationFrame` na cadência total já existia nessa versão. A 1.5.2 acrescentou monitoramento automático de recursos a cada 6 segundos e consultas administrativas, aumentando o trabalho de fundo. Na 1.5.5, o monitor passou para 12 segundos, as limpezas foram espaçadas e o limitador agora aguarda por temporizador, solicitando somente o quadro que realmente deve ser exibido.
- Relato de Mac M4 auditado: o download 1.5.2 publicado é ARM64 e a dependência nativa do launcher contém binários Intel e ARM64. O empacotamento 1.5.5 foi corrigido para aplicar assinatura ad-hoc quando não houver Developer ID, e o workflow agora verifica toda a assinatura interna com `codesign` antes de aceitar DMG e ZIP.
- O fluxo do macOS agora mantém DMG e ZIP por sete dias como artefatos privados de revisão e só publica quando a opção explícita de publicação for ativada.
- Eco Mode corrigido para limitar também a conta em foco a 30 FPS; as secundárias mantêm os tetos adaptativos de 20/10/5 FPS e o Descanso mantém a tela oculta em 1 FPS sem encerrar a sessão.
- Teste manual final do Descanso concluído no aplicativo local: uma sessão caiu de 2,4% para 0,1% de CPU e de 322 MB para 278 MB; três sessões na grade caíram de 2,6–3,8% para 0,1% e permaneceram conectadas, com retorno imediato ao despertar. A RAM permaneceu próxima de 793 MB porque as sessões não são interrompidas.

## Pendências antes da publicação

1. Executar um pedido real de valor mínimo em ambiente controlado e confirmar PIX, webhook e ativação. A simulação automatizada e a entrega de notificação ADM estão aprovadas; esta etapa movimenta dinheiro e será feita somente com confirmação específica.
2. Publicar a release `v1.5.5` com todos os artefatos antes de publicar o site, pois os links do site já apontam para a 1.5.5 localmente.
3. Repetir um cadastro de teste e enviar o AppX 1.5.5 para nova certificação da Microsoft Store, informando que o e-mail via Resend foi validado.
4. Publicar o site por último, limpar cache e conferir Windows, Android, macOS, catálogo e anúncios na URL pública.

## Assinaturas adiadas por decisão do responsável

- Windows externo: será publicado sem certificado próprio neste momento; o usuário poderá receber aviso do SmartScreen.
- Android: a assinatura oficial de produção foi adiada; usar apenas o APK de prévia atual até a estratégia de distribuição ser definida.
- macOS: Developer ID e notarização foram adiados; os pacotes recebem assinatura ad-hoc gratuita e a página mantém as instruções de liberação manual do aplicativo.

## Melhorias recomendadas sem bloquear o lançamento

- Dividir o JavaScript principal do aplicativo, atualmente com aproximadamente 547 KB minificado.
- Otimizar as imagens de Jerimbia Idle, Frenetic World e a marca principal para reduzir tamanho e memória de decodificação.
- Atualizar gradualmente as configurações antigas do Gradle antes da migração para Gradle 9.
- Configurar assinatura própria para Windows e notarização Apple para reduzir avisos de segurança dos sistemas.
