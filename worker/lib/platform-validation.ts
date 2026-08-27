import { ApiError } from './api-error'

const MAX_BODY_SIZE = 8_192

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
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    throw new ApiError(413, 'payload_too_large', 'O corpo da requisição é muito grande.')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_SIZE) {
    throw new ApiError(413, 'payload_too_large', 'O corpo da requisição é muito grande.')
  }
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
