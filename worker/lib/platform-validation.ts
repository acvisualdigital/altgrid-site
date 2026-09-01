import { ApiError } from './api-error'
import type { CreateAppAdRequestInput } from '../../src/types/backend-api'

const MAX_BODY_SIZE = 8_192

function validationError(message: string): ApiError {
  return new ApiError(400, 'validation_error', message)
}

async function readJsonObject(
  request: Request,
  allowedFields: ReadonlySet<string>,
  allowEmpty = false,
): Promise<Record<string, unknown>> {
  // Installed AltGrid clients up to 1.5.2 send the presence heartbeat as a
  // bodyless POST and therefore do not attach Content-Type. Accept that exact
  // legacy shape only for endpoints that explicitly opt into an empty body.
  if (
    allowEmpty
    && (request.body === null || request.headers.get('content-length')?.trim() === '0')
  ) return {}
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Envie os dados como JSON.')
  }
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    throw new ApiError(413, 'payload_too_large', 'O corpo da requisição é muito grande.')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_SIZE) {
    throw new ApiError(413, 'payload_too_large', 'O corpo da requisição é muito grande.')
  }
  if (allowEmpty && text.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw validationError('JSON inválido.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw validationError('O corpo da requisição deve ser um objeto.')
  }
  const body = parsed as Record<string, unknown>
  const unknown = Object.keys(body).find((key) => !allowedFields.has(key))
  if (unknown) throw validationError(`Campo não permitido: ${unknown}.`)
  return body
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw validationError(`${label} deve ser um texto.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maximum) {
    throw validationError(`${label} inválido.`)
  }
  return normalized
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null
  return requiredText(value, label, maximum)
}

export async function readPixInput(request: Request): Promise<{ productCode: string }> {
  const body = await readJsonObject(request, new Set(['product_code']))
  const productCode = requiredText(body.product_code, 'product_code', 100).toUpperCase()
  if (!/^[A-Z][A-Z0-9_]*$/.test(productCode)) {
    throw validationError('product_code inválido.')
  }
  return { productCode }
}

export function readIdempotencyKey(request: Request): string {
  const value = request.headers.get('idempotency-key')?.trim()
    ?? request.headers.get('x-idempotency-key')?.trim()
  if (!value) return crypto.randomUUID()
  if (value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw validationError('Idempotency-Key inválida.')
  }
  return value
}

export async function readChatMessage(request: Request): Promise<string> {
  const body = await readJsonObject(request, new Set(['message']))
  const message = requiredText(body.message, 'message', 500)
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(message)) {
    throw validationError('message contém caracteres inválidos.')
  }
  return message
}

export async function readChatReport(request: Request): Promise<string> {
  const body = await readJsonObject(request, new Set(['reason']))
  return requiredText(body.reason, 'reason', 500)
}

export function readChatPagination(url: string): {
  before: string | null
  pageSize: number
} {
  const params = new URL(url).searchParams
  const unknown = [...params.keys()].find((key) => !['before', 'page_size'].includes(key))
  if (unknown) throw validationError(`Parâmetro não permitido: ${unknown}.`)

  const pageSize = Number(params.get('page_size') ?? '50')
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw validationError('page_size inválido.')
  }
  const rawBefore = params.get('before')?.trim() ?? ''
  if (!rawBefore) return { before: null, pageSize }
  const timestamp = Date.parse(rawBefore)
  if (!Number.isFinite(timestamp)) throw validationError('before inválido.')
  return { before: new Date(timestamp).toISOString(), pageSize }
}

function safeHttpsUrl(value: unknown, label: string, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === '')) return null
  const normalized = requiredText(value, label, 500)
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw validationError(`${label} deve ser uma URL válida.`)
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw validationError(`${label} deve usar HTTPS e não pode conter credenciais.`)
  }
  return parsed.toString()
}

export async function readAppAdRequest(request: Request): Promise<CreateAppAdRequestInput> {
  const body = await readJsonObject(request, new Set([
    'plan_code', 'category', 'advertiser_name', 'title', 'description',
    'destination_url', 'image_url', 'cta_label', 'requested_days', 'game_slug',
    'catalog_game_name', 'catalog_launch_url', 'catalog_icon_url',
  ]))
  const planCode = requiredText(body.plan_code, 'plan_code', 32).toLowerCase()
  const category = requiredText(body.category, 'category', 16).toLowerCase()
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(planCode)) throw validationError('plan_code inválido.')
  if (!['game', 'product', 'site'].includes(category)) throw validationError('category inválida.')
  const advertiserName = requiredText(body.advertiser_name, 'advertiser_name', 80)
  const title = requiredText(body.title, 'title', 70)
  const description = requiredText(body.description, 'description', 180)
  const ctaLabel = requiredText(body.cta_label, 'cta_label', 24)
  if (advertiserName.length < 2 || title.length < 3 || description.length < 10 || ctaLabel.length < 2) {
    throw validationError('Preencha todos os textos do anúncio corretamente.')
  }
  const requestedDays = Number(body.requested_days)
  if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 365) {
    throw validationError('requested_days inválido.')
  }
  const gameSlug = optionalText(body.game_slug, 'game_slug', 80)?.toLowerCase() ?? null
  if (gameSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gameSlug)) {
    throw validationError('game_slug inválido.')
  }
  const catalogGameName = optionalText(body.catalog_game_name, 'catalog_game_name', 80)
  const catalogLaunchUrl = safeHttpsUrl(body.catalog_launch_url, 'catalog_launch_url', true)
  const catalogIconUrl = safeHttpsUrl(body.catalog_icon_url, 'catalog_icon_url', true)
  if (category === 'game' && !gameSlug && (!catalogGameName || !catalogLaunchUrl || !catalogIconUrl)) {
    throw validationError('Selecione um jogo do catálogo ou envie os dados completos para inclusão.')
  }
  return {
    plan_code: planCode,
    category: category as CreateAppAdRequestInput['category'],
    ...(category === 'game' && gameSlug ? { game_slug: gameSlug } : {}),
    ...(category === 'game' && !gameSlug ? {
      catalog_game_name: catalogGameName,
      catalog_launch_url: catalogLaunchUrl,
      catalog_icon_url: catalogIconUrl,
    } : {}),
    advertiser_name: advertiserName,
    title,
    description,
    destination_url: safeHttpsUrl(body.destination_url, 'destination_url')!,
    image_url: safeHttpsUrl(body.image_url, 'image_url', true),
    cta_label: ctaLabel,
    requested_days: requestedDays,
  }
}

export async function readAppAdEvent(request: Request): Promise<{
  eventType: 'impression' | 'click' | 'dismiss'
  placement: 'sidebar' | 'popup'
}> {
  const body = await readJsonObject(request, new Set(['event_type', 'placement']))
  const eventType = requiredText(body.event_type, 'event_type', 16).toLowerCase()
  const placement = requiredText(body.placement, 'placement', 16).toLowerCase()
  if (!['impression', 'click', 'dismiss'].includes(eventType)) throw validationError('event_type inválido.')
  if (!['sidebar', 'popup'].includes(placement)) throw validationError('placement inválido.')
  return {
    eventType: eventType as 'impression' | 'click' | 'dismiss',
    placement: placement as 'sidebar' | 'popup',
  }
}

export async function readPresenceHeartbeat(request: Request): Promise<readonly string[]> {
  // AltGrid 1.5.2 sends POST with an empty body while its shared request layer
  // may still attach application/json. Keep that installed version online.
  const body = await readJsonObject(request, new Set(['active_game_slugs']), true)
  if (body.active_game_slugs === undefined) return []
  if (!Array.isArray(body.active_game_slugs) || body.active_game_slugs.length > 32) {
    throw validationError('active_game_slugs inválido.')
  }
  const slugs = body.active_game_slugs.map((entry) => {
    const slug = requiredText(entry, 'active_game_slugs', 80).toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw validationError('active_game_slugs contém um jogo inválido.')
    }
    return slug
  })
  return [...new Set(slugs)]
}
