import { describe, expect, it, vi } from 'vitest'

import { runStagingSmoke } from './staging-smoke.mjs'

const ORIGIN = 'altgrid://app'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': ORIGIN,
      'Content-Type': 'application/json',
    },
  })
}

describe('staging smoke test', () => {
  it('uses only read-only requests and validates public, CORS and protected routes', async () => {
    const publicBodies = new Map([
      ['/health', { ok: true, service: 'altgrid-api' }],
      ['/v1/app/config', { config: {} }],
      ['/v1/app/metrics', {
        active_window_seconds: 900,
        generated_at: '2026-08-27T10:00:00.000Z',
        users: { active: 3, total: 12 },
      }],
      ['/v1/games', { games: [] }],
      ['/v1/products', { products: [] }],
    ])
    const calls = []
    const fetchImplementation = vi.fn(async (input, options = {}) => {
      const url = new URL(input)
      const method = options.method ?? 'GET'
      calls.push({ method, pathname: url.pathname, headers: options.headers })

      if (method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Origin': ORIGIN,
          },
        })
      }

      if (publicBodies.has(url.pathname)) {
        return jsonResponse(publicBodies.get(url.pathname))
      }
      return jsonResponse({ error: { code: 'missing_token' } }, 401)
    })

    const results = await runStagingSmoke({
      baseUrl: 'https://staging-api.example.com',
      fetchImplementation,
      origin: ORIGIN,
    })

    expect(results).toHaveLength(11)
    expect(calls.every(({ method }) => method === 'GET' || method === 'OPTIONS')).toBe(true)
    expect(calls.every(({ headers }) => !Object.keys(headers).some(
      (name) => name.toLowerCase() === 'authorization',
    ))).toBe(true)
  })

  it('rejects a non-local insecure staging URL before making a request', async () => {
    const fetchImplementation = vi.fn()

    await expect(runStagingSmoke({
      baseUrl: 'http://staging-api.example.com',
      fetchImplementation,
    })).rejects.toThrow('A API de staging deve usar HTTPS')
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('fails when a protected route is accessible without a token', async () => {
    const fetchImplementation = vi.fn(async (input, options = {}) => {
      const url = new URL(input)
      if ((options.method ?? 'GET') === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Headers': 'Authorization',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Origin': ORIGIN,
          },
        })
      }
      if (url.pathname === '/health') return jsonResponse({ ok: true, service: 'altgrid-api' })
      if (url.pathname === '/v1/app/config') return jsonResponse({ config: {} })
      if (url.pathname === '/v1/app/metrics') {
        return jsonResponse({
          active_window_seconds: 900,
          generated_at: '2026-08-27T10:00:00.000Z',
          users: { active: 0, total: 0 },
        })
      }
      if (url.pathname === '/v1/games') return jsonResponse({ games: [] })
      if (url.pathname === '/v1/products') return jsonResponse({ products: [] })
      return jsonResponse({ unexpectedlyPublic: true }, 200)
    })

    await expect(runStagingSmoke({
      baseUrl: 'https://staging-api.example.com',
      fetchImplementation,
      origin: ORIGIN,
    })).rejects.toThrow('/v1/me sem token retornou HTTP 200; esperado 401.')
  })
})
