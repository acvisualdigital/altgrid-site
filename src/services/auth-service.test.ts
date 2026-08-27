import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '../types/database'
import { AuthService } from './auth-service'

const user = {
  aud: 'authenticated',
  created_at: '2026-08-25T12:00:00.000Z',
  email: 'hunter@example.com',
  id: '00000000-0000-4000-8000-000000000001',
  identities: [{ id: 'email-identity' }],
  role: 'authenticated',
} as User

const session = {
  access_token: 'test-access-token',
  expires_in: 3600,
  refresh_token: 'test-refresh-token',
  token_type: 'bearer',
  user,
} as Session

function createHarness(isOnline: () => boolean = () => true) {
  const auth = {
    getSession: vi.fn(),
    getUser: vi.fn(),
    onAuthStateChange: vi.fn(),
    refreshSession: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
    updateUser: vi.fn(),
  }
  const client = { auth } as unknown as SupabaseClient<Database>

  return {
    auth,
    client,
    service: new AuthService(client, isOnline),
  }
}

describe('AuthService', () => {
  it('creates an account with a trimmed email and no referral metadata', async () => {
    const { auth, service } = createHarness()
    auth.signUp.mockResolvedValue({
      data: { session: null, user },
      error: null,
    })

    await expect(
      service.signUp('  hunter@example.com  ', 'secret123'),
    ).resolves.toEqual({
      needsEmailConfirmation: true,
      session: null,
      user,
    })
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'hunter@example.com',
      password: 'secret123',
    })
  })

  it('returns the session after a successful login', async () => {
    const { auth, service } = createHarness()
    auth.signInWithPassword.mockResolvedValue({
      data: { session, user },
      error: null,
    })

    await expect(
      service.signIn('  hunter@example.com ', 'secret123'),
    ).resolves.toBe(session)
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'hunter@example.com',
      password: 'secret123',
    })
  })

  it('maps a wrong password to a short invalid-credentials error', async () => {
    const { auth, service } = createHarness()
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: {
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
        status: 400,
      },
    })

    await expect(
      service.signIn('hunter@example.com', 'wrong-password'),
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
      message: 'E-mail ou senha incorretos.',
    })
  })

  it('logs out only the local SDK session', async () => {
    const { auth, service } = createHarness()
    auth.signOut.mockResolvedValue({ error: null })

    await expect(service.signOut()).resolves.toBeUndefined()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('restores the persisted SDK session when a new service starts', async () => {
    const { auth, client } = createHarness()
    auth.getSession.mockResolvedValue({
      data: { session },
      error: null,
    })
    const restartedService = new AuthService(client)

    await expect(restartedService.getSession()).resolves.toBe(session)
    expect(auth.getSession).toHaveBeenCalledOnce()
  })

  it('shares one official SDK refresh across concurrent callers', async () => {
    const { auth, service } = createHarness()
    let resolveRefresh!: (value: {
      data: { session: Session }
      error: null
    }) => void
    auth.refreshSession.mockReturnValue(new Promise((resolve) => {
      resolveRefresh = resolve
    }))

    const first = service.refreshSession()
    const second = service.refreshSession()

    expect(first).toBe(second)
    expect(auth.refreshSession).toHaveBeenCalledOnce()

    resolveRefresh({ data: { session }, error: null })
    await expect(first).resolves.toBe(session)
  })

  it('recognizes Supabase duplicate-email masking via an empty identities list', async () => {
    const { auth, service } = createHarness()
    auth.signUp.mockResolvedValue({
      data: {
        session: null,
        user: { ...user, identities: [] },
      },
      error: null,
    })

    await expect(
      service.signUp('hunter@example.com', 'secret123'),
    ).rejects.toMatchObject({
      code: 'email_already_registered',
      message: 'Este e-mail já está cadastrado.',
    })
  })

  it('requests password recovery and updates the password after recovery', async () => {
    const { auth, service } = createHarness()
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    auth.updateUser.mockResolvedValue({ data: { user }, error: null })

    await expect(
      service.resetPassword(
        '  hunter@example.com ',
        'https://app.example.com/recover',
      ),
    ).resolves.toBeUndefined()
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'hunter@example.com',
      { redirectTo: 'https://app.example.com/recover' },
    )

    await expect(service.updatePassword('new-secret123')).resolves.toBeUndefined()
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-secret123' })
  })

  it('maps a failed request to offline without clearing the stored session', async () => {
    const { auth, service } = createHarness(() => false)
    auth.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(
      service.signIn('hunter@example.com', 'secret123'),
    ).rejects.toMatchObject({
      code: 'offline',
      message: 'Sem conexão. Verifique sua internet e tente novamente.',
    })
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it.each([
    [
      { code: 'over_request_rate_limit', message: 'Too many requests', status: 429 },
      'rate_limited',
      'Muitas tentativas. Aguarde um pouco e tente novamente.',
    ],
    [
      { code: 'unexpected_failure', message: 'Service down', status: 503 },
      'service_unavailable',
      'Serviço temporariamente indisponível. Tente mais tarde.',
    ],
  ])('maps operational auth failures to %s', async (error, code, message) => {
    const { auth, service } = createHarness()
    auth.getSession.mockResolvedValue({ data: { session: null }, error })

    await expect(service.getSession()).rejects.toMatchObject({ code, message })
  })

  it('returns an unsubscribe callback for the auth-state listener', () => {
    const { auth, service } = createHarness()
    const listener = vi.fn()
    const unsubscribe = vi.fn()
    auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe } },
    })

    const stopListening = service.onAuthStateChange(listener)

    expect(auth.onAuthStateChange).toHaveBeenCalledWith(listener)
    stopListening()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
