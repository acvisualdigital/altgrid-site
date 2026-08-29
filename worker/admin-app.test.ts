import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminUserDetail } from '../src/types/admin-api'
import type { SafeUser } from '../src/types/backend-api'
import { createApi } from './app'
import { EntitlementService } from './services/entitlement-service'
import { FakeAdminRepository } from './test/fake-admin-repository'
import { FakeRepository } from './test/fake-repository'

const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const TARGET_ID = '00000000-0000-4000-8000-000000000002'
const GAME_ID = '30000000-0000-4000-8000-000000000001'
const LICENSE_ID = '40000000-0000-4000-8000-000000000001'
const DEVICE_ID = '20000000-0000-4000-8000-000000000001'
const PRODUCT_ID = '50000000-0000-4000-8000-000000000001'
const REPORT_ID = '83000000-0000-4000-8000-000000000001'
const MESSAGE_ID = '84000000-0000-4000-8000-000000000001'
const REFERRAL_ID = '86000000-0000-4000-8000-000000000001'

const adminUser: SafeUser = {
  id: ADMIN_ID,
  email: 'admin@example.com',
  email_confirmed_at: '2026-08-25T10:00:00.000Z',
  created_at: '2026-08-25T10:00:00.000Z',
  last_sign_in_at: '2026-08-25T11:00:00.000Z',
}

const target: AdminUserDetail = {
  id: TARGET_ID,
  email: 'cliente@example.com',
  display_name: 'Cliente',
  referral_code: 'HUNT-ABCDEFGH',
  created_at: '2026-08-20T10:00:00.000Z',
  plan: 'FREE',
  license_status: null,
  expires_at: null,
  lifetime: false,
  founder_number: null,
  devices: [{
    id: DEVICE_ID,
    display_name: 'PC',
    platform: 'windows',
    app_version: '1.0.0',
    first_seen_at: '2026-08-20T10:00:00.000Z',
    last_seen_at: '2026-08-25T10:00:00.000Z',
    revoked_at: null,
  }],
  referrals: [{
    id: '60000000-0000-4000-8000-000000000001',
    referrer_user_id: TARGET_ID,
    referred_user_id: '00000000-0000-4000-8000-000000000003',
    status: 'pending',
    qualification_reason: null,
    created_at: '2026-08-21T10:00:00.000Z',
    qualified_at: null,
    rewarded_at: null,
  }],
  payments: [{
    id: '70000000-0000-4000-8000-000000000001',
    provider: 'manual',
    product_code: 'PRO_LIFETIME',
    amount: 99,
    currency: 'BRL',
    status: 'approved',
    fulfilled_at: null,
    paid_at: '2026-08-22T10:00:00.000Z',
    created_at: '2026-08-22T10:00:00.000Z',
  }],
  licenses: [],
  chat_status: {
    banned: false,
    muted_until: null,
    reason: null,
  },
}

function request(path: string, method = 'GET', body?: unknown): Request {
  return new Request(`https://api.example.com${path}`, {
    method,
    headers: {
      Authorization: 'Bearer admin-token',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('administrative Worker API', () => {
  let adminRepository: FakeAdminRepository
  let api: ReturnType<typeof createApi>

  beforeEach(() => {
    const repository = new FakeRepository()
    adminRepository = new FakeAdminRepository()
    adminRepository.users = [structuredClone(target)]
    adminRepository.games = [{
      id: GAME_ID,
      slug: 'huntera',
      name: 'Huntera',
      launch_url: 'https://huntera.example.com/play',
      developer_referral_url: null,
      icon_url: null,
      enabled: true,
      sort_order: 10,
      metadata: {},
      created_at: '2026-08-20T10:00:00.000Z',
      updated_at: '2026-08-20T10:00:00.000Z',
    }]
    adminRepository.config = [
      { key: 'referral_referrer_days', value: 7, updated_at: '2026-08-20T10:00:00.000Z' },
      { key: 'referral_referred_days', value: 7, updated_at: '2026-08-20T10:00:00.000Z' },
      { key: 'founder_max_sales', value: 100, updated_at: '2026-08-20T10:00:00.000Z' },
      { key: 'maintenance', value: false, updated_at: '2026-08-20T10:00:00.000Z' },
      { key: 'minimum_version', value: '0.9.0-beta.1', updated_at: '2026-08-20T10:00:00.000Z' },
      { key: 'latest_version', value: '0.9.0-beta.1', updated_at: '2026-08-20T10:00:00.000Z' },
      { key: 'update_channel', value: 'beta', updated_at: '2026-08-20T10:00:00.000Z' },
    ]
    adminRepository.products = [{
      id: PRODUCT_ID,
      code: 'PRO_LIFETIME',
      name: 'PRO Lifetime',
      price_amount: 99,
      currency: 'BRL',
      enabled: true,
      lifetime: true,
      updated_at: '2026-08-20T10:00:00.000Z',
    }]
    api = createApi({
      authentication: { authenticate: vi.fn(async () => adminUser) },
      repository,
      adminRepository,
      entitlementService: new EntitlementService(repository),
      edgeRateLimiter: { limit: vi.fn(async () => ({ success: true })) },
      userRateLimiter: { limit: vi.fn(async () => ({ success: true })) },
      deviceRateLimiter: { limit: vi.fn(async () => ({ success: true })) },
    })
  })

  it('denies a regular authenticated user at the backend before any admin operation', async () => {
    adminRepository.admin = false
    const response = await api.fetch(request('/v1/admin/users'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'admin_forbidden',
        message: 'Acesso administrativo não permitido.',
      },
    })
    expect(adminRepository.calls).toEqual([])
  })

  it('accepts a valid server-authorized admin and returns a minimal session', async () => {
    adminRepository.admin = true
    const response = await api.fetch(request('/v1/admin/session'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      admin: { user_id: ADMIN_ID, role: 'admin' },
    })
  })

  it('denies a regular user before a runtime config can be changed', async () => {
    adminRepository.admin = false
    const response = await api.fetch(request(
      '/v1/admin/config/maintenance',
      'PATCH',
      { value: true },
    ))
    expect(response.status).toBe(403)
    expect(adminRepository.config.find((entry) => entry.key === 'maintenance')?.value).toBe(false)
    expect(adminRepository.calls).toEqual([])
  })

  it('updates every typed runtime config and audits its before/after state', async () => {
    adminRepository.admin = true
    const updates = [
      ['referral_referrer_days', 14],
      ['referral_referred_days', 21],
      ['founder_max_sales', null],
      ['maintenance', true],
      ['minimum_version', '0.9.0-beta.1'],
      ['latest_version', '1.0.0-rc.2+build.7'],
      ['update_channel', 'stable'],
    ] as const

    for (const [key, value] of updates) {
      const response = await api.fetch(request(
        `/v1/admin/config/${key}`,
        'PATCH',
        { value },
      ))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ config: { key, value } })
    }

    expect(adminRepository.audit).toHaveLength(updates.length)
    expect(adminRepository.audit[0]).toMatchObject({
      action: 'config.update',
      target_id: 'update_channel',
      before_data: { key: 'update_channel', value: 'beta' },
      after_data: { key: 'update_channel', value: 'stable' },
    })
  })

  it.each([
    ['referral_referrer_days', -1],
    ['referral_referred_days', 3_651],
    ['founder_max_sales', 0],
    ['maintenance', 'true'],
    ['minimum_version', 'v1.0.0'],
    ['latest_version', '1.0.0-01'],
    ['update_channel', 'nightly'],
    ['not_administrable', true],
  ])('rejects invalid config %s without changing config', async (key, value) => {
    adminRepository.admin = true
    const before = structuredClone(adminRepository.config)
    const response = await api.fetch(request(
      `/v1/admin/config/${key}`,
      'PATCH',
      { value },
    ))
    expect(response.status).toBe(400)
    expect(adminRepository.config).toEqual(before)
    expect(adminRepository.calls).toEqual([])
  })

  it('searches users by referral/email/id and returns detail without a device hash', async () => {
    adminRepository.admin = true
    const list = await api.fetch(request('/v1/admin/users?q=HUNT-AB&page=1&page_size=10'))
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({
      users: [{ id: TARGET_ID, email: 'cliente@example.com' }],
      pagination: { total: 1, has_more: false },
    })

    const detail = await api.fetch(request(`/v1/admin/users/${TARGET_ID}`))
    const payload = await detail.json() as { user: AdminUserDetail }
    expect(payload.user.referrals).toHaveLength(1)
    expect(payload.user.payments).toHaveLength(1)
    expect(payload.user.devices[0]).not.toHaveProperty('device_hash')
  })

  it('lists referral logs and records manual approval and rejection', async () => {
    adminRepository.admin = true
    adminRepository.referrals = [{
      id: REFERRAL_ID,
      referrer_user_id: TARGET_ID,
      referred_user_id: '00000000-0000-4000-8000-000000000003',
      campaign_id: '87000000-0000-4000-8000-000000000001',
      campaign_name: 'Corrida de Indicações',
      status: 'pending',
      qualification_reason: 'awaiting_24h_validation',
      created_at: '2026-08-27T12:00:00.000Z',
      qualified_at: null,
      rewarded_at: null,
      referrer_email: 'cliente@example.com',
      referrer_display_name: 'Cliente',
      referrer_code: 'HUNT-ABCDEFGH',
      referred_email: 'indicado@example.com',
      referred_display_name: 'Indicado',
      device_hint: null,
      reward_days: 0,
    }]

    const list = await api.fetch(request('/v1/admin/referrals?status=pending&q=cliente'))
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({
      referrals: [{ id: REFERRAL_ID, status: 'pending' }],
      stats: { total: 1, pending: 1, rewarded: 0 },
      pagination: { total: 1 },
    })

    const approve = await api.fetch(request(
      `/v1/admin/referrals/${REFERRAL_ID}/approve`,
      'POST',
      { reason: 'Cadastro confirmado pelo suporte' },
    ))
    expect(approve.status).toBe(200)
    expect(await approve.json()).toMatchObject({
      referral: { id: REFERRAL_ID, status: 'rewarded', reward_days: 1 },
    })

    const reject = await api.fetch(request(
      `/v1/admin/referrals/${REFERRAL_ID}/reject`,
      'POST',
      { reason: 'Conta duplicada confirmada' },
    ))
    expect(reject.status).toBe(200)
    expect(await reject.json()).toMatchObject({
      referral: { id: REFERRAL_ID, status: 'rejected', reward_days: 0 },
    })
    expect(adminRepository.audit.map((entry) => entry.action)).toEqual([
      'referral.reject',
      'referral.approve',
    ])
  })

  it('rejects referral moderation without a documented reason', async () => {
    adminRepository.admin = true
    const response = await api.fetch(request(
      `/v1/admin/referrals/${REFERRAL_ID}/approve`,
      'POST',
      { reason: '' },
    ))
    expect(response.status).toBe(400)
    expect(adminRepository.calls).toEqual([])
  })

  it('grants PRO days, changes plan and records both critical actions', async () => {
    adminRepository.admin = true
    const grant = await api.fetch(request(
      `/v1/admin/users/${TARGET_ID}/grant-days`,
      'POST',
      { days: 30 },
    ))
    const plan = await api.fetch(request(
      `/v1/admin/users/${TARGET_ID}/plan`,
      'POST',
      { plan: 'FOUNDER' },
    ))
    expect(grant.status).toBe(200)
    expect(plan.status).toBe(200)
    expect(adminRepository.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'license.grant_pro_days', target: TARGET_ID }),
      expect.objectContaining({ action: 'license.set_plan', target: TARGET_ID }),
    ]))

    const audit = await api.fetch(request('/v1/admin/audit'))
    expect(await audit.json()).toMatchObject({
      entries: [
        { actor_user_id: ADMIN_ID, action: 'license.set_plan' },
        { actor_user_id: ADMIN_ID, action: 'license.grant_pro_days' },
      ],
      pagination: { total: 2 },
    })
  })

  it('edits game state/order, records audit and rejects unsafe launch URLs', async () => {
    adminRepository.admin = true
    const response = await api.fetch(request(
      `/v1/admin/games/${GAME_ID}`,
      'PATCH',
      { enabled: false, sort_order: 1 },
    ))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      game: { id: GAME_ID, enabled: false, sort_order: 1 },
    })
    expect(adminRepository.audit[0]).toMatchObject({ action: 'game.update' })

    const invalid = await api.fetch(request('/v1/admin/games', 'POST', {
      slug: 'unsafe',
      name: 'Unsafe',
      launch_url: 'javascript:alert(1)',
    }))
    expect(invalid.status).toBe(400)
    expect(adminRepository.games).toHaveLength(1)
  })

  it('supports lifetime, license/device actions, config and product edits', async () => {
    adminRepository.admin = true
    const responses = await Promise.all([
      api.fetch(request(`/v1/admin/users/${TARGET_ID}/lifetime`, 'POST', { plan: 'PRO_PLUS' })),
      api.fetch(request(`/v1/admin/licenses/${LICENSE_ID}/revoke`, 'POST', {})),
      api.fetch(request(`/v1/admin/devices/${DEVICE_ID}/revoke`, 'POST', {})),
      api.fetch(request(`/v1/admin/devices/${DEVICE_ID}/reset`, 'POST', {})),
      api.fetch(request('/v1/admin/config/referral_referrer_days', 'PATCH', { value: 14 })),
      api.fetch(request('/v1/admin/config/founder_max_sales', 'PATCH', { value: null })),
      api.fetch(request(`/v1/admin/products/${PRODUCT_ID}`, 'PATCH', {
        price_amount: 129.9,
        currency: 'brl',
        enabled: false,
      })),
    ])
    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(adminRepository.config.find((entry) => entry.key === 'referral_referrer_days')?.value)
      .toBe(14)
    expect(adminRepository.config.find((entry) => entry.key === 'founder_max_sales')?.value)
      .toBeNull()
    expect(adminRepository.products[0]).toMatchObject({
      price_amount: 129.9,
      currency: 'BRL',
      enabled: false,
    })
    expect(adminRepository.calls).toContainEqual(expect.objectContaining({
      action: 'license.activate_lifetime',
      target: TARGET_ID,
      value: expect.objectContaining({ plan: 'PRO_PLUS' }),
    }))

    const clearPrice = await api.fetch(request(
      `/v1/admin/products/${PRODUCT_ID}`,
      'PATCH',
      { price_amount: null, currency: 'BRL', enabled: false },
    ))
    expect(clearPrice.status).toBe(200)
    expect(adminRepository.products[0].price_amount).toBeNull()
  })

  it('creates, edits, lists and removes announcements with audit entries', async () => {
    adminRepository.admin = true
    const create = await api.fetch(request('/v1/admin/announcements', 'POST', {
      title: 'Manutenção programada',
      message: 'Os serviços ficarão indisponíveis por alguns minutos.',
      type: 'maintenance',
      published_at: '2026-08-26T12:00:00.000Z',
      expires_at: '2026-08-27T12:00:00.000Z',
      enabled: true,
    }))
    expect(create.status).toBe(201)
    const created = await create.json() as { announcement: { id: string } }

    const update = await api.fetch(request(
      `/v1/admin/announcements/${created.announcement.id}`,
      'PATCH',
      { enabled: false },
    ))
    expect(update.status).toBe(200)
    expect(await update.json()).toMatchObject({ announcement: { enabled: false } })

    const list = await api.fetch(request('/v1/admin/announcements'))
    expect(await list.json()).toMatchObject({
      announcements: [{ title: 'Manutenção programada', enabled: false }],
    })

    const remove = await api.fetch(request(
      `/v1/admin/announcements/${created.announcement.id}`,
      'DELETE',
    ))
    expect(remove.status).toBe(200)
    expect(adminRepository.announcements).toHaveLength(0)
    expect(adminRepository.audit.map((entry) => entry.action)).toEqual([
      'announcement.delete',
      'announcement.update',
      'announcement.create',
    ])
  })

  it('moderates chat independently from licenses and reviews reports', async () => {
    adminRepository.admin = true
    adminRepository.chatReports = [{
      id: REPORT_ID,
      message_id: MESSAGE_ID,
      reported_by: ADMIN_ID,
      reason: 'Flood',
      status: 'pending',
      created_at: '2026-08-25T12:00:00.000Z',
      reviewed_at: null,
      reviewed_by: null,
      message: {
        id: MESSAGE_ID,
        channel_id: '85000000-0000-4000-8000-000000000001',
        user_id: TARGET_ID,
        message: 'Mensagem denunciada',
        created_at: '2026-08-25T11:59:00.000Z',
        deleted_at: null,
      },
    }]

    const reports = await api.fetch(request('/v1/admin/chat/reports?status=pending'))
    expect(reports.status).toBe(200)
    expect(await reports.json()).toMatchObject({
      reports: [{ id: REPORT_ID, status: 'pending' }],
      pagination: { total: 1 },
    })

    const responses = await Promise.all([
      api.fetch(request(`/v1/admin/chat/reports/${REPORT_ID}/review`, 'POST', {
        status: 'actioned',
      })),
      api.fetch(request(`/v1/admin/chat/users/${TARGET_ID}/restriction`, 'POST', {
        kind: 'mute',
        reason: 'Flood repetido',
        expires_at: '2099-08-27T12:00:00.000Z',
      })),
      api.fetch(request(`/v1/admin/chat/messages/${MESSAGE_ID}/delete`, 'POST', {})),
    ])
    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(adminRepository.chatReports[0].status).toBe('actioned')
    expect(adminRepository.chatRestrictions).toHaveLength(1)
    expect(adminRepository.users[0].licenses).toEqual([])

    const clear = await api.fetch(request(
      `/v1/admin/chat/users/${TARGET_ID}/restriction/clear`,
      'POST',
      {},
    ))
    expect(clear.status).toBe(200)
    expect(adminRepository.chatRestrictions).toHaveLength(0)

    const invalidBan = await api.fetch(request(
      `/v1/admin/chat/users/${TARGET_ID}/restriction`,
      'POST',
      { kind: 'ban', reason: 'Ban', expires_at: '2099-08-27T12:00:00.000Z' },
    ))
    expect(invalidBan.status).toBe(400)
  })
})
