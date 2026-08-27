import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'

const packageManifest = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', '')

  return {
    base: mode === 'desktop' || mode === 'android' ? './' : '/',
    define: {
      __API_BASE_URL__: JSON.stringify(
        environment.ALTGRID_API_BASE_URL ?? environment.API_BASE_URL ?? '',
      ),
      __APP_VERSION__: JSON.stringify(packageManifest.version),
      __LICENSE_KEY_ID__: JSON.stringify(
        environment.LICENSE_KEY_ID ?? 'altgrid-license-v1',
      ),
      __LICENSE_PUBLIC_KEY__: JSON.stringify(
        environment.LICENSE_PUBLIC_KEY ?? '',
      ),
      __SUPABASE_ANON_KEY__: JSON.stringify(
        environment.SUPABASE_ANON_KEY ?? '',
      ),
      __SUPABASE_URL__: JSON.stringify(environment.SUPABASE_URL ?? ''),
    },
    preview: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
    },
  }
})
