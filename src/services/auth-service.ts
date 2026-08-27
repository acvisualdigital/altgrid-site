import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
  User,
} from '@supabase/supabase-js'

import type { Database } from '../types/database'

export type AuthServiceErrorCode =
  | 'connection_failed'
  | 'email_already_registered'
  | 'email_not_confirmed'
  | 'invalid_credentials'
  | 'invalid_email'
  | 'offline'
  | 'rate_limited'
  | 'service_unavailable'
  | 'unknown'
  | 'weak_password'

const FRIENDLY_AUTH_MESSAGES: Record<AuthServiceErrorCode, string> = {
  connection_failed: 'Não foi possível conectar. Tente novamente em instantes.',
  email_already_registered: 'Este e-mail já está cadastrado.',
  email_not_confirmed: 'Confirme seu e-mail antes de entrar.',
  invalid_credentials: 'E-mail ou senha incorretos.',
  invalid_email: 'Digite um e-mail válido.',
  offline: 'Sem conexão. Verifique sua internet e tente novamente.',
  rate_limited: 'Muitas tentativas. Aguarde um pouco e tente novamente.',
  service_unavailable: 'Serviço temporariamente indisponível. Tente mais tarde.',
  unknown: 'Não foi possível concluir a operação. Tente novamente.',
  weak_password: 'A senha não atende aos requisitos mínimos.',
}

export class AuthServiceError extends Error {
  constructor(
    public readonly code: AuthServiceErrorCode,
    options?: ErrorOptions,
  ) {
    super(FRIENDLY_AUTH_MESSAGES[code], options)
    this.name = 'AuthServiceError'
  }
}

interface AuthErrorLike {
  code?: string
  message?: string
  status?: number
}

export function mapAuthError(
  error: unknown,
  isOnline = true,
): AuthServiceError {
  if (error instanceof AuthServiceError) {
    return error
  }

  if (!isOnline) {
    return new AuthServiceError('offline', { cause: error })
  }

  const authError = error as AuthErrorLike
  const code = authError?.code?.toLowerCase() ?? ''
  const message = authError?.message?.toLowerCase() ?? ''
  const status = authError?.status

  if (
    [
      'invalid_credentials',
      'invalid_grant',
      'refresh_token_already_used',
      'refresh_token_not_found',
      'session_not_found',
    ].includes(code)
    || message.includes('invalid login credentials')
    || message.includes('invalid refresh token')
    || message.includes('refresh token not found')
  ) {
    return new AuthServiceError('invalid_credentials', { cause: error })
  }

  if (
    ['email_exists', 'identity_already_exists', 'user_already_exists'].includes(
      code,
    )
    || message.includes('already registered')
    || message.includes('already been registered')
  ) {
    return new AuthServiceError('email_already_registered', { cause: error })
  }

  if (
    code === 'email_address_invalid'
    || (code === 'validation_failed' && message.includes('email'))
    || message.includes('invalid email')
  ) {
    return new AuthServiceError('invalid_email', { cause: error })
  }

  if (
    code === 'weak_password'
    || (code === 'validation_failed' && message.includes('password'))
    || message.includes('password should be')
  ) {
    return new AuthServiceError('weak_password', { cause: error })
  }

  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return new AuthServiceError('email_not_confirmed', { cause: error })
  }

  if (
    status === 429
    || code === 'over_email_send_rate_limit'
    || code === 'over_request_rate_limit'
    || code.includes('rate_limit')
  ) {
    return new AuthServiceError('rate_limited', { cause: error })
  }

  if (typeof status === 'number' && status >= 500) {
    return new AuthServiceError('service_unavailable', { cause: error })
  }

  if (
    error instanceof TypeError
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('network request failed')
  ) {
    return new AuthServiceError('connection_failed', { cause: error })
  }

  return new AuthServiceError('unknown', { cause: error })
}

export interface SignUpResult {
  needsEmailConfirmation: boolean
  session: Session | null
  user: User
}

export type AuthStateListener = (
  event: AuthChangeEvent,
  session: Session | null,
) => void

export class AuthService {
  private refreshInFlight: Promise<Session | null> | null = null

  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly isOnline: () => boolean = () =>
      typeof navigator === 'undefined' || navigator.onLine,
  ) {}

  async signUp(
    email: string,
    password: string,
  ): Promise<SignUpResult> {
    return this.execute(async () => {
      const { data, error } = await this.client.auth.signUp({
        email: email.trim(),
        password,
      })

      if (error) {
        throw error
      }

      if (!data.user) {
        throw new AuthServiceError('unknown')
      }

      if (data.user.identities?.length === 0) {
        throw new AuthServiceError('email_already_registered')
      }

      return {
        needsEmailConfirmation: data.session === null,
        session: data.session,
        user: data.user,
      }
    })
  }

  async signIn(email: string, password: string): Promise<Session> {
    return this.execute(async () => {
      const { data, error } = await this.client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        throw error
      }

      if (!data.session) {
        throw new AuthServiceError('invalid_credentials')
      }

      return data.session
    })
  }

  async signOut(): Promise<void> {
    await this.execute(async () => {
      const { error } = await this.client.auth.signOut({ scope: 'local' })

      if (error) {
        throw error
      }
    })
  }

  async getSession(): Promise<Session | null> {
    return this.execute(async () => {
      const { data, error } = await this.client.auth.getSession()

      if (error) {
        throw error
      }

      return data.session
    })
  }

  async getCurrentUser(): Promise<User | null> {
    return this.execute(async () => {
      const { data, error } = await this.client.auth.getUser()

      if (error) {
        throw error
      }

      return data.user
    })
  }

  refreshSession(): Promise<Session | null> {
    if (this.refreshInFlight) {
      return this.refreshInFlight
    }

    const refresh = this.execute(async () => {
      const { data, error } = await this.client.auth.refreshSession()

      if (error) {
        throw error
      }

      return data.session
    })

    this.refreshInFlight = refresh
    void refresh.finally(() => {
      if (this.refreshInFlight === refresh) {
        this.refreshInFlight = null
      }
    }).catch(() => undefined)

    return refresh
  }

  async resetPassword(email: string, redirectTo?: string): Promise<void> {
    await this.execute(async () => {
      const { error } = await this.client.auth.resetPasswordForEmail(
        email.trim(),
        redirectTo ? { redirectTo } : undefined,
      )

      if (error) {
        throw error
      }
    })
  }

  async updatePassword(password: string): Promise<void> {
    await this.execute(async () => {
      const { error } = await this.client.auth.updateUser({ password })

      if (error) {
        throw error
      }
    })
  }

  onAuthStateChange(listener: AuthStateListener): () => void {
    const { data } = this.client.auth.onAuthStateChange(listener)

    return () => data.subscription.unsubscribe()
  }

  private async execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation()
    } catch (error) {
      throw mapAuthError(error, this.isOnline())
    }
  }
}
