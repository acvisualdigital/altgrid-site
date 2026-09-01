import type { Session, User } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthService, AuthServiceError } from './auth-service'
import { BackendApi, BackendApiError } from './backend-api'

const user = {
  aud: 'authenticated',
  created_at: '2026-08-25T12:00:00.000Z',
  email: 'hunter@example.com',
  id: '00000000-0000-4000-8000-000000000001',
  role: 'authenticated',
} as User

const session = {
  access_token: 'old-access-token',
  expires_in: 3600,
  refresh_token: 'refresh-token',
  token_type: 'bearer',
  user,
} as Session

const refreshedSession = {
  ...session,
  access_token: 'new-access-token',
} as Session

function authDouble(
  getSession = vi.fn().mockResolvedValue(session),
  refreshSession = vi.fn().mockResolvedValue(refreshedSession),
): {
  getSession: ReturnType<typeof vi.fn>
  refreshSession: ReturnType<typeof vi.fn>
  service: AuthService
} {
  return {
    getSession,
    refreshSession,
    service: { getSession, refreshSession } as unknown as AuthService,
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('BackendApi', () => {
  it('uses API_BASE_URL and adds the Supabase bearer token', async () => {
    const auth = authDouble()
    const fetcher = vi.fn().mockResolvedValue(json({
      account_limit: 2,
      expires_at: null,
      features: {},
      founder_number: null,
      lifetime: false,
      plan: 'FREE',
    }))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com/',
      fetch: fetcher,
    })

    await api.getEntitlements()

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/me/entitlements')
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer old-access-token',
    )
    expect(new Headers(init.headers).get('Accept')).toBe('application/json')
  })

  it('loads the referral program through an authenticated request', async () => {
    const auth = authDouble()
    const fetcher = vi.fn().mockResolvedValue(json({
      code: 'HUNT-ABCDEFGH',
      share_url: 'https://altgrid.com.br/?ref=HUNT-ABCDEFGH',
      campaign: {
        id: 'campaign-id',
        name: 'Lançamento',
        starts_at: '2026-08-28T03:00:00.000Z',
        ends_at: '2026-10-01T02:59:59.000Z',
        status: 'active',
      },
      stats: { total: 0, valid: 0, pending: 0, rejected: 0, pro_days: 0, position: null },
      leaderboard: [],
      recent_referrals: [],
    }))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher,
    })

    await expect(api.getReferralProgram()).resolves.toMatchObject({
      code: 'HUNT-ABCDEFGH',
      stats: { pro_days: 0 },
    })
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.example.com/v1/referrals',
    )
    expect(new Headers((fetcher.mock.calls[0]?.[1] as RequestInit).headers)
      .get('Authorization')).toBe('Bearer old-access-token')
  })

  it('loads health and app config through public central-client requests', async () => {
    const auth = authDouble()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ ok: true, service: 'altgrid-api' }))
      .mockResolvedValueOnce(json({
        config: {
          latest_version: '2.0.0',
          maintenance: false,
          minimum_version: '2.0.0',
        },
      }))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher,
    })

    await expect(api.getHealth()).resolves.toEqual({
      ok: true,
      service: 'altgrid-api',
    })
    await expect(api.getAppConfig()).resolves.toMatchObject({
      config: { maintenance: false, minimum_version: '2.0.0' },
    })

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.com/health',
      'https://api.example.com/v1/app/config',
    ])
    fetcher.mock.calls.forEach(([, init]) => {
      expect(new Headers((init as RequestInit).headers).has('Authorization'))
        .toBe(false)
    })
    expect(auth.getSession).not.toHaveBeenCalled()
  })

  it('loads the authenticated signed license snapshot through the central API client', async () => {
    const auth = authDouble()
    const fetcher = vi.fn().mockResolvedValue(json({
      snapshot: {
        alg: 'EdDSA',
        key_id: 'altgrid-license-v1',
        payload: 'payload',
        signature: 'signature',
      },
    }))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher,
    })

    await expect(api.getLicenseSnapshot()).resolves.toMatchObject({
      snapshot: { alg: 'EdDSA', key_id: 'altgrid-license-v1' },
    })
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/license/snapshot')
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer old-access-token',
    )
  })

  it('refreshes once after a 401 and retries with the new token', async () => {
    const auth = authDouble()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({
        error: { code: 'invalid_token', message: 'Token inválido.' },
      }, 401))
      .mockResolvedValueOnce(json({
        account_limit: 10,
        expires_at: null,
        features: {},
        founder_number: null,
        lifetime: false,
        plan: 'PRO',
      }))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher,
    })

    await expect(api.getEntitlements()).resolves.toMatchObject({ plan: 'PRO' })

    expect(auth.refreshSession).toHaveBeenCalledOnce()
    const secondInit = fetcher.mock.calls[1]?.[1] as RequestInit
    expect(new Headers(secondInit.headers).get('Authorization')).toBe(
      'Bearer new-access-token',
    )
  })

  it('does not loop when the retried request is still unauthorized', async () => {
    const auth = authDouble()
    const unauthorized = json({
      error: { code: 'invalid_token', message: 'Token inválido.' },
    }, 401)
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(json({
        error: { code: 'invalid_token', message: 'Token inválido.' },
      }, 401))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher,
    })

    await expect(api.getMe()).rejects.toMatchObject({ status: 401 })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(auth.refreshSession).toHaveBeenCalledOnce()
  })

  it('maps a terminal refresh failure back to an authentication-required 401', async () => {
    const auth = authDouble(
      vi.fn().mockResolvedValue(session),
      vi.fn().mockRejectedValue(new AuthServiceError('invalid_credentials')),
    )
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: vi.fn().mockResolvedValue(json({
        error: { code: 'invalid_token', message: 'Token inválido.' },
      }, 401)) as unknown as typeof fetch,
    })

    await expect(api.getMe()).rejects.toMatchObject({
      code: 'authentication_required',
      status: 401,
    })
  })

  it('treats a null refreshed session as an expired authentication session', async () => {
    const auth = authDouble(
      vi.fn().mockResolvedValue(session),
      vi.fn().mockResolvedValue(null),
    )
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: vi.fn().mockResolvedValue(json({
        error: { code: 'invalid_token', message: 'Token inválido.' },
      }, 401)) as unknown as typeof fetch,
    })

    await expect(api.getMe()).rejects.toMatchObject({
      code: 'authentication_required',
      status: 401,
    })
  })

  it('deduplicates concurrent GET requests to the same resource', async () => {
    const auth = authDouble()
    let resolveFetch!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher as unknown as typeof fetch,
    })

    const first = api.getGames()
    const second = api.getGames()

    expect(first).toBe(second)
    expect(fetcher).toHaveBeenCalledOnce()

    resolveFetch(json({ games: [] }))
    await expect(first).resolves.toEqual({ games: [] })
  })

  it('deduplicates the network call for concurrent private GETs', async () => {
    const auth = authDouble()
    let resolveFetch!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher as unknown as typeof fetch,
    })

    const first = api.getEntitlements()
    const second = api.getEntitlements()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    resolveFetch(json({
      account_limit: 2,
      expires_at: null,
      features: {},
      founder_number: null,
      lifetime: false,
      plan: 'FREE',
    }))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it('fails with a friendly timeout instead of waiting indefinitely', async () => {
    vi.useFakeTimers()
    const auth = authDouble()
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher as unknown as typeof fetch,
      timeoutMs: 250,
    })

    const request = api.getGames()
    const assertion = expect(request).rejects.toMatchObject({
      code: 'request_timeout',
      message: 'O serviço demorou para responder. Tente novamente.',
    })
    await vi.advanceTimersByTimeAsync(250)
    await assertion
  })

  it('also times out while reading a response body', async () => {
    vi.useFakeTimers()
    const auth = authDouble()
    const response = {
      ok: true,
      status: 200,
      text: () => new Promise<string>(() => undefined),
    } as Response
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: vi.fn().mockResolvedValue(response) as unknown as typeof fetch,
      timeoutMs: 250,
    })

    const request = api.getGames()
    const assertion = expect(request).rejects.toMatchObject({
      code: 'request_timeout',
    })
    await vi.advanceTimersByTimeAsync(250)
    await assertion
  })

  it('times out while acquiring a private SDK session', async () => {
    vi.useFakeTimers()
    const auth = authDouble(
      vi.fn(() => new Promise<Session | null>(() => undefined)),
    )
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: vi.fn() as unknown as typeof fetch,
      timeoutMs: 250,
    })

    const request = api.getMe()
    const assertion = expect(request).rejects.toMatchObject({
      code: 'request_timeout',
    })
    await vi.advanceTimersByTimeAsync(250)
    await assertion
  })

  it('rejects invalid JSON returned with a successful status', async () => {
    const auth = authDouble()
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: vi.fn().mockResolvedValue(new Response('not-json')) as unknown as typeof fetch,
    })

    await expect(api.getGames()).rejects.toMatchObject({
      code: 'invalid_response',
      status: 502,
    })
  })

  it('reports offline without clearing the stored authentication session', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const auth = authDouble()
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: vi.fn().mockRejectedValue(
        new TypeError('Failed to fetch'),
      ) as unknown as typeof fetch,
    })

    await expect(api.getGames()).rejects.toEqual(
      expect.objectContaining<Partial<BackendApiError>>({
        code: 'offline',
        message: 'Sem conexão. Suas contas continuam salvas.',
      }),
    )
    expect(auth.getSession).not.toHaveBeenCalled()
  })

  it.each([
    '',
    'http://api.example.com',
    'https://user:password@api.example.com',
    'https://api.example.com?debug=true',
    'https://api.example.com#fragment',
  ])('rejects an unsafe API base URL: %s', (baseUrl) => {
    const auth = authDouble()

    expect(() => new BackendApi({
      authService: auth.service,
      baseUrl,
    })).toThrow()
  })

  it('does not refresh or retry when the backend denies a non-admin user', async () => {
    const auth = authDouble()
    const fetcher = vi.fn().mockResolvedValue(json({
      error: {
        code: 'admin_required',
        message: 'Acesso administrativo necessário.',
      },
    }, 403))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher,
    })

    await expect(api.getAdminSession()).rejects.toMatchObject({
      code: 'admin_required',
      status: 403,
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })

  it('encodes admin user searches and sends mutations through the central client', async () => {
    const auth = authDouble()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({
        pagination: { has_more: false, page: 1, page_size: 25, total: 0 },
        users: [],
      }))
      .mockResolvedValueOnce(json({ ok: true }))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher,
    })

    await api.searchAdminUsers('nome+teste@example.com / HUNT', 1, 25)
    await api.setAdminPlan('10000000-0000-4000-8000-000000000001', {
      plan: 'PRO',
    })

    const [searchUrl, searchInit] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(searchUrl).toBe(
      'https://api.example.com/v1/admin/users?page=1&page_size=25&q=nome%2Bteste%40example.com+%2F+HUNT',
    )
    expect(new Headers(searchInit.headers).get('Authorization')).toBe(
      'Bearer old-access-token',
    )

    const [mutationUrl, mutationInit] = fetcher.mock.calls[1] as [string, RequestInit]
    expect(mutationUrl).toBe(
      'https://api.example.com/v1/admin/users/10000000-0000-4000-8000-000000000001/plan',
    )
    expect(mutationInit.method).toBe('POST')
    expect(new Headers(mutationInit.headers).get('Content-Type')).toBe(
      'application/json',
    )
    expect(JSON.parse(String(mutationInit.body))).toEqual({ plan: 'PRO' })
  })

  it('routes announcement CRUD through authenticated admin endpoints', async () => {
    const auth = authDouble()
    const announcement = {
      created_at: '2026-08-26T12:00:00.000Z',
      enabled: true,
      expires_at: null,
      id: 'notice/id',
      message: 'Novidades disponíveis.',
      published_at: '2026-08-26T12:00:00.000Z',
      title: 'Atualização',
      type: 'info',
      updated_at: '2026-08-26T12:00:00.000Z',
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ announcements: [announcement] }))
      .mockResolvedValueOnce(json({ announcement }, 201))
      .mockResolvedValueOnce(json({ announcement: { ...announcement, enabled: false } }))
      .mockResolvedValueOnce(json({ ok: true }))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher,
    })

    await api.getAdminAnnouncements()
    await api.createAdminAnnouncement({
      message: announcement.message,
      title: announcement.title,
      type: 'info',
    })
    await api.updateAdminAnnouncement('notice/id', { enabled: false })
    await api.deleteAdminAnnouncement('notice/id')

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.com/v1/admin/announcements',
      'https://api.example.com/v1/admin/announcements',
      'https://api.example.com/v1/admin/announcements/notice%2Fid',
      'https://api.example.com/v1/admin/announcements/notice%2Fid',
    ])
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).method).toBeUndefined()
    expect(fetcher.mock.calls.slice(1).map(([, init]) =>
      (init as RequestInit).method)).toEqual(['POST', 'PATCH', 'DELETE'])
    expect(JSON.parse(String(
      (fetcher.mock.calls[1]?.[1] as RequestInit).body,
    ))).toEqual({
      message: announcement.message,
      title: announcement.title,
      type: 'info',
    })
    expect(JSON.parse(String(
      (fetcher.mock.calls[2]?.[1] as RequestInit).body,
    ))).toEqual({ enabled: false })
    expect((fetcher.mock.calls[3]?.[1] as RequestInit).body).toBeUndefined()
  })

  it('starts a direct chat through the authenticated private endpoint', async () => {
    const auth = authDouble()
    const channel = {
      game_id: null,
      id: 'direct-channel',
      name: 'Amigo',
      participant_id: 'user/id',
      type: 'direct',
      unread: 0,
    }
    const fetcher = vi.fn().mockResolvedValue(json({ channel }, 201))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher,
    })

    await expect(api.startDirectChat('user/id')).resolves.toEqual({ channel })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/direct/user%2Fid',
      expect.objectContaining({ method: 'POST' }),
    )

    fetcher.mockResolvedValueOnce(json({ deleted: true }))
    await expect(api.deleteDirectChat('direct/channel')).resolves.toEqual({ deleted: true })
    expect(fetcher).toHaveBeenLastCalledWith(
      'https://api.example.com/v1/chat/direct/direct%2Fchannel',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('routes chat report review and moderation actions with encoded targets', async () => {
    const auth = authDouble()
    const expiresAt = '2026-08-27T12:00:00.000Z'
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({
        pagination: { has_more: false, page: 2, page_size: 25, total: 0 },
        reports: [],
      }))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ restriction: { id: 'restriction-id' } }))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ ok: true }))
    const api = new BackendApi({
      authService: auth.service,
      baseUrl: 'https://api.example.com',
      fetch: fetcher,
    })

    await api.getAdminChatReports('pending', 2, 25)
    await api.reviewAdminChatReport('report/id', 'actioned')
    await api.setAdminChatRestriction('user/id', {
      expires_at: expiresAt,
      kind: 'mute',
      reason: 'Spam repetido',
    })
    await api.clearAdminChatRestriction('user/id')
    await api.deleteAdminChatMessage('message/id')

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.com/v1/admin/chat/reports?page=2&page_size=25&status=pending',
      'https://api.example.com/v1/admin/chat/reports/report%2Fid/review',
      'https://api.example.com/v1/admin/chat/users/user%2Fid/restriction',
      'https://api.example.com/v1/admin/chat/users/user%2Fid/restriction/clear',
      'https://api.example.com/v1/admin/chat/messages/message%2Fid/delete',
    ])
    expect(JSON.parse(String(
      (fetcher.mock.calls[1]?.[1] as RequestInit).body,
    ))).toEqual({ status: 'actioned' })
    expect(JSON.parse(String(
      (fetcher.mock.calls[2]?.[1] as RequestInit).body,
    ))).toEqual({
      expires_at: expiresAt,
      kind: 'mute',
      reason: 'Spam repetido',
    })
    expect(fetcher.mock.calls.slice(1).map(([, init]) =>
      (init as RequestInit).method)).toEqual(['POST', 'POST', 'POST', 'POST'])
  })
})
