import type { ApiErrorResponse } from '../../src/types/backend-api'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers?: HeadersInit,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers)
  if (!responseHeaders.has('Cache-Control')) {
    responseHeaders.set('Cache-Control', 'no-store')
  }
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8')
  responseHeaders.set('X-Content-Type-Options', 'nosniff')

  return new Response(JSON.stringify(body), { status, headers: responseHeaders })
}

export function apiErrorResponse(error: unknown): Response {
  const safeError = error instanceof ApiError
    ? error
    : new ApiError(500, 'internal_error', 'Erro interno do serviço.')
  const body: ApiErrorResponse = {
    error: {
      code: safeError.code,
      message: safeError.message,
    },
  }

  return jsonResponse(body, safeError.status, safeError.headers)
}
