import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SafeUser } from '../src/types/backend-api'
import { createApi } from './app'
import { ApiError } from './lib/api-error'
import { EntitlementService } from './services/entitlement-service'
import { FakeRepository } from './test/fake-repository'
import type {
  AuthenticationService,
  PlanRecord,
  RateLimitBinding,
} from './types'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const ACCESS_TOKEN = 'valid-user-access-token'
const NOW = new Date('2026-08-25T12:00:00.000Z')

const user: SafeUser = {
  id: USER_ID,
  email: 'hunter@example.com',
  email_confirmed_at: '2026-08-25T10:05:00.000Z',
  created_at: '2026-08-25T10:00:00.000Z',
  last_sign_in_at: '2026-08-25T11:00:00.000Z',
}

const freePlan: PlanRecord = {
  id: 'free-plan',
  code: 'FREE',
  name: 'Free',
  max_accounts: 2,
  enabled: true,
  entitlement_rank: 0,
  features: {
    basic_grids: true,
    fullscreen_sessions: true,
    game_presets: true,
    advanced_grids: false,
    eco_mode: false,
    session_restore: false,
    founder_badge: false,
    beta_features: false,
  },
}

function jsonRequest(path: string, body?: unknown): Request {
  return new Request(`https://api.example.com${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    method: body === undefined ? 'GET' : 'POST',
  })
}

describe('Cloudflare Worker API', () => {
  let repository: FakeRepository
  let authentication: AuthenticationService
  let authenticate: AuthenticationService['authenticate']
  let rateLimit: RateLimitBinding['limit']
  let edgeRateLimit: RateLimitBinding['limit']
  let userRateLimit: RateLimitBinding['limit']
  let api: ReturnType<typeof createApi>

  beforeEach(() => {
    repository = new FakeRepository()
    repository.plans = [freePlan]
    authenticate = vi.fn(async (request: Request) => {
      if (request.headers.get('authorization') !== `Bearer ${ACCESS_TOKEN}`) {
        throw new ApiError(
          401,
          'authentication_required',
          'Token de acesso não informado.',
        )
      }

      return user
    })
    authentication = { authenticate }
    rateLimit = vi.fn(async () => ({ success: true }))
    edgeRateLimit = vi.fn(async () => ({ success: true }))
    userRateLimit = vi.fn(async () => ({ success: true }))
    api = createApi({
      authentication,
      repository,
      entitlementService: new EntitlementService(repository, () => NOW),
      edgeRateLimiter: { limit: edgeRateLimit },
      userRateLimiter: { limit: userRateLimit },
      deviceRateLimiter: { limit: rateLimit },
    })
  })

  it('GET /health identifies the healthy AltGrid API without authentication', async () => {
    const response = await api.fetch(new Request('https://api.example.com/health'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, service: 'altgrid-api' })
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('GET /v1/app/metrics returns aggregate-only public presence counters', async () => {
    repository.metrics = {
      users: { active: 7, total: 42 },
      active_window_seconds: 900,
      generated_at: '2026-08-25T12:00:00.000Z',
    }

    const response = await api.fetch(
      new Request('https://api.example.com/v1/app/metrics'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(repository.metrics)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=30, s-maxage=30',
    )
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('POST /v1/presence/heartbeat records only the authenticated account', async () => {
    const response = await api.fetch(new Request(
      'https://api.example.com/v1/presence/heartbeat',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      },
    ))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(repository.lastPresenceUserId).toBe(USER_ID)
    expect(userRateLimit).toHaveBeenCalledWith({ key: USER_ID })
  })

  it('POST /v1/presence/heartbeat requires authentication', async () => {
    const response = await api.fetch(new Request(
      'https://api.example.com/v1/presence/heartbeat',
      { method: 'POST' },
    ))

    expect(response.status).toBe(401)
    expect(repository.lastPresenceUserId).toBeNull()
  })

  it('GET /v1/me rejects a missing token with the standard error format', async () => {
    const response = await api.fetch(new Request('https://api.example.com/v1/me'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: {
        code: 'authentication_required',
        message: 'Token de acesso não informado.',
      },
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('GET /v1/me returns only the authenticated user and resolved safe data', async () => {
    repository.founderUpgradeEligible = true
    const response = await api.fetch(jsonRequest('/v1/me'))
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      user: { id: USER_ID, email: 'hunter@example.com' },
      profile: { referral_code: 'HUNT-ABCDEFGH' },
      plan: 'FREE',
      license: null,
      founder_number: null,
      founder_upgrade_eligible: true,
      account_limit: 2,
    })
    expect(payload).not.toHaveProperty('access_token')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('POST /v1/devices/register uses the token user and performs a safe upsert', async () => {
    const response = await api.fetch(jsonRequest('/v1/devices/register', {
      device_hash: 'a'.repeat(64),
      display_name: 'Meu computador',
      platform: 'windows',
      app_version: '2.0.0',
    }))

    expect(response.status).toBe(200)
    expect(repository.lastRegister).toMatchObject({
      userId: USER_ID,
      input: {
        device_hash: 'a'.repeat(64),
        display_name: 'Meu computador',
        platform: 'windows',
        app_version: '2.0.0',
      },
    })
    expect(rateLimit).toHaveBeenCalledWith({ key: `${USER_ID}:device-register` })
  })

  it('rejects user_id and other mass-assignment fields in device registration', async () => {
    const response = await api.fetch(jsonRequest('/v1/devices/register', {
      device_hash: 'a'.repeat(64),
      user_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'validation_error',
        message: 'Campo não permitido: user_id.',
      },
    })
    expect(repository.lastRegister).toBeNull()
  })

  it('GET /v1/devices returns bounded pagination metadata', async () => {
    const baseDevice = {
      device_hash: 'a'.repeat(64),
      display_name: null,
      platform: 'windows',
      app_version: '2.0.0',
      first_seen_at: NOW.toISOString(),
      last_seen_at: NOW.toISOString(),
      revoked_at: null,
    }
    repository.devices = [
      { ...baseDevice, id: '20000000-0000-4000-8000-000000000001' },
      {
        ...baseDevice,
        id: '20000000-0000-4000-8000-000000000002',
        device_hash: 'b'.repeat(64),
      },
    ]

    const response = await api.fetch(
      jsonRequest('/v1/devices?page=1&page_size=1'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      devices: [{ id: '20000000-0000-4000-8000-000000000001' }],
      pagination: { page: 1, page_size: 1, has_more: true },
    })
  })

  it('GET /v1/games returns the enabled catalog projection without authentication', async () => {
    repository.games = [
      {
        id: '30000000-0000-4000-8000-000000000001',
        slug: 'tibia',
        name: 'Tibia',
        launch_url: 'https://www.tibia.com/',
        developer_referral_url: null,
        icon_url: null,
        sort_order: 10,
        metadata: { category: 'mmorpg' },
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        slug: 'huntera',
        name: 'Huntera',
        launch_url: 'https://huntera.example.com/play',
        developer_referral_url: 'https://huntera.example.com/register',
        icon_url: 'https://huntera.example.com/icon.png',
        sort_order: 1,
        metadata: { region: 'br' },
      },
      {
        enabled: false,
        id: '30000000-0000-4000-8000-000000000003',
        slug: 'disabled-game',
        name: 'Disabled',
        launch_url: 'https://disabled.example.com/',
        developer_referral_url: null,
        icon_url: null,
        sort_order: 0,
        metadata: {},
      },
    ]

    const response = await api.fetch(
      new Request('https://api.example.com/v1/games'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      games: [repository.games[1], repository.games[0]],
    })
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=60, s-maxage=60',
    )
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('GET /v1/config/public returns only the repository public projection', async () => {
    repository.config = { minimum_app_version: '2.0.0' }

    const response = await api.fetch(
      new Request('https://api.example.com/v1/config/public'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      config: { minimum_app_version: '2.0.0' },
    })
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=60, s-maxage=60',
    )
  })

  it('rejects a device body larger than eight KiB before JSON allocation', async () => {
    const response = await api.fetch(jsonRequest('/v1/devices/register', {
      device_hash: 'a'.repeat(64),
      display_name: 'x'.repeat(9_000),
    }))

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: {
        code: 'payload_too_large',
        message: 'O corpo da requisição é muito grande.',
      },
    })
    expect(repository.lastRegister).toBeNull()
  })

  it('returns 429 in the standard format when the device limit is exhausted', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ success: false })

    const response = await api.fetch(jsonRequest('/v1/devices/register', {
      device_hash: 'a'.repeat(64),
    }))

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Muitas tentativas. Aguarde e tente novamente.',
      },
    })
  })
})
