import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import worker, { secureResponse } from './worker.mjs'

describe('Public site security', () => {
  it.each([200, 404, 500])('protects status %s and removes inherited wildcard CORS', (status) => {
    const response = secureResponse(new Response('page', { status, headers: {
      'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*',
    } }), new Request('https://altgrid.com.br/'))
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(response.headers.get('Content-Security-Policy')).not.toContain("script-src 'unsafe-inline'")
    expect(response.headers.get('Content-Security-Policy')).not.toContain("style-src 'self' 'unsafe-inline'")
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000')
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    expect(response.headers.get('Cache-Control')).toBe(status >= 400 ? 'no-store' : 'public, max-age=0, must-revalidate')
  })
  it('rejects state-changing requests to static pages without calling the asset service', async () => {
    const fetch = vi.fn()
    const response = await worker.fetch(new Request('https://altgrid.com.br/games.html', { method: 'POST' }), { ASSETS: { fetch } })
    expect(response.status).toBe(405)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('serves the root from index.html', async () => {
    const fetch = vi.fn(async request => new Response(new URL(request.url).pathname, { headers: { 'Content-Type': 'text/html' } }))
    const response = await worker.fetch(new Request('https://altgrid.com.br/'), { ASSETS: { fetch } })
    expect(await response.text()).toBe('/index.html')
  })
  it('never caches authenticated requests', () => {
    const response = secureResponse(new Response('data'), new Request('https://altgrid.com.br/', { headers: { Authorization: 'Bearer sample' } }))
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it.each([null, 'denied', 'granted'])('loads Google scripts only with granted consent (%s)', (choice) => {
    const head = { append: vi.fn() }
    const element = () => ({ setAttribute() {}, querySelectorAll: () => [], addEventListener() {}, remove() {} })
    const window = { location: { reload: vi.fn() } }
    runInNewContext(readFileSync('docs/site-consent.js', 'utf8'), {
      window, localStorage: { getItem: () => choice },
      document: { head, body: { append() {} }, createElement: element, querySelector: () => null },
    })
    expect(head.append).toHaveBeenCalledTimes(choice === 'granted' ? 2 : 0)
    if (choice !== 'granted') expect(window.gtag).toBeUndefined()
  })
})
