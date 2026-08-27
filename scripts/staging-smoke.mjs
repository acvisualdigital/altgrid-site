import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const PUBLIC_CHECKS = Object.freeze([
  ['/health', (body) => body?.ok === true && body?.service === 'altgrid-api'],
  ['/v1/app/config', (body) => body?.config && typeof body.config === 'object'],
  ['/v1/app/metrics', (body) => (
    Number.isInteger(body?.users?.active)
    && Number.isInteger(body?.users?.total)
    && body.users.active >= 0
    && body.users.total >= body.users.active
    && body?.active_window_seconds === 900
    && typeof body?.generated_at === 'string'
  )],
  ['/v1/games', (body) => Array.isArray(body?.games)],
  ['/v1/products', (body) => Array.isArray(body?.products)],
])

const PROTECTED_PATHS = Object.freeze([
  '/v1/me',
  '/v1/me/entitlements',
  '/v1/devices',
  '/v1/license/snapshot',
  '/v1/admin/users',
])

function stagingBaseUrl(value) {
  const rawValue = String(value ?? '').trim()
  if (!rawValue) {
    throw new Error('ALTGRID_STAGING_API_BASE_URL não informado.')
  }

  const url = new URL(rawValue)
  const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('A API de staging deve usar HTTPS (HTTP é aceito apenas localmente).')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url
}

function endpoint(baseUrl, pathname) {
  const basePath = baseUrl.pathname === '/' ? '' : baseUrl.pathname
  return new URL(`${basePath}${pathname}`, `${baseUrl.origin}/`)
}

async function request(fetchImplementation, url, options, timeoutMs) {
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs)
  try {
    return await fetchImplementation(url, {
      ...options,
      redirect: 'error',
      signal: timeoutController.signal,
    })
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error(`Timeout ao acessar ${url.pathname}.`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function requireJson(response, pathname) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(`${pathname} não retornou JSON.`)
  }
  return response.json()
}

export async function runStagingSmoke({
  baseUrl: baseUrlValue = process.env.ALTGRID_STAGING_API_BASE_URL,
  fetchImplementation = globalThis.fetch,
  origin = process.env.ALTGRID_SMOKE_ORIGIN?.trim() || 'altgrid://app',
  timeoutMs = Number(process.env.ALTGRID_SMOKE_TIMEOUT_MS || 10_000),
} = {}) {
  if (typeof fetchImplementation !== 'function') {
    throw new Error('Runtime sem suporte a fetch.')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('ALTGRID_SMOKE_TIMEOUT_MS inválido.')
  }

  const baseUrl = stagingBaseUrl(baseUrlValue)
  const results = []

  for (const [pathname, validateBody] of PUBLIC_CHECKS) {
    const response = await request(
      fetchImplementation,
      endpoint(baseUrl, pathname),
      { headers: { Accept: 'application/json', Origin: origin } },
      timeoutMs,
    )
    if (response.status !== 200) {
      throw new Error(`${pathname} retornou HTTP ${response.status}; esperado 200.`)
    }
    if (response.headers.get('access-control-allow-origin') !== origin) {
      throw new Error(`${pathname} não autorizou a origem de smoke test no CORS.`)
    }
    const body = await requireJson(response, pathname)
    if (!validateBody(body)) {
      throw new Error(`${pathname} retornou um contrato inesperado.`)
    }
    results.push(`${pathname}:200`)
  }

  const preflightPath = '/v1/me'
  const preflight = await request(
    fetchImplementation,
    endpoint(baseUrl, preflightPath),
    {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Headers': 'Authorization',
        'Access-Control-Request-Method': 'GET',
      },
    },
    timeoutMs,
  )
  const allowedMethods = preflight.headers.get('access-control-allow-methods') ?? ''
  const allowedHeaders = preflight.headers.get('access-control-allow-headers') ?? ''
  if (
    preflight.status !== 204
    || preflight.headers.get('access-control-allow-origin') !== origin
    || !allowedMethods.split(',').some((method) => method.trim() === 'GET')
    || !allowedHeaders.split(',').some((header) => header.trim().toLowerCase() === 'authorization')
  ) {
    throw new Error('Preflight CORS de /v1/me inválido.')
  }
  results.push('CORS:204')

  for (const pathname of PROTECTED_PATHS) {
    const response = await request(
      fetchImplementation,
      endpoint(baseUrl, pathname),
      { headers: { Accept: 'application/json', Origin: origin } },
      timeoutMs,
    )
    if (response.status !== 401) {
      throw new Error(`${pathname} sem token retornou HTTP ${response.status}; esperado 401.`)
    }
    await requireJson(response, pathname)
    results.push(`${pathname}:401`)
  }

  return results
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : ''

if (currentFile === invokedFile) {
  try {
    const results = await runStagingSmoke()
    console.log(`Smoke de staging aprovado (${results.join(', ')}).`)
  } catch (error) {
    console.error(`Smoke de staging falhou: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
