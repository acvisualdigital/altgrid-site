import type { SupabaseClient } from '@supabase/supabase-js'

import type { SafeUser } from '../../src/types/backend-api'
import type { Database } from '../../src/types/database'
import { ApiError } from '../lib/api-error'
import type { AuthenticationService } from '../types'

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
