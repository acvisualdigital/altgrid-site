import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const HOST = '127.0.0.1'
const PORT = 8788

function readEnvironmentValue(source, name) {
  const line = source
    .split(/\r?\n/)
    .find((candidate) => candidate.trimStart().startsWith(`${name}=`))

  if (!line) return null
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const environment = await readFile(resolve('.env'), 'utf8')
const upstreamBaseUrl = (
  process.env.ALTGRID_UPSTREAM_API_BASE_URL
  ?? readEnvironmentValue(environment, 'ALTGRID_API_BASE_URL')
  ?? ''
).replace(/\/+$/, '')

if (!upstreamBaseUrl) {
  throw new Error('ALTGRID_API_BASE_URL não está configurada para o laboratório local.')
}

const catalog = JSON.parse(
  await readFile(resolve('docs/catalog-games.json'), 'utf8'),
)

const localGames = catalog.games
  .filter((game) => Boolean(game.launch_url) && game.site_only === false)
  .map((game) => ({
    developer_referral_url: null,
    enabled: true,
    icon_url: new URL(game.icon_url, 'https://altgrid.com.br/').toString(),
    id: game.id,
    launch_url: game.launch_url,
    metadata: game.metadata ?? {},
    name: game.name,
    slug: game.slug,
    sort_order: game.sort_order,
  }))

function mergeGames(remoteGames) {
  const games = new Map(localGames.map((game) => [game.slug, game]))

  for (const game of remoteGames) {
    games.set(game.slug, game)
  }

  return [...games.values()].sort((left, right) => (
    left.sort_order - right.sort_order
    || left.name.localeCompare(right.name, 'pt-BR')
  ))
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length ? Buffer.concat(chunks) : undefined
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://${HOST}:${PORT}`)
    const upstreamUrl = new URL(
      `${requestUrl.pathname}${requestUrl.search}`,
      `${upstreamBaseUrl}/`,
    )
    const headers = new Headers()

    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined && name !== 'host' && name !== 'content-length') {
        headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      body: ['GET', 'HEAD'].includes(request.method ?? 'GET')
        ? undefined
        : await readRequestBody(request),
      headers,
      method: request.method,
      redirect: 'manual',
    })

    const responseHeaders = Object.fromEntries(upstreamResponse.headers.entries())
    delete responseHeaders['content-length']
    delete responseHeaders['content-encoding']
    delete responseHeaders['transfer-encoding']

    if (requestUrl.pathname === '/v1/games' && upstreamResponse.ok) {
      const payload = await upstreamResponse.json()
      const games = mergeGames(Array.isArray(payload.games) ? payload.games : [])
      const body = JSON.stringify({ games })
      response.writeHead(200, {
        ...responseHeaders,
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
        'content-type': 'application/json; charset=utf-8',
      })
      response.end(body)
      return
    }

    const body = Buffer.from(await upstreamResponse.arrayBuffer())
    response.writeHead(upstreamResponse.status, {
      ...responseHeaders,
      'content-length': body.length,
    })
    response.end(body)
  } catch (error) {
    const body = JSON.stringify({
      error: 'local_catalog_proxy_failed',
      message: error instanceof Error ? error.message : 'Falha desconhecida.',
    })
    response.writeHead(502, {
      'content-length': Buffer.byteLength(body),
      'content-type': 'application/json; charset=utf-8',
    })
    response.end(body)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`AltGrid catalog lab: http://${HOST}:${PORT}`)
  console.log(`Jogos locais adicionados: ${localGames.length}`)
})
