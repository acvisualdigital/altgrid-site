# Auditoria estática

O payload original era composto por:

1. um invólucro de licença com key em texto claro, sessão, prazo de 72 horas,
   `localStorage` e chamada `POST /alive`;
2. uma imagem PNG embutida como data URL;
3. o núcleo ofuscado do bot.

O invólucro foi removido antes do empacotamento. O núcleo principal
`stoner-bot.local.js` não contém:

- key ou padrão `STONER-*`;
- `/activate`, `/alive` ou `/heartbeat`;
- criação de WebSocket ou conexão de rede própria;
- `eval`, `Function`, XMLHttpRequest ou `sendBeacon`;
- leitura de `document.cookie`;
- dependência de `__STONER_API__`;
- `fetch` direto.

O núcleo automatiza a interface do Stonegy por seletores DOM e eventos
sintéticos de mouse/ponteiro. Entre as funções identificadas estão:

- auto hunt, posicionamento e lure;
- venda rápida e proteção de itens;
- party, trade e divisão/transferência de gold;
- controle por CAP, stamina, gold, blessings e timer;
- treino e troca de personagem;
- listagem automática no Market;
- backup opcional do Loot Splitter para Discord;
- perfis, bloqueio de aba duplicada e persistência em `localStorage`.

Os complementos locais adicionados nesta versão incluem:

- catálogo completo de hunts com limite de criaturas por hunt;
- seleção antecipada de um dos 18 SQMs de posicionamento;
- abertura opcional de Glooth Bags pelo ID oficial `824`, serializada com as
  fases de hunt do bot;
- anti-disconnect opcional, executado no contexto da página para interceptar
  somente fechamentos locais do WebSocket associados à inatividade.

O código remoto baixado não foi executado durante a extração e a key usada na
captura não foi mantida em nenhum arquivo do pacote.
