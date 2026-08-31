begin;

insert into public.games (
  slug,
  name,
  launch_url,
  developer_referral_url,
  icon_url,
  enabled,
  sort_order,
  metadata
)
values
  (
    'poke-idle-online',
    'Poke Idle Online',
    'https://pokeidle.online/game/',
    null,
    'https://altgrid.com.br/assets/game-icons/poke-idle-online.svg',
    true,
    100,
    '{"category":"Poke Idle","status":"Lançado","description":"MMORPG idle de captura, treinamento e evolução de criaturas com progressão contínua no navegador.","tagline":"Capture, evolua e continue avançando.","accent":"#f1c94d","features":["Captura e evolução","Progressão idle","Mundo multiplayer"]}'::jsonb
  ),
  (
    'pokeidle-io',
    'PokeIdle.io',
    'https://pokeidle.io/',
    null,
    'https://altgrid.com.br/assets/game-icons/pokeidle-io-official.png',
    true,
    101,
    '{"category":"Poke Idle","status":"Beta","description":"Jogo idle de navegador com caçadas automáticas, coleção, PvP e economia entre jogadores.","tagline":"Escolha a caçada e acompanhe a evolução.","accent":"#f3d455","features":["Caçadas automáticas","PvP competitivo","Mercado da comunidade"]}'::jsonb
  ),
  (
    'idlepoke',
    'IdlePoke',
    'https://idlepoke.com/',
    null,
    'https://altgrid.com.br/assets/game-icons/idlepoke-official.png',
    true,
    102,
    '{"category":"Poke Idle","status":"Lançado","description":"Mundo idle com criaturas, profissões, desafios cooperativos e sistemas de progressão no navegador.","tagline":"Construa sua equipe e explore no seu ritmo.","accent":"#65c6ff","features":["Profissões","Dungeons","Guildas e PvP"]}'::jsonb
  ),
  (
    'frenetic-world',
    'Frenetic World',
    'https://www.frenetic.world/',
    null,
    'https://altgrid.com.br/assets/game-icons/frenetic-world-official.png',
    true,
    103,
    '{"category":"MMORPG Idle","status":"Lançado","description":"MMORPG em pixel art com classes, caçadas AFK, equipamentos, bosses e mercado entre jogadores.","tagline":"Forje seu herói em um mundo pixel art.","accent":"#ff795c","features":["Classes e subclasses","Bosses globais","Caçadas AFK"]}'::jsonb
  ),
  (
    'pokepixel-idle',
    'Pokepixel Idle',
    'https://pokepixel.nietore.com/',
    null,
    'https://altgrid.com.br/assets/game-icons/pokepixel-idle-official.png',
    true,
    106,
    '{"category":"Poke Idle","status":"Lançado","description":"MMORPG idle com caçadas temáticas, profissões, comércio e progressão persistente.","tagline":"Sua jornada continua mesmo longe do jogo.","accent":"#63e1bb","features":["Caçadas temáticas","Profissões","Mercado global"]}'::jsonb
  ),
  (
    'pokeidle-br',
    'PokeIdle BR',
    'https://poke.idlebr.com/',
    null,
    'https://altgrid.com.br/assets/game-icons/pokeidle-br-official.png',
    true,
    108,
    '{"category":"Poke Idle","status":"Beta","description":"Jogo idle brasileiro com caçadas, captura, negociação e progresso que continua fora da sessão.","tagline":"Caçe, capture e acompanhe o progresso.","accent":"#f3c94e","features":["Caçadas persistentes","Captura","Economia de jogadores"]}'::jsonb
  ),
  (
    'idlepokemoon',
    'Idle Poke Moon',
    'https://idlepokemoon.com.br/',
    null,
    'https://altgrid.com.br/assets/game-icons/idlepokemoon-official.png',
    true,
    115,
    '{"category":"Poke Idle","status":"Beta","description":"MMORPG idle de captura com centenas de criaturas, zonas de caça, ginásios, PvP ranqueado, clãs e mercado entre jogadores.","tagline":"Capture, evolua e dispute o ranking.","accent":"#7057d9","features":["Captura e evolução","PvP ranqueado","Clãs e mercado"]}'::jsonb
  ),
  (
    'poke-hero-world',
    'Poke Hero World',
    'https://pokehero.com.br/',
    null,
    'https://altgrid.com.br/assets/game-icons/poke-hero-world-official.png',
    true,
    116,
    '{"category":"Poke Idle","status":"Lançado","description":"MMORPG idle no navegador com caçadas configuráveis, evolução persistente e progresso que continua enquanto você está fora.","tagline":"Configure a caçada e continue evoluindo.","accent":"#f0c944","features":["Caçadas configuráveis","Progresso offline","Mundo persistente"]}'::jsonb
  ),
  (
    'jerimbia-idle',
    'Jerimbia Idle',
    'https://jerimbia-idle.com/',
    null,
    'https://altgrid.com.br/assets/game-icons/jerimbia-idle-official.png',
    true,
    117,
    '{"category":"Poke Idle","status":"Beta","description":"Jogo idle de criaturas com evolução, batalhas, PvP, guildas e eventos em uma experiência online de navegador.","tagline":"Colecione criaturas e fortaleça sua guilda.","accent":"#ff8848","features":["Coleção de criaturas","PvP e guildas","Eventos online"]}'::jsonb
  ),
  (
    'pokehunt',
    'PokéHunt',
    'https://pkhunt.online/',
    null,
    'https://altgrid.com.br/assets/game-icons/pokehunt-official.png',
    true,
    118,
    '{"category":"Poke Idle","status":"Beta","description":"MMORPG idle de captura com centenas de espécies, regiões de caça, arena, chefes e evolução automática da equipe.","tagline":"Monte sua equipe e explore novas regiões.","accent":"#ef4545","features":["Centenas de espécies","Arena e chefes","Caçadas automáticas"]}'::jsonb
  ),
  (
    'gengar-idle',
    'Gengar Idle',
    'https://gengar.com.br/',
    null,
    'https://altgrid.com.br/assets/game-icons/gengar-idle-official.png',
    true,
    119,
    '{"category":"Poke Idle","status":"Beta","description":"Aventura idle de criaturas focada em coleção, estratégia de equipe e progresso contínuo direto no navegador.","tagline":"Descubra criaturas e avance todos os dias.","accent":"#8b5cf6","features":["Coleção de criaturas","Estratégia de equipe","Progressão contínua"]}'::jsonb
  ),
  (
    'idledex',
    'idleDEX',
    'https://idledex.com/',
    null,
    'https://altgrid.com.br/assets/game-icons/idledex-official.png',
    true,
    120,
    '{"category":"Poke Idle","status":"Lançado","description":"MMO de captura no navegador com evolução compartilhada, automação de progresso e comunidade de treinadores.","tagline":"Ative o automático e volte para conferir o progresso.","accent":"#55c6ff","features":["Captura e evolução","Progresso automático","Mundo multiplayer"]}'::jsonb
  ),
  (
    'idle-world',
    'Idle World',
    'https://idleworld.online/',
    null,
    'https://altgrid.com.br/assets/game-icons/idle-world-official.png',
    true,
    121,
    '{"category":"Tibia Idle","status":"Beta","description":"Mundo persistente de navegador com caçadas, mercado e uma progressão automática pensada para continuar por longo prazo.","tagline":"Um mundo grande com progressão contínua.","accent":"#39d98a","features":["Caçadas persistentes","Mercado entre jogadores","Progressão automática"]}'::jsonb
  )
on conflict (slug) do update
set
  name = excluded.name,
  launch_url = excluded.launch_url,
  developer_referral_url = excluded.developer_referral_url,
  icon_url = excluded.icon_url,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata,
  updated_at = now();

commit;
