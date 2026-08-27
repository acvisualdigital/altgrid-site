import type {
  AdminAnnouncementInput,
  AdminAnnouncementUpdate,
  AdminChatReportStatus,
  AdminChatRestrictionInput,
  AdminGameInput,
  AdminGameUpdate,
  AdminLifetimeInput,
  AdminProductUpdate,
  AdminSetPlanInput,
} from '../../src/types/admin-api'
import type { Json, PlanCode } from '../../src/types/database'
import { ApiError } from './api-error'

const MAX_ADMIN_BODY_SIZE = 16_384
const GAME_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const CONFIG_KEYS = new Set([
  'referral_referrer_days',
  'referral_referred_days',
  'founder_max_sales',
  'maintenance',
  'minimum_version',
  'latest_version',
  'update_channel',
])

function validationError(message: string): ApiError {
  return new ApiError(400, 'validation_error', message)
}

async function readJsonObject(
  request: Request,
  allowedFields: ReadonlySet<string>,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''

  if (!contentType.startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Envie os dados como JSON.')
  }

  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_ADMIN_BODY_SIZE) {
    throw new ApiError(413, 'payload_too_large', 'O corpo da requisição é muito grande.')
  }

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_ADMIN_BODY_SIZE) {
    throw new ApiError(413, 'payload_too_large', 'O corpo da requisição é muito grande.')
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw validationError('JSON inválido.')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('O corpo da requisição deve ser um objeto.')
  }

  const body = value as Record<string, unknown>
  const unknownField = Object.keys(body).find((key) => !allowedFields.has(key))
  if (unknownField) {
    throw validationError(`Campo não permitido: ${unknownField}.`)
  }

  return body
}

function requiredText(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string') {
    throw validationError(`${label} deve ser um texto.`)
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > maximumLength) {
    throw validationError(`${label} inválido.`)
  }
  return normalized
}

function nullableText(
  value: unknown,
  label: string,
  maximumLength: number,
): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const normalized = requiredText(value, label, maximumLength)
  return normalized
}

function safeUrl(value: unknown, label: string): string {
  const raw = requiredText(value, label, 2_048)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw validationError(`${label} inválida.`)
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    url.username
    || url.password
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback))
  ) {
    throw validationError(`${label} deve usar HTTPS.`)
  }
  return url.toString()
}

function nullableSafeUrl(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined || value === null) return value
  if (typeof value === 'string' && !value.trim()) return null
  return safeUrl(value, label)
}

function planCode(value: unknown, allowFree = true): PlanCode {
  if (!['FREE', 'PRO', 'FOUNDER'].includes(String(value))) {
    throw validationError('plan inválido.')
  }
  if (!allowFree && value === 'FREE') {
    throw validationError('Licença lifetime requer PRO ou FOUNDER.')
  }
  return value as PlanCode
}

export function readAdminPagination(
  url: string,
  allowedExtra: readonly string[] = [],
): { page: number; pageSize: number } {
  const params = new URL(url).searchParams
  const allowed = new Set(['page', 'page_size', ...allowedExtra])
  const unknown = [...params.keys()].find((key) => !allowed.has(key))
  if (unknown) throw validationError(`Parâmetro não permitido: ${unknown}.`)

  const page = Number(params.get('page') ?? '1')
  const pageSize = Number(params.get('page_size') ?? '50')
  if (!Number.isInteger(page) || page < 1 || page > 10_000) {
    throw validationError('page inválido.')
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw validationError('page_size inválido.')
  }
  return { page, pageSize }
}

export function readAdminSearch(url: string): {
  query: string
  page: number
  pageSize: number
} {
  const { page, pageSize } = readAdminPagination(url, ['q'])
  const query = new URL(url).searchParams.get('q')?.trim() ?? ''
  if (query.length > 200) throw validationError('Busca muito longa.')
  return { query, page, pageSize }
}

export async function readGrantDays(request: Request): Promise<number> {
  const body = await readJsonObject(request, new Set(['days']))
  const days = Number(body.days)
  if (!Number.isInteger(days) || days < 1 || days > 3_650) {
    throw validationError('days deve ser um inteiro entre 1 e 3650.')
  }
  return days
}

function founderNumber(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 1_000_000) {
    throw validationError('founder_number inválido.')
  }
  return number
}

export async function readSetPlan(request: Request): Promise<AdminSetPlanInput> {
  const body = await readJsonObject(
    request,
    new Set(['plan', 'expires_at', 'founder_number']),
  )
  const plan = planCode(body.plan)
  let expiresAt: string | null | undefined
  if (body.expires_at === null) {
    expiresAt = null
  } else if (body.expires_at !== undefined) {
    const timestamp = requiredText(body.expires_at, 'expires_at', 50)
    if (!Number.isFinite(Date.parse(timestamp)) || Date.parse(timestamp) <= Date.now()) {
      throw validationError('expires_at deve estar no futuro.')
    }
    expiresAt = new Date(timestamp).toISOString()
  }
  const founder = founderNumber(body.founder_number)
  if (plan !== 'FOUNDER' && founder != null) {
    throw validationError('founder_number requer o plano FOUNDER.')
  }
  return { plan, expires_at: expiresAt, founder_number: founder }
}

export async function readLifetimePlan(
  request: Request,
): Promise<AdminLifetimeInput> {
  const body = await readJsonObject(request, new Set(['plan', 'founder_number']))
  const plan = planCode(body.plan, false) as 'PRO' | 'FOUNDER'
  const founder = founderNumber(body.founder_number)
  if (plan !== 'FOUNDER' && founder != null) {
    throw validationError('founder_number requer o plano FOUNDER.')
  }
  return { plan, founder_number: founder }
}

const GAME_FIELDS = new Set([
  'slug',
  'name',
  'launch_url',
  'developer_referral_url',
  'icon_url',
  'enabled',
  'sort_order',
])

function gameFields(body: Record<string, unknown>, partial: boolean): AdminGameUpdate {
  const result: AdminGameUpdate = {}
  if (!partial || body.slug !== undefined) {
    const slug = requiredText(body.slug, 'slug', 100).toLowerCase()
    if (!GAME_SLUG_PATTERN.test(slug)) throw validationError('slug inválido.')
    result.slug = slug
  }
  if (!partial || body.name !== undefined) {
    result.name = requiredText(body.name, 'name', 120)
  }
  if (!partial || body.launch_url !== undefined) {
    result.launch_url = safeUrl(body.launch_url, 'launch_url')
  }
  if (body.developer_referral_url !== undefined) {
    result.developer_referral_url = nullableSafeUrl(
      body.developer_referral_url,
      'developer_referral_url',
    )
  }
  if (body.icon_url !== undefined) {
    result.icon_url = nullableSafeUrl(body.icon_url, 'icon_url')
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw validationError('enabled inválido.')
    result.enabled = body.enabled
  }
  if (body.sort_order !== undefined) {
    const sortOrder = Number(body.sort_order)
    if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 1_000_000) {
      throw validationError('sort_order inválido.')
    }
    result.sort_order = sortOrder
  }
  return result
}

export async function readAdminGameInput(request: Request): Promise<AdminGameInput> {
  const body = await readJsonObject(request, GAME_FIELDS)
  return gameFields(body, false) as AdminGameInput
}

export async function readAdminGameUpdate(request: Request): Promise<AdminGameUpdate> {
  const body = await readJsonObject(request, GAME_FIELDS)
  if (Object.keys(body).length === 0) throw validationError('Informe ao menos um campo.')
  return gameFields(body, true)
}

export function requireAdminConfigKey(value: string): string {
  if (!CONFIG_KEYS.has(value)) throw validationError('Configuração não permitida.')
  return value
}

export async function readAdminConfigValue(
  request: Request,
  key: string,
): Promise<Json> {
  const body = await readJsonObject(request, new Set(['value']))

  if (key === 'maintenance') {
    if (typeof body.value !== 'boolean') {
      throw validationError('value deve ser verdadeiro ou falso.')
    }
    return body.value
  }

  if (key === 'minimum_version' || key === 'latest_version') {
    const version = requiredText(body.value, 'value', 100)
    if (!SEMVER_PATTERN.test(version)) {
      throw validationError('value deve ser uma versão SemVer válida.')
    }
    return version
  }

  if (key === 'update_channel') {
    const channel = requiredText(body.value, 'value', 20)
    if (channel !== 'beta' && channel !== 'stable') {
      throw validationError('value deve ser beta ou stable.')
    }
    return channel
  }

  if (key === 'founder_max_sales' && body.value === null) {
    return null
  }

  if (typeof body.value !== 'number') {
    throw validationError('value deve ser um número inteiro.')
  }
  const value = body.value
  const minimum = key === 'founder_max_sales' ? 1 : 0
  const maximum = key === 'founder_max_sales' ? 1_000_000 : 3_650
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw validationError('value inválido.')
  }
  return value
}

export async function readAdminProductUpdate(
  request: Request,
): Promise<AdminProductUpdate> {
  const body = await readJsonObject(
    request,
    new Set(['price_amount', 'currency', 'enabled']),
  )
  if (Object.keys(body).length === 0) throw validationError('Informe ao menos um campo.')

  const result: AdminProductUpdate = {}
  if (body.price_amount !== undefined) {
    if (body.price_amount === null) {
      result.price_amount = null
    } else {
      const price = Number(body.price_amount)
      if (!Number.isFinite(price) || price < 0 || price > 99_999_999.99) {
        throw validationError('price_amount inválido.')
      }
      result.price_amount = Math.round(price * 100) / 100
    }
  }
  if (body.currency !== undefined) {
    const currency = requiredText(body.currency, 'currency', 3).toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) throw validationError('currency inválida.')
    result.currency = currency
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw validationError('enabled inválido.')
    result.enabled = body.enabled
  }
  return result
}

const ANNOUNCEMENT_FIELDS = new Set([
  'title',
  'message',
  'type',
  'published_at',
  'expires_at',
  'enabled',
])

function normalizedTimestamp(
  value: unknown,
  label: string,
): string {
  const raw = requiredText(value, label, 50)
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) throw validationError(`${label} inválido.`)
  return new Date(timestamp).toISOString()
}

function announcementFields(
  body: Record<string, unknown>,
  partial: boolean,
): AdminAnnouncementUpdate {
  const result: AdminAnnouncementUpdate = {}
  if (!partial || body.title !== undefined) {
    result.title = requiredText(body.title, 'title', 160)
  }
  if (!partial || body.message !== undefined) {
    result.message = requiredText(body.message, 'message', 4_000)
  }
  if (!partial || body.type !== undefined) {
    const type = requiredText(body.type, 'type', 20)
    if (!['info', 'warning', 'maintenance'].includes(type)) {
      throw validationError('type inválido.')
    }
    result.type = type as AdminAnnouncementInput['type']
  }
  if (body.published_at !== undefined) {
    result.published_at = normalizedTimestamp(body.published_at, 'published_at')
  }
  if (body.expires_at === null) {
    result.expires_at = null
  } else if (body.expires_at !== undefined) {
    result.expires_at = normalizedTimestamp(body.expires_at, 'expires_at')
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw validationError('enabled inválido.')
    result.enabled = body.enabled
  }

  if (result.expires_at) {
    const publishedAt = result.published_at ?? new Date().toISOString()
    if (Date.parse(result.expires_at) <= Date.parse(publishedAt)) {
      throw validationError('expires_at deve ser posterior a published_at.')
    }
  }
  return result
}

export async function readAdminAnnouncementInput(
  request: Request,
): Promise<AdminAnnouncementInput> {
  return announcementFields(
    await readJsonObject(request, ANNOUNCEMENT_FIELDS),
    false,
  ) as AdminAnnouncementInput
}

export async function readAdminAnnouncementUpdate(
  request: Request,
): Promise<AdminAnnouncementUpdate> {
  const body = await readJsonObject(request, ANNOUNCEMENT_FIELDS)
  if (Object.keys(body).length === 0) throw validationError('Informe ao menos um campo.')
  return announcementFields(body, true)
}

export async function readAdminChatRestriction(
  request: Request,
): Promise<AdminChatRestrictionInput> {
  const body = await readJsonObject(
    request,
    new Set(['kind', 'reason', 'expires_at']),
  )
  if (body.kind !== 'mute' && body.kind !== 'ban') {
    throw validationError('kind inválido.')
  }
  const reason = requiredText(body.reason, 'reason', 500)
  let expiresAt: string | null = null
  if (body.expires_at !== undefined && body.expires_at !== null) {
    expiresAt = normalizedTimestamp(body.expires_at, 'expires_at')
  }
  if (body.kind === 'mute' && (!expiresAt || Date.parse(expiresAt) <= Date.now())) {
    throw validationError('Mute requer expires_at no futuro.')
  }
  if (body.kind === 'ban' && expiresAt !== null) {
    throw validationError('Ban não deve possuir expires_at.')
  }
  return { kind: body.kind, reason, expires_at: expiresAt }
}

export async function readAdminChatReportStatus(
  request: Request,
): Promise<Exclude<AdminChatReportStatus, 'pending'>> {
  const body = await readJsonObject(request, new Set(['status']))
  if (!['reviewed', 'dismissed', 'actioned'].includes(String(body.status))) {
    throw validationError('status inválido.')
  }
  return body.status as Exclude<AdminChatReportStatus, 'pending'>
}

export function readAdminChatReportPagination(url: string): {
  status: AdminChatReportStatus | null
  page: number
  pageSize: number
} {
  const { page, pageSize } = readAdminPagination(url, ['status'])
  const rawStatus = new URL(url).searchParams.get('status')?.trim() ?? ''
  if (rawStatus && !['pending', 'reviewed', 'dismissed', 'actioned'].includes(rawStatus)) {
    throw validationError('status inválido.')
  }
  return {
    status: rawStatus ? rawStatus as AdminChatReportStatus : null,
    page,
    pageSize,
  }
}

export function optionalTargetId(value: unknown): string | null {
  return nullableText(value, 'target_id', 200) ?? null
}
