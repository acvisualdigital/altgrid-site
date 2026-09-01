import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SafeUser } from '../src/types/backend-api'
import { createApi } from './app'
import { EntitlementService } from './services/entitlement-service'
import { FakeRepository } from './test/fake-repository'
import type {
  AuthenticationService,
  AdminMobileNotifier,
  ChatRepository,
  LicenseSnapshotService,
  PaymentService,
  PaymentRecord,
  PlanRecord,
  PlatformRepository,
  RateLimitBinding,
} from './types'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const CHANNEL_ID = '10000000-0000-4000-8000-000000000001'
const RECIPIENT_ID = '00000000-0000-4000-8000-000000000099'
const MESSAGE_ID = '20000000-0000-4000-8000-000000000001'
const PAYMENT_ID = '30000000-0000-4000-8000-000000000001'

const user: SafeUser = {
  id: USER_ID,
  email: 'cliente@example.com',
  email_confirmed_at: '2026-08-25T10:00:00.000Z',
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
  features: { basic_grids: true },
}

function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://api.example.com${path}`, {
    method,
    headers: {
      Authorization: 'Bearer valid-token',
      ...headers,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('platform Worker endpoints', () => {
  let repository: FakeRepository
  let authentication: AuthenticationService
  let platformRepository: PlatformRepository
  let chatRepository: ChatRepository
  let paymentService: PaymentService
  let adminMobileNotifier: AdminMobileNotifier
  let licenseSnapshotService: LicenseSnapshotService
  let chatLimit: RateLimitBinding
  let paymentLimit: RateLimitBinding
  let api: ReturnType<typeof createApi>

  beforeEach(() => {
    repository = new FakeRepository()
    repository.plans = [freePlan]
    authentication = { authenticate: vi.fn(async () => user) }
    platformRepository = {
      createAppAdRequest: vi.fn(async (_userId, input) => ({
        id: '70000000-0000-4000-8000-000000000001',
        status: 'pending' as const,
        plan_code: input.plan_code,
        requested_days: input.requested_days,
        quoted_amount: input.requested_days * 3,
        currency: 'BRL',
        created_at: '2026-09-01T12:00:00.000Z',
      })),
      getActiveAppAds: vi.fn(async () => []),
      getUserAppAdRequests: vi.fn(async () => []),
      getAppAdPlans: vi.fn(async () => []),
      getAppConfig: vi.fn(async () => ({
        maintenance: false,
        minimum_version: '2.0.0',
      })),
      getAnnouncements: vi.fn(async () => [{
        id: '40000000-0000-4000-8000-000000000001',
        title: 'Aviso',
        message: 'Mensagem segura',
        type: 'info' as const,
        published_at: '2026-08-25T12:00:00.000Z',
        expires_at: null,
      }]),
      getPublicProducts: vi.fn(async () => [{
        code: 'PRO_LIFETIME',
        name: 'PRO Lifetime',
        description: null,
        price_amount: 99.9,
        currency: 'BRL',
        lifetime: true,
      }]),
      recordAppAdEvent: vi.fn(async () => undefined),
    }
    chatRepository = {
      deleteDirectChat: vi.fn(async () => undefined),
      getChatChannels: vi.fn(async () => [{
        id: CHANNEL_ID,
        type: 'global' as const,
        game_id: null,
        name: 'Global',
      }]),
      getChatStatus: vi.fn(async () => ({
        banned: false,
        muted_until: null,
        reason: null,
      })),
      getChatMessages: vi.fn(async () => []),
      getDirectChatAdminRecipient: vi.fn(async () => null),
      sendChatMessage: vi.fn(async (_userId, channelId, message) => ({
        id: MESSAGE_ID,
        channel_id: channelId,
        user_id: USER_ID,
        display_name: 'Cliente',
        message,
        created_at: '2026-08-25T12:00:00.000Z',
        edited_at: null,
        plan: 'FREE',
        founder_number: null,
      })),
      reportChatMessage: vi.fn(async () => ({ id: MESSAGE_ID, status: 'pending' })),
      startDirectChat: vi.fn(async (_userId, recipientId) => ({
        id: '30000000-0000-4000-8000-000000000001',
        type: 'direct' as const,
        game_id: null,
        name: 'Amigo',
        participant_id: recipientId,
        unread: 0,
      })),
    }
    paymentService = {
      createAppAdPixPayment: vi.fn(async () => ({ payment: { id: PAYMENT_ID, status: 'pending' } })),
      createPixPayment: vi.fn(async () => ({
        payment: {
          id: PAYMENT_ID,
          user_id: USER_ID,
          provider: 'mercadopago',
          provider_payment_id: '12345',
          provider_external_reference: PAYMENT_ID,
          product_code: 'PRO_LIFETIME',
          amount: 129.9,
          currency: 'BRL',
          status: 'pending',
          raw_status: 'pending',
          fulfilled_at: null,
          paid_at: null,
          provider_expires_at: null,
          failure_reason: null,
          metadata: {},
          created_at: '2026-09-01T12:00:00.000Z',
          updated_at: '2026-09-01T12:00:00.000Z',
        },
      })),
      getPayment: vi.fn(async () => ({
        payment: { id: PAYMENT_ID, status: 'approved' },
      })),
      getAppAdPayment: vi.fn(async () => ({ payment: { id: PAYMENT_ID, status: 'approved' } })),
      reconcilePayment: vi.fn(async () => ({
        payment: { id: PAYMENT_ID, status: 'approved' },
      })),
      reconcilePendingPayments: vi.fn(async () => ({
        checked: 0, failed: 0, updated: 0,
      })),
      handleWebhook: vi.fn(async () => null),
    }
    adminMobileNotifier = { notify: vi.fn(async () => undefined) }
    licenseSnapshotService = {
      createSnapshot: vi.fn(async () => ({
        snapshot: {
          payload: 'payload',
          signature: 'signature',
          alg: 'EdDSA' as const,
          key_id: 'altgrid-license-v1',
        },
      })),
    }
    chatLimit = { limit: vi.fn(async () => ({ success: true })) }
    paymentLimit = { limit: vi.fn(async () => ({ success: true })) }
    const alwaysAllowed = { limit: vi.fn(async () => ({ success: true })) }
    api = createApi({
      authentication,
      repository,
      platformRepository,
      chatRepository,
      paymentService,
      licenseSnapshotService,
      entitlementService: new EntitlementService(repository),
      edgeRateLimiter: alwaysAllowed,
      userRateLimiter: alwaysAllowed,
      deviceRateLimiter: alwaysAllowed,
      chatRateLimiter: chatLimit,
      paymentRateLimiter: paymentLimit,
      adminMobileNotifier,
    })
  })

  it('serves public config, announcements and server-authoritative products', async () => {
    const [config, announcements, products] = await Promise.all([
      api.fetch(request('/v1/app/config')),
      api.fetch(request('/v1/app/announcements')),
      api.fetch(request('/v1/products')),
    ])

    expect(await config.json()).toMatchObject({ config: { maintenance: false } })
    expect(await announcements.json()).toMatchObject({
      announcements: [{ title: 'Aviso', type: 'info' }],
    })
    expect(await products.json()).toMatchObject({
      products: [{ code: 'PRO_LIFETIME', price_amount: 99.9, currency: 'BRL' }],
    })
    expect(authentication.authenticate).not.toHaveBeenCalled()
  })

  it('serves the Windows update feed without exposing GitHub redirects to the launcher', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      Assets: [{
        FileName: 'AltGrid-1.5.0-win-x64-full.nupkg',
        PackageId: 'AltGrid',
        Type: 'Full',
        Version: '1.5.0',
      }],
    }), { status: 200 }))
    const alwaysAllowed = { limit: vi.fn(async () => ({ success: true })) }
    const updateApi = createApi({
      authentication,
      repository,
      entitlementService: new EntitlementService(repository),
      edgeRateLimiter: alwaysAllowed,
      userRateLimiter: alwaysAllowed,
      deviceRateLimiter: alwaysAllowed,
    }, { fetcher })

    const feed = await updateApi.fetch(new Request(
      'https://api.example.com/v1/updates/releases.win-x64.json?localVersion=1.5.0&id=AltGrid',
    ))
    expect(feed.status).toBe(200)
    await expect(feed.json()).resolves.toMatchObject({
      Assets: [{ Version: '1.5.0' }],
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://github.com/acvisualdigital/altgrid-releases/releases/latest/download/releases.win-x64.json',
      { headers: { Accept: 'application/json' } },
    )
    expect(authentication.authenticate).not.toHaveBeenCalled()

    const packageResponse = await updateApi.fetch(new Request(
      'https://api.example.com/v1/updates/AltGrid-1.5.1-win-x64-full.nupkg',
    ))
    expect(packageResponse.status).toBe(302)
    expect(packageResponse.headers.get('Location')).toBe(
      'https://github.com/acvisualdigital/altgrid-releases/releases/latest/download/AltGrid-1.5.1-win-x64-full.nupkg',
    )

    const rejected = await updateApi.fetch(new Request(
      'https://api.example.com/v1/updates/../../secrets.txt',
    ))
    expect(rejected.status).toBe(404)
  })

  it('streams the latest Android APK with resumable download headers', async () => {
    let receivedHeaders: Headers | null = null
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      receivedHeaders = new Headers(init?.headers)
      return new Response('apk-bytes', {
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': '9',
        'Content-Range': 'bytes 0-8/9',
      },
      })
    })
    const alwaysAllowed = { limit: vi.fn(async () => ({ success: true })) }
    const downloadApi = createApi({
      authentication,
      repository,
      entitlementService: new EntitlementService(repository),
      edgeRateLimiter: alwaysAllowed,
      userRateLimiter: alwaysAllowed,
      deviceRateLimiter: alwaysAllowed,
    }, { fetcher })

    const response = await downloadApi.fetch(new Request(
      'https://api.example.com/v1/downloads/android',
      { headers: { Range: 'bytes=0-8' } },
    ))
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Length')).toBe('9')
    expect(response.headers.get('Content-Range')).toBe('bytes 0-8/9')
    expect(response.headers.get('Content-Disposition')).toContain('AltGrid-Android-latest.apk')
    await expect(response.text()).resolves.toBe('apk-bytes')
    expect(fetcher).toHaveBeenCalledWith(
      'https://github.com/acvisualdigital/altgrid-releases/releases/latest/download/AltGrid-Android-latest.apk',
      { headers: expect.any(Headers) },
    )
    expect(receivedHeaders).not.toBeNull()
    expect((receivedHeaders as Headers | null)?.get('Range')).toBe('bytes=0-8')
  })

  it('sends chat messages as the authenticated user with a dedicated rate limit', async () => {
    const response = await api.fetch(request(
      `/v1/chat/channels/${CHANNEL_ID}/messages`,
      'POST',
      { message: ' Olá,\n  mundo! ' },
    ))

    expect(response.status).toBe(201)
    expect(chatRepository.sendChatMessage).toHaveBeenCalledWith(
      USER_ID,
      CHANNEL_ID,
      'Olá, mundo!',
    )
    expect(chatLimit.limit).toHaveBeenCalledWith({ key: `${USER_ID}:chat-send` })

    const impersonation = await api.fetch(request(
      `/v1/chat/channels/${CHANNEL_ID}/messages`,
      'POST',
      { message: 'Teste', user_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    ))
    expect(impersonation.status).toBe(400)
  })

  it('notifies the administrator when a direct chat message is addressed to an admin account', async () => {
    vi.mocked(chatRepository.getDirectChatAdminRecipient!).mockResolvedValueOnce({
      userId: RECIPIENT_ID,
    })
    const response = await api.fetch(request(
      `/v1/chat/channels/${CHANNEL_ID}/messages`,
      'POST',
      { message: 'Preciso de ajuda com minha conta.' },
    ))
    expect(response.status).toBe(201)
    expect(adminMobileNotifier.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: `chat:${MESSAGE_ID}:admin-direct`,
      title: 'Nova mensagem direta',
      type: 'chat_direct',
      details: expect.arrayContaining([
        { label: 'Mensagem', value: 'Preciso de ajuda com minha conta.' },
      ]),
    }))

  })

  it('lists only the authenticated user chat channels', async () => {
    const response = await api.fetch(request('/v1/chat/channels'))

    expect(response.status).toBe(200)
    expect(chatRepository.getChatChannels).toHaveBeenCalledWith(USER_ID)
  })

  it('starts a private conversation using only authenticated and validated user ids', async () => {
    const response = await api.fetch(request(
      `/v1/chat/direct/${RECIPIENT_ID}`,
      'POST',
    ))

    expect(response.status).toBe(201)
    expect(chatRepository.startDirectChat).toHaveBeenCalledWith(USER_ID, RECIPIENT_ID)
    expect(chatLimit.limit).toHaveBeenCalledWith({ key: `${USER_ID}:chat-direct-start` })
    await expect(response.json()).resolves.toMatchObject({
      channel: {
        participant_id: RECIPIENT_ID,
        type: 'direct',
      },
    })

    const invalid = await api.fetch(request('/v1/chat/direct/not-a-uuid', 'POST'))
    expect(invalid.status).toBe(400)

    const deleted = await api.fetch(request(`/v1/chat/direct/${CHANNEL_ID}`, 'DELETE'))
    expect(deleted.status).toBe(200)
    expect(chatRepository.deleteDirectChat).toHaveBeenCalledWith(USER_ID, CHANNEL_ID)
    await expect(deleted.json()).resolves.toEqual({ deleted: true })
  })

  it('creates PIX from product_code only and forwards a stable idempotency key', async () => {
    const response = await api.fetch(request('/v1/payments/pix', 'POST', {
      product_code: 'pro_lifetime',
    }, { 'Idempotency-Key': 'checkout-001' }))

    expect(response.status).toBe(201)
    expect(paymentService.createPixPayment).toHaveBeenCalledWith(
      user,
      'PRO_LIFETIME',
      'checkout-001',
    )
    expect(paymentLimit.limit).toHaveBeenCalledWith({ key: `${USER_ID}:payment-create` })
    expect(adminMobileNotifier.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: `payment:${PAYMENT_ID}:attempt`,
      title: 'Nova tentativa de compra',
      type: 'purchase_attempt',
    }))

    const status = await api.fetch(request(`/v1/payments/${PAYMENT_ID}`))
    expect(status.status).toBe(200)
    expect(paymentService.getPayment).toHaveBeenCalledWith(USER_ID, PAYMENT_ID)

    const tampered = await api.fetch(request('/v1/payments/pix', 'POST', {
      product_code: 'PRO_LIFETIME',
      amount: 0.01,
    }))
    expect(tampered.status).toBe(400)
  })

  it('accepts the provider webhook without user auth and exposes signed snapshots only with auth', async () => {
    vi.mocked(paymentService.handleWebhook).mockResolvedValueOnce({
      id: PAYMENT_ID,
      user_id: USER_ID,
      provider: 'mercadopago',
      provider_payment_id: '12345',
      provider_external_reference: PAYMENT_ID,
      product_code: 'PRO_LIFETIME',
      amount: 129.9,
      currency: 'BRL',
      status: 'approved',
      raw_status: 'approved',
      fulfilled_at: '2026-09-01T12:00:00.000Z',
      paid_at: '2026-09-01T12:00:00.000Z',
      provider_expires_at: null,
      failure_reason: null,
      metadata: {},
      created_at: '2026-09-01T11:55:00.000Z',
      updated_at: '2026-09-01T12:00:00.000Z',
    } satisfies PaymentRecord)
    const webhook = await api.fetch(new Request(
      'https://api.example.com/v1/webhooks/mercadopago?data.id=123',
      { method: 'POST', body: '{}' },
    ))
    expect(webhook.status).toBe(200)
    expect(paymentService.handleWebhook).toHaveBeenCalledOnce()
    expect(adminMobileNotifier.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: `payment:${PAYMENT_ID}:approved`,
      title: 'Compra aprovada',
      type: 'purchase_approved',
    }))

    const snapshot = await api.fetch(request('/v1/license/snapshot'))
    expect(snapshot.status).toBe(200)
    expect(licenseSnapshotService.createSnapshot).toHaveBeenCalledWith(USER_ID)
  })

  it('serves advertising plans publicly and validates authenticated campaign requests', async () => {
    vi.mocked(platformRepository.getAppAdPlans).mockResolvedValueOnce([{
      code: 'sidebar',
      name: 'Vitrine lateral',
      description: 'Cartão patrocinado na lateral do AltGrid.',
      placement: 'sidebar',
      min_days: 7,
      max_days: 90,
      price_per_day: 3,
      currency: 'BRL',
      popup_enabled: false,
    }])

    const plans = await api.fetch(new Request('https://api.example.com/v1/app/ads/plans'))
    expect(plans.status).toBe(200)
    await expect(plans.json()).resolves.toMatchObject({
      plans: [{ code: 'sidebar', price_per_day: 3 }],
    })

    const input = {
      plan_code: 'sidebar',
      category: 'game',
      game_slug: 'huntera',
      advertiser_name: 'Estúdio Idle',
      title: 'Conheça nosso jogo',
      description: 'Uma aventura idle criada para jogar todos os dias.',
      destination_url: 'https://idle.example.com',
      image_url: 'https://idle.example.com/banner.png',
      cta_label: 'Jogar agora',
      requested_days: 7,
    }
    const created = await api.fetch(request('/v1/app/ads/requests', 'POST', input))
    expect(created.status).toBe(201)
    expect(platformRepository.createAppAdRequest).toHaveBeenCalledWith(USER_ID, {
      ...input,
      destination_url: 'https://idle.example.com/',
    })
    expect(paymentLimit.limit).toHaveBeenCalledWith({ key: `${USER_ID}:advertising-request` })
    expect(adminMobileNotifier.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'app-ad:70000000-0000-4000-8000-000000000001:created',
      title: 'Novo pedido de anúncio',
      type: 'ad_request',
    }))

    const catalogRequest = await api.fetch(request('/v1/app/ads/requests', 'POST', {
      ...input,
      game_slug: null,
      catalog_game_name: 'Novo Idle',
      catalog_launch_url: 'https://novo-idle.example.com/play',
      catalog_icon_url: 'https://novo-idle.example.com/icon.png',
    }))
    expect(catalogRequest.status).toBe(201)
    expect(platformRepository.createAppAdRequest).toHaveBeenLastCalledWith(USER_ID, expect.objectContaining({
      catalog_game_name: 'Novo Idle',
      catalog_launch_url: 'https://novo-idle.example.com/play',
      catalog_icon_url: 'https://novo-idle.example.com/icon.png',
    }))

    const unsafe = await api.fetch(request('/v1/app/ads/requests', 'POST', {
      ...input,
      destination_url: 'http://inseguro.example.com',
    }))
    expect(unsafe.status).toBe(400)

    vi.mocked(platformRepository.getUserAppAdRequests).mockResolvedValueOnce([{
      id: '70000000-0000-4000-8000-000000000001',
      plan_code: 'sidebar',
      advertiser_name: 'Estúdio Idle',
      title: 'Conheça nosso jogo',
      requested_days: 7,
      quoted_amount: 21,
      currency: 'BRL',
      status: 'payment_pending',
      admin_notes: 'Campanha aprovada para pagamento.',
      starts_at: null,
      ends_at: null,
      created_at: '2026-09-01T12:00:00.000Z',
      payment: null,
    }])
    const mine = await api.fetch(request('/v1/app/ads/requests'))
    expect(mine.status).toBe(200)
    await expect(mine.json()).resolves.toMatchObject({
      requests: [{ status: 'payment_pending', quoted_amount: 21 }],
    })

    vi.mocked(paymentService.createAppAdPixPayment).mockResolvedValueOnce({
      payment: {
        id: PAYMENT_ID,
        amount: 21,
        currency: 'BRL',
        status: 'pending',
        created_at: '2026-09-01T12:15:00.000Z',
      },
    })
    const pix = await api.fetch(request(
      '/v1/app/ads/requests/70000000-0000-4000-8000-000000000001/pix',
      'POST',
    ))
    expect(pix.status).toBe(201)
    expect(paymentService.createAppAdPixPayment).toHaveBeenCalledWith(
      user,
      '70000000-0000-4000-8000-000000000001',
    )
    expect(adminMobileNotifier.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'app-ad:70000000-0000-4000-8000-000000000001:pix-created',
      title: 'PIX de anúncio gerado',
      type: 'purchase_attempt',
    }))

    const paymentStatus = await api.fetch(request(
      '/v1/app/ads/requests/70000000-0000-4000-8000-000000000001/pix',
    ))
    expect(paymentStatus.status).toBe(200)
    expect(paymentService.getAppAdPayment).toHaveBeenCalledWith(
      USER_ID,
      '70000000-0000-4000-8000-000000000001',
    )
  })

  it('records only validated advertising event payloads for authenticated users', async () => {
    const campaignId = '70000000-0000-4000-8000-000000000001'
    const response = await api.fetch(request(`/v1/app/ads/${campaignId}/events`, 'POST', {
      event_type: 'click',
      placement: 'sidebar',
    }))
    expect(response.status).toBe(200)
    expect(platformRepository.recordAppAdEvent).toHaveBeenCalledWith(
      USER_ID,
      campaignId,
      'click',
      'sidebar',
    )

    const invalid = await api.fetch(request(`/v1/app/ads/${campaignId}/events`, 'POST', {
      event_type: 'purchase',
      placement: 'sidebar',
    }))
    expect(invalid.status).toBe(400)
  })
})
