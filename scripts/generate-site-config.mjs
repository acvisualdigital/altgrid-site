import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, '.env'), 'utf8')
const environment = Object.fromEntries(
  source.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }),
)

const config = {
  apiBaseUrl: environment.ALTGRID_API_BASE_URL || 'https://altgrid-api.altgrid.workers.dev',
  supabaseUrl: environment.SUPABASE_URL || '',
  supabaseAnonKey: environment.SUPABASE_ANON_KEY || '',
}

if (!config.supabaseUrl || !config.supabaseAnonKey) {
  throw new Error('SUPABASE_URL e SUPABASE_ANON_KEY são necessários para o login do site.')
}

await writeFile(
  resolve(root, 'docs/site-config.js'),
  `window.ALTGRID_SITE_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)})\n`,
  'utf8',
)
