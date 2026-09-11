import { build } from 'esbuild'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

// Only public website files are copied; never package the repository or .env files.
await mkdir('build/site', { recursive: true })
await cp('docs', 'build/site', { recursive: true })
await build({
  stdin: { contents: "export { createClient } from '@supabase/supabase-js'", resolveDir: process.cwd() },
  bundle: true, platform: 'browser', format: 'esm', minify: true,
  outfile: 'docs/vendor/supabase.js', legalComments: 'linked',
})
await cp('docs/vendor', 'build/site/vendor', { recursive: true })
const hashes = new Set()
for (const name of await readdir('build/site')) {
  if (!name.endsWith('.html')) continue
  const html = await readFile(`build/site/${name}`, 'utf8')
  for (const [, attrs, content] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(attrs)) hashes.add(`'sha256-${createHash('sha256').update(content).digest('base64')}'`)
  }
}
const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(' ')} https://www.googletagmanager.com https://*.googlesyndication.com https://googleads.g.doubleclick.net`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://altgrid-api.altgrid.workers.dev https://ohauktuwjzwbvkuxlatt.supabase.co wss://ohauktuwjzwbvkuxlatt.supabase.co https://*.google-analytics.com https://www.googletagmanager.com https://*.googlesyndication.com https://*.doubleclick.net https://www.google.com https://www.google.com.br https://www.googleadservices.com",
  "frame-src https://*.googlesyndication.com https://*.doubleclick.net https://www.google.com",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ')
await writeFile('build/site-security.json', JSON.stringify({ csp }))
console.log('Secure website built with local Supabase SDK and CSP hashes.')
