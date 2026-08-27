import type { RegisterDeviceInput } from '../../src/types/backend-api'
import { ApiError } from './api-error'

const MAX_BODY_SIZE = 8_192
const DEVICE_HASH_PATTERN = /^[A-Za-z0-9._:-]{16,256}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEVICE_FIELDS = new Set([
  'device_hash',
  'display_name',
  'platform',
  'app_version',
])

function validationError(message: string): ApiError {
  return new ApiError(400, 'validation_error', message)
}

function optionalText(
  value: unknown,
  label: string,
  maximumLength: number,
): string | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw validationError(`${label} deve ser um texto.`)
  }

  const normalized = value.trim()

  if (normalized.length > maximumLength) {
    throw validationError(`${label} é muito longo.`)
  }

  return normalized || null
}

export async function readRegisterDeviceInput(
  request: Request,
): Promise<RegisterDeviceInput> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''

  if (!contentType.startsWith('application/json')) {
    throw new ApiError(
      415,
      'unsupported_media_type',
      'Envie os dados como JSON.',
    )
  }

  const contentLength = Number(request.headers.get('content-length'))

  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    throw new ApiError(413, 'payload_too_large', 'O corpo da requisição é muito grande.')
  }

  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0

  if (reader) {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      byteLength += value.byteLength

      if (byteLength > MAX_BODY_SIZE) {
        await reader.cancel()
        throw new ApiError(
          413,
          'payload_too_large',
          'O corpo da requisição é muito grande.',
        )
      }

      chunks.push(value)
    }
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let rawBody: string

  try {
    rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw validationError('JSON inválido.')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(rawBody)
  } catch {
    throw validationError('JSON inválido.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw validationError('O corpo da requisição deve ser um objeto.')
  }

  const body = parsed as Record<string, unknown>
  const unknownField = Object.keys(body).find((key) => !DEVICE_FIELDS.has(key))

  if (unknownField) {
    throw validationError(`Campo não permitido: ${unknownField}.`)
  }

  const deviceHash = typeof body.device_hash === 'string'
    ? body.device_hash.trim()
    : ''

  if (!DEVICE_HASH_PATTERN.test(deviceHash)) {
    throw validationError('device_hash inválido.')
  }

  return {
    device_hash: deviceHash,
    display_name: optionalText(body.display_name, 'display_name', 100),
    platform: optionalText(body.platform, 'platform', 50),
    app_version: optionalText(body.app_version, 'app_version', 50),
  }
}

export function requireUuid(value: string, label = 'id'): string {
  if (!UUID_PATTERN.test(value)) {
    throw validationError(`${label} inválido.`)
  }

  return value.toLowerCase()
}

export async function readDisplayName(request: Request): Promise<string> {
  const body = await request.json() as unknown
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError('O corpo da requisição deve ser um objeto.')
  }
  const value = (body as Record<string, unknown>).display_name
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 24) {
    throw validationError('O nick deve ter entre 2 e 24 caracteres.')
  }
  return value.trim()
}

export function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw validationError('Parâmetro de rota inválido.')
  }
}

export function readDevicePagination(url: string): {
  page: number
  pageSize: number
} {
  const searchParams = new URL(url).searchParams
  const unknownParameter = [...searchParams.keys()].find(
    (key) => !['page', 'page_size'].includes(key),
  )

  if (unknownParameter) {
    throw validationError(`Parâmetro não permitido: ${unknownParameter}.`)
  }

  const page = Number(searchParams.get('page') ?? '1')
  const pageSize = Number(searchParams.get('page_size') ?? '50')

  if (!Number.isInteger(page) || page < 1 || page > 10_000) {
    throw validationError('page inválido.')
  }

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw validationError('page_size inválido.')
  }

  return { page, pageSize }
}
