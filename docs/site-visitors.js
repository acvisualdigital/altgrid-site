import { createClient } from './vendor/supabase.js'

const config = window.ALTGRID_SITE_CONFIG ?? {}
const targets = document.querySelectorAll('[data-total-visitors]')
let lastTotal = 1
const render = (value) => {
  const total = Math.max(1, Number(value) || 1)
  lastTotal = total
  const language = window.AltGridI18n?.getLanguage() || 'pt'
  const format = new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : language)
  targets.forEach((target) => { target.textContent = format.format(total) })
  const words = { pt: ['visitante', 'visitantes'], en: ['visitor', 'visitors'], es: ['visitante', 'visitantes'] }
  document.querySelectorAll('[data-visitor-word]').forEach((target) => { target.textContent = words[language][total === 1 ? 0 : 1] })
}

window.addEventListener('altgrid:languagechange', () => render(lastTotal))

render(localStorage.getItem('altgrid.site.last-visitor-count.v1') || 1)

if (config.supabaseUrl && config.supabaseAnonKey && targets.length) {
  const client = window.ALTGRID_SUPABASE_CLIENT ?? createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  window.ALTGRID_SUPABASE_CLIENT = client
  let visitorId = localStorage.getItem('altgrid.site.visitor-id.v1')
  if (!visitorId) { visitorId = crypto.randomUUID(); localStorage.setItem('altgrid.site.visitor-id.v1', visitorId) }

  const { data } = await client.rpc('register_site_visit', { p_visitor_id: visitorId })
  const total = Number(data?.unique_visitors)
  if (Number.isFinite(total) && total > 0) { localStorage.setItem('altgrid.site.last-visitor-count.v1', String(total)); render(total) }
}
