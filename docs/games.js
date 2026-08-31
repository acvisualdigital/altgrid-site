import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const config = window.ALTGRID_SITE_CONFIG ?? {}
const API_BASE_URL = String(config.apiBaseUrl ?? '').replace(/\/$/, '')
const supabase = config.supabaseUrl && config.supabaseAnonKey
  ? window.ALTGRID_SUPABASE_CLIENT ?? createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { autoRefreshToken: true, detectSessionInUrl: true, persistSession: true } })
  : null
if (supabase) window.ALTGRID_SUPABASE_CLIENT = supabase

const fallbackPresentation = {
  huntera: { category: 'Tibia Idle', status: 'Lançado', description: 'Caçadas old-school, progressão persistente e combate automatizado para acompanhar no navegador.', tagline: 'Evolua mesmo longe do teclado.', accent: '#e8a83e', features: ['Caçadas e progressão persistente', 'Economia e equipamentos', 'Comunidade brasileira ativa'] },
  huntidle: { category: 'Tibia Idle', status: 'Lançado', description: 'Um RPG idle de caçada e evolução contínua, pronto para múltiplas sessões no AltGrid.', tagline: 'Caçar, evoluir e organizar.', accent: '#d8b861', features: ['Progressão contínua', 'Múltiplos personagens', 'Combate inspirado em MMORPG clássico'] },
  pokeidleworld: { category: 'Poke Idle', status: 'Beta', description: 'Capture, treine e evolua sua equipe enquanto o mundo continua ativo.', tagline: 'Sua jornada continua em segundo plano.', accent: '#49a7ff', features: ['Captura e treinamento', 'Coleção de criaturas', 'Evolução de equipe'] },
  ragnaidle: { category: 'Ragnarok Idle', status: 'Beta', description: 'Classes, builds e progressão inspiradas em Rune-Midgard dentro de uma experiência idle.', tagline: 'Classes clássicas em ritmo idle.', accent: '#77cfff', features: ['Classes e builds', 'Equipamentos e atributos', 'Progressão offline'] },
  pokedream: { category: 'Poke Idle', status: 'Em desenvolvimento', description: 'Monte um time raro, acompanhe suas caçadas e evolua todos os dias.', tagline: 'Monte o time dos seus sonhos.', accent: '#a875ff', features: ['Coleção de criaturas', 'Formação de equipes', 'Eventos de progressão'] },
  stonegy: { category: 'Tibia Idle', status: 'Lançado', description: 'Progressão lenta e estratégica para quem gosta da essência dos primeiros Tibia idle.', tagline: 'A jornada idle para quem gosta de longo prazo.', accent: '#d7a717', features: ['Progressão estratégica', 'Economia baseada em jogadores', 'Combate de longo prazo'] },
  'tib-idle': { category: 'Tibia Idle', status: 'Beta', description: 'Combate automático, equipamentos e evolução persistente em um mundo de navegador.', tagline: 'Um novo mundo para evoluir.', accent: '#78d996', features: ['Combate automático', 'Sistema de equipamentos', 'Evolução persistente'] },
  baiak: { category: 'Tibia Idle', status: 'Lançado', description: 'Evolução acelerada, bosses e equipamentos no estilo Baiak adaptado ao idle.', tagline: 'Progressão rápida e batalhas intensas.', accent: '#ff775e', features: ['Bosses e desafios', 'Evolução acelerada', 'Equipamentos especiais'] },
}
const previewCatalog = [
  ['huntera', 'Huntera', 'https://huntera.com.br/game', 'https://huntera.com.br/assets/ui/huntera-logo.png'],
  ['huntidle', 'Hunt Idle', 'https://tibiahuntidle.com/', 'https://i.postimg.cc/mkVQJN5g/hunt-idle-icon-192.png'],
  ['pokeidleworld', 'Poke Idle World', 'https://poke.idleworld.online/', 'https://poke.idleworld.online/assets/landing/logo.png'],
  ['ragnaidle', 'RagnaIdle', 'https://www.ragnaidle.com.br/', 'https://www.ragnaidle.com.br/favicon.png'],
  ['pokedream', 'Pokedream', 'https://pokedream.com.br/', 'https://pokedream.com.br/ui/toolbar/pokemon.png'],
  ['stonegy', 'Stonegy', 'https://stonegy-online.com/', 'https://imglink.cc/cdn/TRT5oi3NEb.png'],
  ['tib-idle', 'Tib Idle', 'https://play.tibidle.com/', 'https://tibiaidle.com/images/icon.png'],
  ['baiak', 'Baiak', 'https://baiakidle.com/', 'https://baiakidle.com/img/baiak-idle.png'],
].map(([slug, name, launch_url, icon_url], sort_order) => ({ id: `preview-${slug}`, slug, name, launch_url, developer_referral_url: null, icon_url, sort_order, metadata: {}, preview: true }))

const state = { games: [], query: '', category: 'all', status: 'all', sort: 'votes', favoritesOnly: false, rankingMode: 'votes', session: null, favorites: new Set(), social: {}, community: {}, activeGame: null, publisherIntent: null }
const grid = document.querySelector('[data-game-grid]')
const empty = document.querySelector('[data-catalog-empty]')
const controls = document.querySelector('[data-catalog-controls]')
const authDialog = document.querySelector('[data-auth-dialog]')
const authForm = document.querySelector('[data-auth-form]')
const authMessage = document.querySelector('[data-auth-message]')
const memberPanel = document.querySelector('[data-member-panel]')
const gameDialog = document.querySelector('[data-game-dialog]')
const publisherDialog = document.querySelector('[data-publisher-dialog]')
const publisherAccount = document.querySelector('[data-publisher-account]')
const spotlightCard = document.querySelector('[data-spotlight-card]')
const number = new Intl.NumberFormat('pt-BR')
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const revealObserver = !reduceMotion && 'IntersectionObserver' in window
  ? new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
  : null
const observeReveals = (root = document) => {
  root.querySelectorAll('.reveal-item:not(.is-visible)').forEach((element) => {
    if (revealObserver) revealObserver.observe(element)
    else element.classList.add('is-visible')
  })
}

const trackSiteEvent = (name, parameters = {}) => {
  if (typeof window.gtag !== 'function') return
  window.gtag('event', name, parameters)
}

const escapeHtml = (value) => String(value).replace(
  /[&<>'"]/g,
  (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character],
)

document.querySelectorAll('.ranking-section,.discovery-hub__grid > article,.game-owner-bar,.spotlight-card,.catalog-heading,.idle-guide__heading,.idle-guide__grid > article,.idle-guide__method,.publisher-heading,.publisher-plans > article,.publisher-process > article')
  .forEach((element) => element.classList.add('reveal-item'))
observeReveals()

if ('IntersectionObserver' in window) {
  const railLinks = [...document.querySelectorAll('[data-catalog-rail] a')]
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
    if (!visible?.target.id) return
    railLinks.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === `#${visible.target.id}`))
  }, { rootMargin: '-28% 0px -58% 0px', threshold: [0, .2, .6] })
  document.querySelectorAll('#ranking,#radar,#holofote,#lista,#guia,#anunciar').forEach((section) => sectionObserver.observe(section))
}

const metadata = (game) => {
  const source = game?.metadata && typeof game.metadata === 'object' && !Array.isArray(game.metadata) ? game.metadata : {}
  const fallback = fallbackPresentation[game.slug] ?? {}
  return {
    accent: typeof source.accent === 'string' ? source.accent : fallback.accent ?? '#25e66f',
    category: typeof source.category === 'string' ? source.category : fallback.category ?? 'MMORPG Idle',
    description: typeof source.description === 'string' ? source.description : fallback.description ?? `${game.name} é um jogo idle disponível no AltGrid.`,
    tagline: typeof source.tagline === 'string' ? source.tagline : fallback.tagline ?? 'Descubra um novo mundo idle.',
    status: typeof source.status === 'string' ? source.status : fallback.status ?? 'Disponível',
    features: Array.isArray(source.features) ? source.features.slice(0, 6).map(String) : fallback.features ?? ['Progressão idle', 'Comunidade online', 'Compatível com AltGrid'],
    votes: 0,
    likes: 0,
    reviews: 0,
    rating: 0,
    visits: 0,
    votes12h: 0,
  }
}

const storageScope = () => state.session?.user?.id ?? 'guest'
const storageKey = (name) => `altgrid.site.${name}.v2:${storageScope()}`
const socialStorageKey = () => `altgrid.site.game-community.v5:${storageScope()}`
const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback } catch { return fallback } }
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* opcional */ } }
const readLocalState = () => { state.favorites = new Set(readJson(storageKey('favorite-games'), [])); state.social = readJson(socialStorageKey(), {}) }
const storeLocalState = () => { writeJson(storageKey('favorite-games'), [...state.favorites]); writeJson(socialStorageKey(), state.social) }
const safeGameUrl = (candidate) => { try { const url = new URL(candidate); return url.protocol === 'https:' ? url.href : '' } catch { return '' } }
const safeImageUrl = (candidate) => {
  try {
    const url = new URL(candidate, window.location.href)
    const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname)
    return url.protocol === 'https:' || (url.protocol === 'http:' && loopback) ? url.href : ''
  } catch { return '' }
}
const localSocial = (slug) => state.social[slug] ?? { liked: false, votedAt: null, visits: 0, review: null }
const socialView = (game) => {
  const base = metadata(game); const local = localSocial(game.slug); const remote = state.community[game.slug]
  if (remote) return { ...base, ...remote, visits: base.visits + (local.visits || 0), local }
  const ownRating = Number(local.review?.rating ?? 0)
  const reviews = base.reviews + (local.review ? 1 : 0); const rating = reviews ? ((base.rating * base.reviews) + ownRating) / reviews : 0
  const localVoteIsRecent = local.votedAt && Date.now() - new Date(local.votedAt).getTime() <= 12 * 60 * 60 * 1000
  return { ...base, votes: base.votes + (local.votedAt ? 1 : 0), votes12h: base.votes12h + (localVoteIsRecent ? 1 : 0), likes: base.likes + (local.liked ? 1 : 0), reviews, rating, visits: base.visits + (local.visits || 0), local }
}
const totalFor = (game, mode) => { const view = socialView(game); return mode === 'likes' ? view.likes : mode === 'rating' ? view.rating : view.votes }
const rankedGames = (mode = state.rankingMode) => [...state.games].sort((a, b) => totalFor(b, mode) - totalFor(a, mode) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, 'pt-BR'))

function openAuth() {
  if (state.session) { state.favoritesOnly = true; controls.elements.favorites.setAttribute('aria-pressed', 'true'); renderGames(); document.querySelector('#lista')?.scrollIntoView({ behavior: 'smooth' }); return }
  if (!supabase) authMessage.textContent = 'O login está temporariamente indisponível.'
  authDialog.showModal()
}
const requireAccount = () => { if (state.session) return true; closeGame(); openAuth(); return false }

const publisherPlans = Object.freeze({
  highlight_7: { label: 'Destaque por 7 dias', price: 'R$ 29,90' },
  launch_30: { label: 'Lançamento por 30 dias', price: 'R$ 79,90' },
})
const localPublisherKey = () => `altgrid.site.publisher-requests.v1:${storageScope()}`
const isLocalPreview = ['127.0.0.1', 'localhost'].includes(window.location.hostname)

const loadCommunity = async () => {
  if (!supabase || isLocalPreview) return
  const { data: totals, error: totalsError } = await supabase.rpc('get_site_game_community')
  if (!totalsError && Array.isArray(totals)) {
    state.community = Object.fromEntries(totals.map((entry) => [entry.game_slug, {
      votes: Number(entry.votes || 0), votes12h: Number(entry.votes_12h || 0), likes: Number(entry.likes || 0),
      reviews: Number(entry.reviews || 0), rating: Number(entry.rating || 0),
    }]))
  }
  state.favorites = new Set()
  state.social = {}
  if (!state.session?.user) return
  const { data: own, error: ownError } = await supabase.rpc('get_my_site_game_state')
  if (ownError || !Array.isArray(own)) return
  own.forEach((entry) => {
    if (entry.favorited) state.favorites.add(entry.game_slug)
    state.social[entry.game_slug] = {
      liked: Boolean(entry.liked),
      votedAt: entry.last_voted_at,
      visits: 0,
      review: entry.review_rating ? {
        rating: Number(entry.review_rating), comment: entry.review_comment, createdAt: entry.review_created_at,
      } : null,
    }
  })
}

const refreshCommunity = async () => { await loadCommunity(); renderAll() }

const toggleFavorite = async (game) => {
  if (!requireAccount()) return
  if (isLocalPreview) {
    state.favorites.has(game.slug) ? state.favorites.delete(game.slug) : state.favorites.add(game.slug)
    storeLocalState(); renderAll(); return
  }
  const { error } = await supabase.rpc('toggle_site_game_favorite', { p_game_slug: game.slug })
  if (error) { window.alert('Não foi possível alterar sua lista agora. Tente novamente.'); return }
  await refreshCommunity()
}

const renderSpotlight = (campaign = null) => {
  if (!spotlightCard) return
  const title = spotlightCard.querySelector('[data-spotlight-title]')
  const description = spotlightCard.querySelector('[data-spotlight-description]')
  const image = spotlightCard.querySelector('[data-spotlight-image]')
  const cta = spotlightCard.querySelector('[data-spotlight-cta]')
  const period = spotlightCard.querySelector('[data-spotlight-period]')
  const payload = campaign?.payload && typeof campaign.payload === 'object' ? campaign.payload : null
  const game = state.games.find((candidate) => candidate.slug === campaign?.game_slug)
  const banner = payload ? safeImageUrl(payload.banner_url) : ''
  spotlightCard.classList.toggle('is-house', !payload)
  title.textContent = payload?.headline || 'Seu jogo pode ser o próximo destaque.'
  description.textContent = payload?.ad_description || 'Apresente seu jogo para uma comunidade que já procura novos jogos idle, eventos e atualizações.'
  image.src = banner || 'assets/altgrid-hero.png'
  image.alt = payload ? `Campanha de ${game?.name || 'jogo em destaque'}` : 'AltGrid organizando jogos idle'
  cta.textContent = payload?.cta_label || 'Colocar meu jogo no Holofote'
  period.textContent = payload ? `${game?.name || 'Jogo em destaque'} · conteúdo patrocinado` : 'Espaço demonstrativo · nenhuma campanha ativa'
  cta.onclick = payload && safeGameUrl(game?.launch_url)
    ? () => window.open(safeGameUrl(game.launch_url), '_blank', 'noopener,noreferrer')
    : () => openPublisher('campaign', game ? { gameSlug: game.slug } : {})
}

const loadSpotlight = async () => {
  let campaign = null
  if (supabase) {
    const { data, error } = await supabase.rpc('get_active_site_spotlight')
    if (!error && Array.isArray(data) && data.length) campaign = data[0]
  }
  if (!campaign && isLocalPreview) {
    const localCampaigns = readJson(localPublisherKey(), []).filter((entry) => entry.request_type === 'campaign')
    campaign = localCampaigns.at(-1) ?? null
  }
  renderSpotlight(campaign)
}

const setPublisherMessage = (type, message, tone = '') => {
  const host = document.querySelector(`[data-publisher-message="${type}"]`)
  if (!host) return
  host.textContent = message
  host.className = tone ? `is-${tone}` : ''
}

const setPublisherTab = (type) => {
  const requested = ['register', 'claim', 'campaign'].includes(type) ? type : 'register'
  document.querySelectorAll('[data-publisher-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.publisherTab === requested))
  document.querySelectorAll('[data-publisher-form]').forEach((form) => { form.hidden = form.dataset.publisherForm !== requested })
}

const renderPublisherAccount = () => {
  if (!publisherAccount) return
  const identity = state.session?.user?.user_metadata?.full_name || state.session?.user?.email
  publisherAccount.classList.toggle('is-connected', Boolean(identity))
  publisherAccount.querySelector('p').textContent = identity
    ? `Solicitação vinculada a ${identity}. Você poderá acompanhar o andamento pela sua conta.`
    : 'Entre com sua conta AltGrid para enviar e acompanhar solicitações.'
}

const populatePublisherGames = () => {
  document.querySelectorAll('[data-publisher-game-select]').forEach((select) => {
    const current = select.value
    select.querySelectorAll('option:not(:first-child)').forEach((option) => option.remove())
    state.games.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).forEach((game) => {
      const option = document.createElement('option'); option.value = game.slug; option.textContent = game.name; select.append(option)
    })
    if ([...select.options].some((option) => option.value === current)) select.value = current
  })
}

const loadPublisherRequests = async () => {
  const history = document.querySelector('[data-publisher-history]')
  const list = document.querySelector('[data-publisher-history-list]')
  if (!history || !list || !state.session?.user) { if (history) history.hidden = true; return }
  history.hidden = false
  list.innerHTML = '<p class="publisher-history__empty">Carregando solicitações…</p>'
  let remote = []
  const { data, error } = await supabase
    .from('site_developer_requests')
    .select('id,request_type,game_slug,plan_code,status,payload,created_at')
    .order('created_at', { ascending: false })
    .limit(8)
  if (!error && Array.isArray(data)) remote = data
  const local = isLocalPreview ? readJson(localPublisherKey(), []) : []
  const entries = [...remote, ...local]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 8)
  if (!entries.length) { list.innerHTML = '<p class="publisher-history__empty">Nenhuma solicitação enviada por esta conta.</p>'; return }
  const typeLabels = { register: 'Cadastro', claim: 'Reivindicação', campaign: 'Campanha' }
  const statusLabels = { pending: 'Aguardando análise', reviewing: 'Em análise', approved: 'Aprovada', rejected: 'Não aprovada', cancelled: 'Cancelada', local_preview: 'Prévia local' }
  list.replaceChildren(...entries.map((entry) => {
    const item = document.createElement('article'); item.className = 'publisher-history__item'
    const game = state.games.find((candidate) => candidate.slug === entry.game_slug)
    const title = document.createElement('strong'); title.textContent = `${typeLabels[entry.request_type] || 'Solicitação'} · ${entry.payload?.name || game?.name || 'Novo jogo'}`
    const detail = document.createElement('small'); detail.textContent = `${entry.plan_code && publisherPlans[entry.plan_code] ? `${publisherPlans[entry.plan_code].label} · ` : ''}${new Date(entry.created_at).toLocaleDateString('pt-BR')}`
    const status = document.createElement('span'); status.textContent = statusLabels[entry.status] || entry.status; status.classList.toggle('is-approved', entry.status === 'approved')
    item.append(title, detail, status); return item
  }))
}

const openPublisher = (type = 'register', options = {}) => {
  if (!state.session) {
    state.publisherIntent = { type, ...options }
    if (gameDialog.open) closeGame()
    authMessage.textContent = 'Entre para cadastrar, reivindicar ou anunciar um jogo.'
    if (!authDialog.open) authDialog.showModal()
    return
  }
  if (gameDialog.open) closeGame()
  populatePublisherGames(); renderPublisherAccount(); setPublisherTab(type)
  document.querySelectorAll('[data-publisher-game-select]').forEach((select) => {
    if (options.gameSlug && [...select.options].some((option) => option.value === options.gameSlug)) select.value = options.gameSlug
  })
  if (options.planCode && publisherPlans[options.planCode]) {
    const plan = document.querySelector(`[data-publisher-form="campaign"] input[name="plan_code"][value="${options.planCode}"]`)
    if (plan) plan.checked = true
  }
  const startInput = document.querySelector('[data-publisher-form="campaign"] input[name="starts_on"]')
  if (startInput) {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    startInput.min = tomorrow
    if (!startInput.value) startInput.value = tomorrow
  }
  if (!publisherDialog.open) publisherDialog.showModal()
  void loadPublisherRequests()
}

const submitPublisherRequest = async (form) => {
  const type = form.dataset.publisherForm
  const message = document.querySelector(`[data-publisher-message="${type}"]`)
  if (!state.session?.user || !type) { openPublisher(type); return }
  const data = Object.fromEntries(new FormData(form).entries())
  if (type === 'register' && (!safeGameUrl(data.site_url) || !safeGameUrl(data.logo_url))) {
    setPublisherMessage(type, 'Use endereços HTTPS válidos para o site e para a logo oficial.', 'error'); return
  }
  if (type === 'campaign' && !safeGameUrl(data.banner_url)) {
    setPublisherMessage(type, 'Use um endereço HTTPS válido para a imagem da campanha.', 'error'); return
  }
  const planCode = type === 'campaign' ? String(data.plan_code || '') : null
  if (planCode && !publisherPlans[planCode]) { setPublisherMessage(type, 'Escolha um plano válido.', 'error'); return }
  const request = {
    user_id: state.session.user.id,
    request_type: type,
    game_slug: type === 'register' ? null : String(data.game_slug || ''),
    plan_code: planCode,
    payload: data,
  }
  if (type !== 'register' && !request.game_slug) { setPublisherMessage(type, 'Selecione o jogo.', 'error'); return }
  setPublisherMessage(type, 'Enviando para análise…')
  const { error } = await supabase.from('site_developer_requests').insert(request)
  if (error && isLocalPreview) {
    const local = readJson(localPublisherKey(), [])
    local.push({ ...request, id: crypto.randomUUID(), status: 'local_preview', created_at: new Date().toISOString() })
    writeJson(localPublisherKey(), local)
    const plan = planCode ? ` — ${publisherPlans[planCode].label}, ${publisherPlans[planCode].price}` : ''
    setPublisherMessage(type, `Prévia salva neste navegador${plan}. Nenhum pagamento foi iniciado.`, 'success')
    form.reset(); await loadPublisherRequests(); await loadSpotlight(); return
  }
  if (error) { setPublisherMessage(type, 'Não foi possível enviar agora. Tente novamente em instantes.', 'error'); return }
  const success = type === 'campaign'
    ? 'Campanha enviada para revisão. O pagamento só será solicitado após a aprovação.'
    : 'Solicitação enviada. Você receberá o andamento pela conta AltGrid.'
  setPublisherMessage(type, success, 'success'); form.reset(); await loadPublisherRequests(); await loadSpotlight()
}

const renderMember = () => {
  const loginButtons = document.querySelectorAll('[data-open-auth]')
  if (state.session?.user) {
    const identity = state.session.user.user_metadata?.full_name || state.session.user.email || 'Conta AltGrid'
    memberPanel.innerHTML = '<span>Conectado</span><strong></strong><button data-sign-out type="button">Sair desta conta</button>'
    memberPanel.querySelector('strong').textContent = identity
    memberPanel.querySelector('[data-sign-out]').addEventListener('click', async () => { await supabase?.auth.signOut(); state.session = null; readLocalState(); renderMember(); renderAll() })
    loginButtons.forEach((button) => { button.textContent = 'Minha lista'; button.dataset.authenticated = 'true' })
  } else {
    memberPanel.innerHTML = '<span>Visitante</span><strong>Entre para votar e montar sua lista</strong><button data-open-auth type="button">Usar minha conta AltGrid</button>'
    memberPanel.querySelector('[data-open-auth]').addEventListener('click', openAuth)
    loginButtons.forEach((button) => { button.textContent = button.closest('.site-nav') ? 'Entrar' : 'Salvar favoritos'; delete button.dataset.authenticated })
  }
  renderPublisherAccount()
}

const iconElement = (game, className) => {
  const icon = document.createElement('div'); icon.className = className
  if (safeImageUrl(game.icon_url)) { const image = new Image(); image.src = safeImageUrl(game.icon_url); image.alt = `Ícone de ${game.name}`; image.loading = 'lazy'; icon.append(image) } else icon.textContent = game.name.slice(0, 2).toUpperCase()
  return icon
}

const renderHeroDeck = () => {
  const host = document.querySelector('[data-hero-games]')
  if (!host) return
  const featured = state.games
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 3)
  host.replaceChildren(...featured.map((game, index) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'hero-game'
    const copy = document.createElement('span')
    const title = document.createElement('strong'); title.textContent = game.name
    const detail = document.createElement('small'); detail.textContent = `${metadata(game).category} · ${metadata(game).status}`
    copy.append(title, detail)
    const arrow = document.createElement('span'); arrow.textContent = index === 0 ? 'EM ALTA ↗' : 'ABRIR ↗'
    item.append(iconElement(game, 'hero-game__icon'), copy, arrow)
    item.addEventListener('click', () => openGame(game))
    return item
  }))
}

const gameCard = (game, index) => {
  const view = socialView(game)
  const article = document.createElement('article'); article.className = `game-card reveal-item${game.site_only ? ' is-community' : ''}`; article.style.setProperty('--game-glow', `${view.accent}38`)
  const visual = document.createElement('div'); visual.className = 'game-card__visual'
  const rank = document.createElement('span'); rank.className = 'game-card__rank'; rank.textContent = String(index + 1).padStart(2, '0')
  const favorite = document.createElement('button'); favorite.className = 'game-card__favorite'; favorite.type = 'button'; favorite.textContent = state.favorites.has(game.slug) ? '♥' : '♡'; favorite.setAttribute('aria-pressed', String(state.favorites.has(game.slug))); favorite.setAttribute('aria-label', `${state.favorites.has(game.slug) ? 'Remover' : 'Adicionar'} ${game.name} da minha lista`)
  favorite.addEventListener('click', () => { void toggleFavorite(game) })
  visual.append(rank, iconElement(game, 'game-card__icon'), favorite)
  const body = document.createElement('div'); body.className = 'game-card__body'
  const statusClass = view.status === 'Lançado' || view.status === 'Disponível' ? 'is-live' : view.status === 'Beta' ? 'is-beta' : 'is-development'
  const tags = document.createElement('div'); tags.className = 'game-card__meta'; tags.innerHTML = `<span>${escapeHtml(view.category)}</span><span class="${statusClass}">${escapeHtml(view.status)}</span>`
  const title = document.createElement('h3'); title.textContent = game.name
  const description = document.createElement('p'); description.textContent = view.description
  const social = document.createElement('div'); social.className = 'game-card__social'; social.innerHTML = `<span><b>▲ ${number.format(view.votes)}</b> votos</span><span><b>♥ ${number.format(view.likes)}</b> curtidas</span><span><b>★ ${view.rating ? view.rating.toFixed(1) : '—'}</b> ${number.format(view.reviews)} notas</span>`
  const activity = document.createElement('small'); activity.className = 'game-card__activity'; activity.textContent = view.votes12h ? `↗ ${number.format(view.votes12h)} voto${view.votes12h === 1 ? '' : 's'} nas últimas 12h` : 'Sem votos nas últimas 12h'
  const footer = document.createElement('div'); footer.className = 'game-card__footer'; footer.innerHTML = `<small>${game.site_only ? 'Catálogo da comunidade' : 'Compatível com AltGrid'}</small>`
  const details = document.createElement('button'); details.type = 'button'; details.textContent = 'Ver detalhes →'; details.addEventListener('click', () => openGame(game))
  footer.append(details); body.append(tags, title, description, social, activity, footer); article.append(visual, body)
  return article
}

function filteredGames() {
  const terms = state.query.toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean)
  const games = state.games.filter((game) => { const view = metadata(game); const haystack = `${game.name} ${game.slug} ${view.category} ${view.status} ${view.description}`.toLocaleLowerCase('pt-BR'); return terms.every((term) => haystack.includes(term)) && (state.category === 'all' || view.category === state.category) && (state.status === 'all' || view.status === state.status) && (!state.favoritesOnly || state.favorites.has(game.slug)) })
  if (['votes', 'likes', 'rating'].includes(state.sort)) games.sort((a, b) => totalFor(b, state.sort) - totalFor(a, state.sort) || a.name.localeCompare(b.name, 'pt-BR'))
  if (state.sort === 'name') games.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  if (state.sort === 'newest') games.sort((a, b) => (b.sort_order ?? 0) - (a.sort_order ?? 0))
  return games
}

function renderGames() {
  const games = filteredGames(); grid.replaceChildren(...games.map(gameCard)); empty.hidden = games.length > 0; observeReveals(grid)
  document.querySelector('[data-result-total]').textContent = String(games.length)
  document.querySelector('[data-catalog-state]').textContent = state.favoritesOnly ? 'Mostrando sua lista pessoal' : 'Ranking e catálogo AltGrid'
}

function renderStats() {
  const totals = state.games.reduce((acc, game) => { const view = socialView(game); acc.votes += view.votes; acc.likes += view.likes; acc.reviews += view.reviews; acc.visits += view.visits; return acc }, { votes: 0, likes: 0, reviews: 0, visits: 0 })
  document.querySelector('[data-monthly-votes]').textContent = number.format(totals.votes); document.querySelector('[data-total-likes]').textContent = number.format(totals.likes); document.querySelector('[data-total-reviews]').textContent = number.format(totals.reviews); document.querySelector('[data-total-visits]').textContent = number.format(totals.visits)
  const podium = document.querySelector('[data-ranking-podium]'); podium.replaceChildren(...rankedGames().slice(0, 3).map((game, index) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'podium-card'; const view = socialView(game)
    const copy = document.createElement('div'); const score = state.rankingMode === 'likes' ? `${number.format(view.likes)} curtidas` : state.rankingMode === 'rating' ? `${view.rating ? view.rating.toFixed(1) : '—'} de 5` : `${number.format(view.votes)} votos`
    copy.innerHTML = `<strong></strong><small>${escapeHtml(score)}</small>`; copy.querySelector('strong').textContent = game.name
    const rank = document.createElement('span'); rank.className = 'podium-card__rank'; rank.textContent = `#${index + 1}`
    card.append(rank, iconElement(game, 'podium-card__icon'), copy); card.addEventListener('click', () => openGame(game)); return card
  }))
}

const filterByStatus = (status) => {
  state.status = status; controls.elements.status.value = status; renderGames(); document.querySelector('#lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function renderDiscovery() {
  const categoryHost = document.querySelector('[data-quick-categories]')
  const categories = [...new Set(state.games.map((game) => metadata(game).category))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  categoryHost.replaceChildren(...categories.map((category) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quick-category'; button.textContent = category
    button.addEventListener('click', () => { state.category = category; controls.elements.category.value = category; renderGames(); document.querySelector('#lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) })
    return button
  }))
  const statusConfig = [
    ['Lançado', '#25e66f'],
    ['Beta', '#e8a83e'],
    ['Em desenvolvimento', '#8e7cff'],
  ]
  const radar = document.querySelector('[data-status-radar]')
  radar.replaceChildren(...statusConfig.map(([status, color]) => {
    const count = state.games.filter((game) => metadata(game).status === status).length
    const button = document.createElement('button'); button.type = 'button'; button.style.setProperty('--status-color', color); button.innerHTML = `<span><i></i>${escapeHtml(status)}</span><strong>${count}</strong>`; button.addEventListener('click', () => filterByStatus(status)); return button
  }))
  renderVoteAgenda()
}

function renderVoteAgenda() {
  const host = document.querySelector('[data-vote-agenda]')
  const entries = state.games.map((game) => ({ game, votedAt: localSocial(game.slug).votedAt })).filter((entry) => entry.votedAt).sort((a, b) => new Date(a.votedAt) - new Date(b.votedAt)).slice(0, 3)
  if (!entries.length) { host.innerHTML = '<p>Vote em um jogo para acompanhar quando o próximo voto será liberado.</p>'; return }
  host.replaceChildren(...entries.map(({ game, votedAt }) => {
    const releaseAt = new Date(votedAt).getTime() + 12 * 60 * 60 * 1000; const remaining = Math.max(0, releaseAt - Date.now()); const hours = Math.floor(remaining / 3600000); const minutes = Math.floor((remaining % 3600000) / 60000)
    const item = document.createElement('div'); item.className = 'agenda-item'; const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = game.name; const stateCopy = document.createElement('span'); stateCopy.textContent = remaining ? 'Próximo voto em' : 'Voto disponível agora'; copy.append(title, stateCopy)
    const time = document.createElement('time'); time.textContent = remaining ? `${hours}h ${minutes}min` : 'LIBERADO'; item.append(copy, time); return item
  }))
}

function reviewElement(review, fallbackIdentity = 'Jogador AltGrid') {
  const item = document.createElement('article'); item.className = 'review-item'
  const header = document.createElement('header'); const author = document.createElement('strong'); author.textContent = review.author || fallbackIdentity
  const stars = document.createElement('span'); stars.textContent = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating); header.append(author, stars)
  const comment = document.createElement('p'); comment.textContent = review.comment; item.append(header, comment); return item
}

async function renderReviews(game) {
  const list = document.querySelector('[data-review-list]')
  if (isLocalPreview || !supabase) {
    const review = localSocial(game.slug).review
    if (!review) { list.innerHTML = '<p class="review-empty">Ainda não há avaliações. Seja a primeira pessoa a contar como é jogar.</p>'; return }
    const identity = state.session?.user?.user_metadata?.full_name || state.session?.user?.email?.split('@')[0] || 'Jogador AltGrid'
    list.replaceChildren(reviewElement(review, identity)); return
  }
  list.innerHTML = '<p class="review-empty">Carregando avaliações…</p>'
  const { data, error } = await supabase.rpc('get_site_game_reviews', { p_game_slug: game.slug })
  if (state.activeGame?.slug !== game.slug) return
  if (error) { list.innerHTML = '<p class="review-empty">Não foi possível carregar as avaliações agora.</p>'; return }
  if (!Array.isArray(data) || !data.length) { list.innerHTML = '<p class="review-empty">Ainda não há avaliações. Seja a primeira pessoa a contar como é jogar.</p>'; return }
  list.replaceChildren(...data.map((review) => reviewElement({ ...review, rating: Number(review.rating) })))
}

function openGame(game, countVisit = true) {
  if (countVisit) {
    const visitKey = `altgrid.site.visited.v2:${game.slug}`
    if (!sessionStorage.getItem(visitKey)) { const entry = localSocial(game.slug); entry.visits = (entry.visits || 0) + 1; state.social[game.slug] = entry; sessionStorage.setItem(visitKey, '1'); storeLocalState() }
    trackSiteEvent('view_item', { content_type: 'idle_game', item_id: game.slug, item_name: game.name })
  }
  state.activeGame = game; const view = socialView(game); const local = localSocial(game.slug)
  document.querySelector('[data-detail-hero]').style.setProperty('--detail-glow', `${view.accent}42`)
  const icon = document.querySelector('[data-detail-icon]'); icon.replaceChildren(...iconElement(game, '').childNodes)
  document.querySelector('[data-detail-name]').textContent = game.name; document.querySelector('[data-detail-tagline]').textContent = view.tagline; document.querySelector('[data-detail-description]').textContent = view.description
  document.querySelector('[data-detail-tags]').innerHTML = `<span>${escapeHtml(view.category)}</span><span>${escapeHtml(view.status)}</span>`
  document.querySelector('[data-detail-rating]').textContent = view.rating ? `${view.rating.toFixed(1)} ★` : '—'; document.querySelector('[data-detail-votes]').textContent = number.format(view.votes); document.querySelector('[data-detail-likes]').textContent = number.format(view.likes); document.querySelector('[data-detail-visits]').textContent = number.format(view.visits)
  document.querySelector('[data-detail-features]').replaceChildren(...view.features.map((text) => { const li = document.createElement('li'); li.textContent = text; return li }))
  const like = document.querySelector('[data-detail-like]'); like.textContent = local.liked ? '♥ Curtido' : '♡ Curtir'; like.classList.toggle('is-active', Boolean(local.liked))
  const play = document.querySelector('[data-detail-play]'); const url = safeGameUrl(game.developer_referral_url) || safeGameUrl(game.launch_url); play.href = url || '#'; play.hidden = !url
  const reviewForm = document.querySelector('[data-review-form]'); reviewForm.elements.rating.value = String(local.review?.rating ?? 5); reviewForm.elements.comment.value = local.review?.comment ?? ''
  reviewForm.querySelector('button[type="submit"]').textContent = local.review ? 'Atualizar avaliação' : 'Publicar avaliação'
  const reviewMessage = document.querySelector('[data-review-message]')
  if (reviewForm.dataset.gameSlug !== game.slug) reviewMessage.textContent = ''
  reviewForm.dataset.gameSlug = game.slug
  void renderReviews(game)
  const urlState = new URL(window.location.href); urlState.searchParams.set('game', game.slug); history.replaceState({}, '', urlState); if (!gameDialog.open) gameDialog.showModal()
}

function closeGame() { if (gameDialog.open) gameDialog.close(); state.activeGame = null; const url = new URL(window.location.href); url.searchParams.delete('game'); history.replaceState({}, '', url) }
function renderAll() { renderGames(); renderStats(); renderVoteAgenda(); if (state.activeGame) { const current = state.activeGame; state.activeGame = null; openGame(current, false) } }

const hydrateCatalog = () => {
    const categories = [...new Set(state.games.map((game) => metadata(game).category))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    controls.elements.category.querySelectorAll('option:not(:first-child)').forEach((option) => option.remove())
    categories.forEach((value) => { const option = document.createElement('option'); option.value = value; option.textContent = value; controls.elements.category.append(option) })
    document.querySelectorAll('[data-game-total]').forEach((element) => { element.textContent = String(state.games.length) }); document.querySelector('[data-category-total]').textContent = String(categories.length)
    populatePublisherGames(); renderHeroDeck(); renderDiscovery(); renderAll(); const requested = new URL(window.location.href).searchParams.get('game'); const requestedGame = state.games.find((game) => game.slug === requested); if (requestedGame) openGame(requestedGame)
}

const loadCatalog = async () => {
  let communityGames = []
  try {
    const communityResponse = await fetch('catalog-games.json', { headers: { Accept: 'application/json' } })
    if (communityResponse.ok) {
      const communityPayload = await communityResponse.json()
      communityGames = Array.isArray(communityPayload.games)
        ? communityPayload.games.filter((game) => safeGameUrl(game?.launch_url))
        : []
    }
  } catch { /* o catálogo oficial continua disponível */ }

  let supportedGames = previewCatalog
  try {
    const response = await fetch(`${API_BASE_URL}/v1/games`, { headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json(); supportedGames = Array.isArray(payload.games) ? payload.games.filter((game) => game?.enabled !== false) : previewCatalog
  } catch { document.querySelector('[data-catalog-state]').textContent = 'Prévia local do catálogo AltGrid' }
  const bySlug = new Map([...supportedGames, ...communityGames].map((game) => [game.slug, game]))
  state.games = [...bySlug.values()]
  hydrateCatalog()
}

const syncSearchFields = (query) => {
  document.querySelectorAll('[data-hero-search] input[name="query"]')
    .forEach((input) => { if (input.value !== query) input.value = query })
}
const performCatalogSearch = (query) => {
  controls.elements.query.value = query
  syncSearchFields(query)
  state.query = query
  if (query) trackSiteEvent('search', { search_term: query })
  renderGames()
  document.querySelector('#lista')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
}
controls.addEventListener('input', () => { state.query = controls.elements.query.value.trim(); syncSearchFields(state.query); state.category = controls.elements.category.value; state.status = controls.elements.status.value; state.sort = controls.elements.sort.value; renderGames() })
document.querySelectorAll('[data-hero-search]').forEach((form) => form.addEventListener('submit', (event) => {
  event.preventDefault()
  performCatalogSearch(String(new FormData(event.currentTarget).get('query') ?? '').trim())
}))
controls.elements.favorites.addEventListener('click', () => { if (!requireAccount()) return; state.favoritesOnly = !state.favoritesOnly; controls.elements.favorites.setAttribute('aria-pressed', String(state.favoritesOnly)); renderGames() })
document.querySelector('[data-clear-filters]').addEventListener('click', () => { controls.reset(); state.query = ''; syncSearchFields(''); state.category = 'all'; state.status = 'all'; state.sort = 'votes'; state.favoritesOnly = false; controls.elements.favorites.setAttribute('aria-pressed', 'false'); renderGames() })
document.querySelectorAll('[data-ranking-mode]').forEach((button) => button.addEventListener('click', () => { state.rankingMode = button.dataset.rankingMode; document.querySelectorAll('[data-ranking-mode]').forEach((item) => item.classList.toggle('is-active', item === button)); renderStats() }))
document.querySelector('[data-only-released]').addEventListener('click', () => filterByStatus('Lançado'))
document.querySelectorAll('[data-open-auth]').forEach((button) => button.addEventListener('click', openAuth))
document.querySelector('[data-auth-close]').addEventListener('click', () => { authDialog.close(); authMessage.textContent = '' })
document.querySelector('[data-close-game]').addEventListener('click', closeGame); gameDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeGame() })
document.querySelector('[data-detail-claim]').addEventListener('click', () => { if (state.activeGame) openPublisher('claim', { gameSlug: state.activeGame.slug }) })
document.querySelectorAll('[data-publisher-open]').forEach((button) => button.addEventListener('click', () => openPublisher(button.dataset.publisherOpen, { planCode: button.dataset.publisherPlan })))
document.querySelectorAll('[data-publisher-tab]').forEach((button) => button.addEventListener('click', () => setPublisherTab(button.dataset.publisherTab)))
document.querySelector('[data-publisher-close]').addEventListener('click', () => publisherDialog.close())
document.querySelector('[data-publisher-refresh]').addEventListener('click', () => { void loadPublisherRequests() })
publisherDialog.addEventListener('cancel', (event) => { event.preventDefault(); publisherDialog.close() })
document.querySelectorAll('[data-publisher-form]').forEach((form) => form.addEventListener('submit', async (event) => { event.preventDefault(); if (form.reportValidity()) await submitPublisherRequest(form) }))
document.querySelector('[data-detail-like]').addEventListener('click', async () => {
  if (!state.activeGame || !requireAccount()) return
  const game = state.activeGame
  if (isLocalPreview) { const local = localSocial(game.slug); local.liked = !local.liked; state.social[game.slug] = local; storeLocalState(); renderAll(); return }
  const message = document.querySelector('[data-review-message]'); message.textContent = 'Atualizando curtida…'
  const { error } = await supabase.rpc('toggle_site_game_like', { p_game_slug: game.slug })
  if (error) { message.textContent = 'Não foi possível alterar a curtida agora.'; return }
  await refreshCommunity(); document.querySelector('[data-review-message]').textContent = 'Curtida atualizada.'
})
document.querySelector('[data-detail-play]').addEventListener('click', () => { if (state.activeGame) trackSiteEvent('select_content', { content_type: 'outbound_idle_game', item_id: state.activeGame.slug, item_name: state.activeGame.name }) })
document.querySelector('[data-detail-vote]').addEventListener('click', async () => {
  if (!state.activeGame || !requireAccount()) return
  const game = state.activeGame; const local = localSocial(game.slug); const message = document.querySelector('[data-review-message]'); const cooldown = 12 * 60 * 60 * 1000
  if (local.votedAt && Date.now() - new Date(local.votedAt).getTime() < cooldown) { message.textContent = 'Seu próximo voto libera 12 horas após o último.'; return }
  if (isLocalPreview) { local.votedAt = new Date().toISOString(); state.social[game.slug] = local; storeLocalState(); renderAll(); document.querySelector('[data-review-message]').textContent = 'Voto registrado.'; return }
  message.textContent = 'Registrando voto…'
  const { error } = await supabase.rpc('cast_site_game_vote', { p_game_slug: game.slug })
  if (error) { message.textContent = error.message?.includes('cooldown') ? 'Seu próximo voto libera 12 horas após o último.' : 'Não foi possível registrar o voto agora.'; return }
  await refreshCommunity(); document.querySelector('[data-review-message]').textContent = 'Voto registrado.'
})
document.querySelector('[data-review-form]').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!state.activeGame || !requireAccount()) return
  const form = event.currentTarget; const button = form.querySelector('button[type="submit"]'); const game = state.activeGame; const data = new FormData(form)
  const comment = String(data.get('comment') ?? '').trim(); const rating = Number(data.get('rating')); const message = document.querySelector('[data-review-message]')
  if (comment.length < 8) { message.textContent = 'Escreva pelo menos 8 caracteres.'; return }
  button.disabled = true; button.textContent = 'Publicando…'; message.textContent = 'Salvando sua avaliação…'
  if (isLocalPreview) {
    const local = localSocial(game.slug); local.review = { rating, comment, createdAt: new Date().toISOString() }; state.social[game.slug] = local; storeLocalState(); renderAll()
    document.querySelector('[data-review-message]').textContent = 'Avaliação salva neste teste local.'
  } else {
    const { error } = await supabase.rpc('upsert_site_game_review', { p_game_slug: game.slug, p_rating: rating, p_comment: comment })
    if (error) message.textContent = 'Não foi possível publicar sua avaliação. Tente novamente.'
    else { await refreshCommunity(); document.querySelector('[data-review-message]').textContent = 'Avaliação publicada com sucesso.' }
  }
  button.disabled = false; button.textContent = localSocial(game.slug).review ? 'Atualizar avaliação' : 'Publicar avaliação'
})
document.querySelector('.menu-toggle')?.addEventListener('click', (event) => { const open = document.querySelector('#site-nav').classList.toggle('is-open'); event.currentTarget.setAttribute('aria-expanded', String(open)) })
document.querySelector('#year').textContent = String(new Date().getFullYear())

authForm.addEventListener('submit', async (event) => { event.preventDefault(); if (!supabase) return; authMessage.textContent = 'Entrando…'; const data = new FormData(authForm); const { error } = await supabase.auth.signInWithPassword({ email: String(data.get('email') ?? '').trim(), password: String(data.get('password') ?? '') }); if (error) { authMessage.textContent = 'Não foi possível entrar. Confira seu e-mail e senha.'; return } authDialog.close(); authForm.reset(); authMessage.textContent = '' })
document.querySelector('[data-google-login]').addEventListener('click', async () => { if (!supabase) return; authMessage.textContent = 'Abrindo o Google…'; const redirectTo = new URL('games.html', window.location.href).href; const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } }); if (error) authMessage.textContent = 'Não foi possível abrir o login do Google.' })

if (supabase) { const { data } = await supabase.auth.getSession(); state.session = data.session; readLocalState(); renderMember(); supabase.auth.onAuthStateChange((_event, session) => { state.session = session; readLocalState(); void (async () => { await loadCommunity(); renderMember(); renderAll(); if (session && state.publisherIntent) { const intent = state.publisherIntent; state.publisherIntent = null; queueMicrotask(() => openPublisher(intent.type, intent)) } })() }) } else { readLocalState(); renderMember() }
if (window.location.hash === '#entrar' && !state.session) { openAuth(); window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`) }
await loadCatalog()
await loadCommunity()
renderAll()
await loadSpotlight()
setInterval(renderVoteAgenda, 30000)
