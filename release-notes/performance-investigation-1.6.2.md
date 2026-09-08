# Investigação de desempenho — candidata Windows 1.6.2-rc.1

## Relato e diagnóstico

O usuário confirmou que a segunda captura é da 1.6 para PC. A primeira mostra 15,8% de CPU / 2,51 GB na 1.5.2; a segunda, 25,4% / 5,00 GB. O modo de exibição das quatro contas, o uso do DPS Meter e a duração da hunt não foram confirmados. As capturas são um relato importante, mas não isolam vazamento de memória de crescimento normal de caches, recursos do jogo ou mudança de política de coleta.

Comparação de código: tag `v1.5.2` versus `263adc7` (código Windows 1.6.0). Electron 44.0.0 nas duas versões. A versão antiga impunha `--max-old-space-size=320`; a nova removeu esse limite para evitar coletas frequentes e travadas. A antiga também permitia throttling nativo em descanso; a atual mantém temporizadores ativos para evitar desconexões. O medidor de memória continua baseado nos bytes privados dos processos das sessões. Nenhuma regra de renderização específica do Founder foi encontrada.

Não foi restaurado o limite de heap de 320 MB nem a suspensão agressiva de temporizadores. Essas alterações exigiriam comprovar que não provocam novas travadas, falta de memória ou desconexões.

## Defeitos corrigidos

1. Cancelamento de callbacks de animação dentro do mesmo quadro não era respeitado.
2. Reaplicações idênticas de FPS reiniciavam o relógio do limitador.
3. Reaplicações idênticas de visibilidade adiavam a coleta programada e repetiam operações nativas.
4. Restaurar a janela com Eco desligado podia manter o limite de segundo plano.
5. DPS opcional mantinha cadastro de monstros sem limite de duração, fila de decodificação sem limite e reconstruía seu painel a cada pacote.

A tentativa inicial de aplicar a política nativa de background uma única vez foi REJEITADA: o teste com Electron real detectou animações paradas. A política deve ser reaplicada ao carregar o documento e em transições reais de visibilidade. O laboratório agora reprova qualquer sessão sem animação, mesmo que CPU e RAM caiam.

## Método e limites

`scripts/performance-lab.mjs` compila a fábrica de sessões e o preload de cada revisão diretamente do Git, usando perfis temporários separados e o mesmo Electron. A fixture usa canvas, aloca recursos controlados, envia uma requisição a cada segundo e recebe eventos do servidor. Há fases com três e quatro sessões visíveis, uma ativa e três em descanso, troca de ativa, descanso de todas e ciclos de abertura/fechamento.

Este é um teste sintético do gerenciador, NÃO um benchmark de Huntera. Ele usa as mesmas flags de inicialização nas revisões, não reproduz todos os parâmetros antigos de heap, não executa o shell inteiro, não carrega DPS e não reproduz a hunt do usuário. Os números de CPU somam processos do Electron e não devem ser comparados diretamente ao HUD. Uma execução curta não comprova ausência de vazamentos após horas.

## Evidência já coletada

- Testes automatizados: 46 arquivos / 466 testes, incluindo limites de descompressão e metadados do DPS; typecheck e compilação desktop.
- Comparação inicial: na 1.5.2 os envios periódicos ficaram atrasados e chegaram a zero em descanso. Na 1.6.0 houve 20 envios por conta nos 20 segundos medidos em todas as fases. Isto impede tratar o menor consumo da versão antiga como benefício sem custo.
- Estresse de reaplicação de layout a cada 100 ms, 25 segundos medidos: CPU média passou de 3,27 para 2,42 na métrica do laboratório; memória privada média de 482 para 458 MB. Ambas mantiveram 25 envios por conta. Esse resultado é específico deste cenário sintético, não uma promessa de redução percentual no Huntera.
- O resultado inicial da candidata com animação parada foi invalidado e não serve como ganho de desempenho.
- Reexecução final com 30 segundos por fase e três ciclos adicionais de reabertura: nenhum erro de validação, 30 envios por conta em cada fase, animações ativas em todas as sessões e retorno a um único WebContents/renderer após cada fechamento. Memória privada média no laboratório: 498 MB com quatro em grade; 480 MB com uma ativa e três em descanso. Não corresponde à memória das quatro contas reais do usuário.

## Critério para promoção ao canal estável

Validar a candidata no PC afetado com as mesmas quatro contas e mesma hunt, incluindo modo de grade/descanso, FPS e DPS. Registrar aos 5, 15, 30 e 60 minutos: memória privada/working set, CPU por processo, fluidez da ativa e continuidade das quatro contas. Não apagar dados locais, nem colocar personagens em risco só para obter números.

A candidata não altera o site, o feed estável de atualizações nem as outras plataformas. Não há comprovação de que o relato de 5 GB foi resolvido por completo.
