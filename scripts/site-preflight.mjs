import { readFile, readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const SITE_ROOT = resolve('docs')
const EXPECTED_ADSENSE_PUBLISHER = 'pub-2576736310394290'
const EXPECTED_GOOGLE_ADS_ID = 'AW-18415695413'
const errors = []
const warnings = []

const files = await readdir(SITE_ROOT, { withFileTypes: true })
const htmlFiles = files.filter((entry) => entry.isFile() && extname(entry.name) === '.html')

function report(collection, file, message) {
  collection.push(`${file}: ${message}`)
}

function attributes(source) {
  return Object.fromEntries(
    [...source.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)]
      .map((match) => [match[1].toLowerCase(), match[2]]),
  )
}

function localTarget(rawValue) {
  const value = rawValue.split('#')[0].split('?')[0]
  if (!value || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null
  return resolve(SITE_ROOT, value)
}

for (const entry of htmlFiles) {
  const file = entry.name
  const html = await readFile(resolve(SITE_ROOT, file), 'utf8')
  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1])
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index)

  if (!/<html\s+lang=["']pt-BR["']/i.test(html)) report(errors, file, 'idioma pt-BR ausente')
  if (!/<title>[^<]{12,}<\/title>/i.test(html)) report(errors, file, 'título ausente ou curto')
  if (!/<meta\s+name=["']description["']\s+content=["'][^"']{50,}["']/i.test(html)) report(errors, file, 'descrição SEO ausente ou curta')
  if (!/<link\s+rel=["']canonical["']\s+href=["']https:\/\/altgrid\.com\.br\//i.test(html)) report(errors, file, 'URL canônica ausente')
  if (!html.includes(`googletagmanager.com/gtag/js?id=${EXPECTED_GOOGLE_ADS_ID}`)) report(errors, file, 'Google Ads tag ausente')
  if (!html.includes(`googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${EXPECTED_ADSENSE_PUBLISHER}`)) report(errors, file, 'AdSense tag ausente')
  if (!html.includes("gtag('consent', 'default'")) report(errors, file, 'consentimento padrão ausente')
  if (!html.includes('site-consent.js')) report(errors, file, 'controle de privacidade compartilhado ausente')
  if (duplicateIds.length) report(errors, file, `IDs duplicados: ${[...new Set(duplicateIds)].join(', ')}`)

  for (const match of html.matchAll(/<(?:a|link|script|img)\b([^>]+)>/gi)) {
    const attrs = attributes(match[1])
    const rawValue = attrs.href ?? attrs.src
    const target = rawValue ? localTarget(rawValue) : null

    if (target) {
      try { await readFile(target) } catch { report(errors, file, `arquivo local não encontrado: ${rawValue}`) }
    }

    if (attrs.target === '_blank') {
      const rel = new Set((attrs.rel ?? '').split(/\s+/))
      if (!rel.has('noreferrer') && !rel.has('noopener')) report(errors, file, `link externo sem proteção: ${attrs.href}`)
    }

    if (rawValue?.startsWith('http://') && !rawValue.startsWith('http://127.0.0.1') && !rawValue.startsWith('http://localhost')) {
      report(errors, file, `recurso externo inseguro: ${rawValue}`)
    }
  }

  for (const match of html.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(match[1]) } catch { report(errors, file, 'JSON-LD inválido') }
  }

  const textLength = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length
  if (textLength < 600) report(warnings, file, `pouco conteúdo textual (${textLength} caracteres)`)
}

const catalog = JSON.parse(await readFile(resolve(SITE_ROOT, 'catalog-games.json'), 'utf8'))
const slugs = new Set()
for (const game of catalog.games ?? []) {
  if (!game.slug || slugs.has(game.slug)) report(errors, 'catalog-games.json', `slug inválido ou duplicado: ${game.slug}`)
  slugs.add(game.slug)

  if (game.launch_url) {
    let launchUrl
    try { launchUrl = new URL(game.launch_url) } catch { report(errors, 'catalog-games.json', `URL inválida: ${game.slug}`); continue }
    if (launchUrl.protocol !== 'https:') report(errors, 'catalog-games.json', `URL sem HTTPS: ${game.slug}`)
    try { await readFile(resolve(SITE_ROOT, game.icon_url)) } catch { report(errors, 'catalog-games.json', `ícone ausente: ${game.slug}`) }
  }
}

const adsText = (await readFile(resolve(SITE_ROOT, 'ads.txt'), 'utf8')).trim()
if (adsText !== `google.com, ${EXPECTED_ADSENSE_PUBLISHER}, DIRECT, f08c47fec0942fa0`) {
  report(errors, 'ads.txt', 'registro do publicador não corresponde ao ID configurado')
}

const robots = await readFile(resolve(SITE_ROOT, 'robots.txt'), 'utf8')
if (!robots.includes('Sitemap: https://altgrid.com.br/sitemap.xml')) report(errors, 'robots.txt', 'sitemap não declarado')

const sitemap = await readFile(resolve(SITE_ROOT, 'sitemap.xml'), 'utf8')
for (const file of htmlFiles.map((entry) => entry.name)) {
  const publicUrl = file === 'index.html' ? 'https://altgrid.com.br/' : `https://altgrid.com.br/${file}`
  if (!sitemap.includes(`<loc>${publicUrl}</loc>`)) report(errors, 'sitemap.xml', `página ausente: ${file}`)
}

console.log(`Páginas verificadas: ${htmlFiles.length}`)
console.log(`Jogos verificados: ${(catalog.games ?? []).length}`)
console.log(`Avisos: ${warnings.length}`)
for (const warning of warnings) console.warn(`AVISO ${warning}`)

if (errors.length) {
  for (const error of errors) console.error(`ERRO ${error}`)
  process.exitCode = 1
} else {
  console.log('Integridade do site: OK')
}
