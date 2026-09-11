import policy from '../build/site-security.json'

export function secureResponse(response, request) {
  const result = new Response(response.body, response)
  result.headers.set('Content-Security-Policy', policy.csp)
  result.headers.set('X-Frame-Options', 'DENY')
  result.headers.set('X-Content-Type-Options', 'nosniff')
  result.headers.set('Strict-Transport-Security', 'max-age=31536000')
  result.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  result.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  result.headers.delete('Access-Control-Allow-Origin')
  result.headers.delete('Access-Control-Allow-Credentials')
  const html = result.headers.get('Content-Type')?.includes('text/html')
  result.headers.set('Cache-Control', result.status >= 400 || request.headers.has('Authorization')
    ? 'no-store' : html ? 'public, max-age=0, must-revalidate' : 'public, max-age=600')
  return result
}

export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return secureResponse(new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }), request)
    }
    try {
      const url = new URL(request.url)
      if (url.pathname === '/') url.pathname = '/index.html'
      const assetRequest = new Request(url, request)
      return secureResponse(await env.ASSETS.fetch(assetRequest), request)
    } catch {
      return secureResponse(new Response('Temporarily unavailable', { status: 503 }), request)
    }
  },
}
