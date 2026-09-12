# Atualização local: contas e chat

Não publicada. Validação em 11/09/2026.

## Implementado

- Contas fechadas agrupadas em Inativas para reabertura, sem apagar dados salvos.
- Pin persistido por usuário mantém contas fechadas nas abas.
- Atalhos numéricos seguem as abas disponíveis.
- Resposta no chat com citação textual (não é uma thread vinculada no servidor).
- Som para novas menções ao nick, ignorando mensagens próprias, duplicadas e autores bloqueados. Preferência nas notificações. Reprodução depende das permissões de áudio do dispositivo.
- Histórico local do chat limitado às 200 mensagens mais recentes para impedir crescimento indefinido. Não apaga mensagens no servidor.
- Rascunhos por canal e limpeza ao sair da conta.
- Amostragem de recursos a cada 60 segundos.

## Validação

- Typecheck, suíte de 481 testes e compilação desktop concluídos.
- Laboratório nativo: `node scripts/performance-lab.mjs --refs working --seconds 15 --warmup 5 --cycles 2`.
- Perfil temporário isolado, sem usar contas do cliente. Carga sintética: não representa os efeitos e scripts do Huntera.
- CPU média: 3 sessões em grade 3,89%; 4 em grade 4,42%; 1 ativa e 3 em descanso 2,31%; todas em descanso 0,59%.
- Memória privada média: aproximadamente 426, 521, 503 e 505 MiB, respectivamente. Não confundir com RAM total exibida pelo sistema.
- Após os ciclos de fechamento, restou apenas o renderer da janela do laboratório. Não houve acumulação de renderers nesse teste curto.
- Relatório bruto: `C:/Users/yacac/AppData/Local/Temp/altgrid-performance-lab-z1Wwqc/comparison.json` (arquivo temporário).

## Pendente antes de lançamento

- Reproduzir quatro contas Huntera em hunt com efeitos simultâneos, no cenário afetado; comparar com três, capturar perfil CPU/heap ao aparecerem stutters e executar teste prolongado.
- O teste não comprova a correção do travamento da quarta conta nem exclui vazamento de longa duração no jogo/extensões. Não foi aplicado um ajuste especulativo ao motor das sessões.
- Validar visualmente o menu de inativas e a reprodução de som no app real, além de testes nos demais dispositivos. Build/testes automáticos não substituem essa validação.

## Continuação multiplataforma

- A interface e os serviços alterados são compartilhados pelos builds Windows, Store, Linux, macOS e Android; isso não equivale a validação em todos esses sistemas.
- Gerado APK preview em `android/app/build/outputs/apk/debug/app-debug.apk`, com applicationId separado do app oficial. Build e testes unitários Android passaram.
- Android: adicionados registros sanitizados de versão do WebView, falhas HTTP/rede e erros de script. Não registram texto do chat, URLs ou credenciais. Hunt Idle preso em “Preparando os arquivos” ainda não foi reproduzido; não foi feita limpeza de dados ou relaxamento de segurança.
- Linux: corrigida a perda do pacote local ao final da geração no Windows. Pasta x64 preservada em `release/linux/preview-x64-1.6.5-Qr6FNt`. Ainda não é DEB/AppImage nem foi executada em Linux.
- Workflow Linux passou a prever instalação do DEB e abertura real via Xvfb, com perfil descartável e sandbox habilitado, nas arquiteturas x64 e ARM64. O script verifica a renderização da interface pelo depurador local. Workflow não enviado/executado nesta etapa.
- Não há WSL, dispositivo Android conectado ou host macOS disponível. Não foram gerados novos instaladores macOS/Store nem publicado qualquer pacote. Linux “não abre” segue sem causa confirmada: precisamos do erro de execução e da distribuição para distinguir dependências, arquitetura e sandbox.
