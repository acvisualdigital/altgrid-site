import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const config = window.ALTGRID_SITE_CONFIG ?? {}
const targets = document.querySelectorAll('[data-total-visitors]')
const format = new Intl.NumberFormat('pt-BR')
const render = (value) => {
  const total = Math.max(1, Number(value) || 1)
  targets.forEach((target) => { target.textContent = format.format(total) })
  document.querySelectorAll('[data-visitor-word]').forEach((target) => { target.textContent = total === 1 ? target.dataset.singular : target.dataset.plural })
}

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
