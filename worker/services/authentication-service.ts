import type { SupabaseClient } from '@supabase/supabase-js'

import type { SafeUser } from '../../src/types/backend-api'
import type { Database } from '../../src/types/database'
import { ApiError } from '../lib/api-error'
import type { AuthenticationService } from '../types'

const AUTH_CACHE_TTL_MS = 60_000
const AUTH_CACHE_MAX_ENTRIES = 2_000

interface CachedAuthentication {
  expiresAt: number
  user: SafeUser
}

const authenticationCache = new Map<string, CachedAuthentication>()
const authenticationRequests = new Map<string, Promise<SafeUser>>()

async function tokenCacheKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function pruneAuthenticationCache(now: number): void {
  for (const [key, entry] of authenticationCache) {
    if (entry.expiresAt <= now) authenticationCache.delete(key)
  }
  while (authenticationCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = authenticationCache.keys().next().value as string | undefined
    if (!oldestKey) break
    authenticationCache.delete(oldestKey)
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization')

  if (!authorization) {
    throw new ApiError(
      401,
      'authentication_required',
      'Token de acesso não informado.',
    )
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization)

  if (!match || match[1].length > 8_192) {
    throw new ApiError(401, 'invalid_token', 'Token inválido ou expirado.')
  }

  return match[1]
}

export class SupabaseAuthenticationService implements AuthenticationService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async authenticate(request: Request): Promise<SafeUser> {
    const token = bearerToken(request)
    const cacheKey = await tokenCacheKey(token)
    const now = Date.now()
    const cached = authenticationCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return cached.user
    }

    const pending = authenticationRequests.get(cacheKey)
    if (pending) return pending

    const authentication = this.validateToken(token).then((user) => {
      pruneAuthenticationCache(Date.now())
      authenticationCache.set(cacheKey, {
        expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
        user,
      })
      return user
    }).finally(() => {
      if (authenticationRequests.get(cacheKey) === authentication) {
        authenticationRequests.delete(cacheKey)
      }
    })
    authenticationRequests.set(cacheKey, authentication)
    return authentication
  }

  private async validateToken(token: string): Promise<SafeUser> {
    const { data, error } = await this.client.auth.getUser(token)

    if (error || !data.user) {
      const status = error?.status

      if (status === 429) {
        throw new ApiError(
          429,
          'rate_limited',
          'Muitas tentativas. Aguarde e tente novamente.',
        )
      }

      if (!status || status === 0 || status >= 500) {
        throw new ApiError(500, 'auth_unavailable', 'Serviço de autenticação indisponível.')
      }

      if ([400, 401, 403].includes(status)) {
        throw new ApiError(401, 'invalid_token', 'Token inválido ou expirado.')
      }

      throw new ApiError(500, 'auth_unavailable', 'Serviço de autenticação indisponível.')
    }

    const user = data.user

    return {
      id: user.id,
      email: user.email ?? null,
      email_confirmed_at: user.email_confirmed_at ?? null,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at ?? null,
    }
  }
}
