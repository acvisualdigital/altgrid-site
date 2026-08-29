# STONER Local

Versão local autorizada do bot para Stonegy Online. O código funcional está
empacotado na extensão e não solicita key, token ou ativação remota.

## Instalação

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione esta pasta `STONER-Local`.
5. Nos detalhes da extensão, habilite **Permitir scripts do usuário**.
6. Abra ou recarregue o Stonegy Online.

Se o painel não aparecer, abra o popup da extensão e clique em
**Registrar e recarregar o bot**.

## Anti disconnect

O popup oferece a opção **Anti disconnect**, desligada por padrão. Ao alterar
essa opção, a extensão registra novamente seus scripts e recarrega somente as
abas abertas do Stonegy.

Quando ativado, `anti-disconnect.main.js` é executado no `MAIN world` em
`document_start`. Ele envia atividade sintética neutra a cada 3–4 minutos,
retoma automaticamente o modal de inatividade e bloqueia fechamentos locais do
WebSocket do Stonegy identificados como `idle_timeout` ou `hidden_timeout`.

Essa proteção é voltada a desconexões por inatividade. Ela não impede quedas de
internet, suspensão do computador, manutenção ou desconexões iniciadas pelo
servidor.

## Rede

O bot não acessa o servidor de licença. A única saída externa adicionada pela
extensão é o envio opcional ao webhook do Discord configurado pelo usuário.
O service worker aceita somente URLs HTTPS oficiais de `discord.com` ou
`discordapp.com` sob `/api/webhooks/`.

## Arquivos ativos

- `manifest.json`: manifesto Manifest V3.
- `local-background.js`: registro dos user scripts e proxy validado do Discord.
- `anti-disconnect.main.js`: proteção opcional contra desconexão por inatividade.
- `local-source-instrumentation.js`: ponte local entre o painel existente e os
  novos campos de configuração.
- `stoner-bot.local.js`: bot local sem o invólucro de licença.
- `stoner-hunt-catalog.js`: catálogo de hunts e limites de criaturas.
- `stoner-enhancements.js`: lista completa de hunts, Lure por hunt,
  posicionamento pré-configurável e abertura automática de Glooth Bags.
- `local-popup.html` e `local-popup.js`: estado e recarga da extensão.
- `stoner-logo.png`: ícone.

## Hunt, posição e Glooth Bags

- A seta ao lado de **Nome da hunt** abre o catálogo completo e pesquisável.
- Cada hunt guarda separadamente o **máximo de criaturas** do Lure.
- A grade com os 18 SQMs fica disponível mesmo fora da hunt; a posição salva
  é aplicada automaticamente quando a hunt iniciar.
- **Abrir Glooth Bags automaticamente** identifica o item oficial de ID `824`
  e abre o stack somente quando a hunt e as demais rotinas estiverem livres.
