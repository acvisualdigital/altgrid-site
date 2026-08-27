import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SafeUser } from '../../src/types/backend-api'
import type { Json } from '../../src/types/database'
import type {
  MercadoPagoSnapshot,
  PaymentRecord,
  PaymentRepository,
} from '../types'
import {
  MercadoPagoPaymentService,
  validateMercadoPagoSignature,
} from './mercado-pago-service'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const PAYMENT_ID = '10000000-0000-4000-8000-000000000001'

const user: SafeUser = {
  id: USER_ID,
  email: 'cliente@example.com',
  email_confirmed_at: '2026-08-25T10:00:00.000Z',
  created_at: '2026-08-25T10:00:00.000Z',
  last_sign_in_at: '2026-08-25T11:00:00.000Z',
}

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: PAYMENT_ID,
    user_id: USER_ID,
    provider: 'mercadopago',
    provider_payment_id: null,
    provider_external_reference: PAYMENT_ID,
    product_code: 'PRO_LIFETIME',
    amount: 129.9,
    currency: 'BRL',
    status: 'pending',
    raw_status: null,
    fulfilled_at: null,
    paid_at: null,
    provider_expires_at: null,
    failure_reason: null,
    metadata: {},
    created_at: '2026-08-25T12:00:00.000Z',
    updated_at: '2026-08-25T12:00:00.000Z',
    ...overrides,
  }
}

class FakePaymentRepository implements PaymentRepository {
  current = payment()
  attached: MercadoPagoSnapshot | null = null
  failed = false
  events = new Set<string>()
  processCalls: Array<{
    snapshot: MercadoPagoSnapshot
    eventId: string
    payloadHash: string
    providerData: Json
  }> = []

  async createPendingMercadoPagoPayment(): Promise<PaymentRecord> {
    return this.current
  }

  async attachMercadoPagoPayment(
    _userId: string,
    _paymentId: string,
    snapshot: MercadoPagoSnapshot,
  ): Promise<PaymentRecord> {
    this.attached = snapshot
    this.current = payment({
      provider_payment_id: snapshot.id,
      status: snapshot.status,
      raw_status: snapshot.status,
      provider_expires_at: snapshot.date_of_expiration,
      metadata: { checkout: snapshot.checkout as unknown as Json },
    })
    return this.current
  }

  async failPendingPayment(): Promise<void> {
    this.failed = true
  }

  async getUserPayment(userId: string, paymentId: string): Promise<PaymentRecord | null> {
    return userId === USER_ID && paymentId === PAYMENT_ID ? this.current : null
  }

  async processMercadoPagoPayment(
    snapshot: MercadoPagoSnapshot,
    eventId: string,
    payloadHash: string,
    providerData: Json,
  ) {
    const duplicate = this.events.has(eventId)
    this.events.add(eventId)
    this.processCalls.push({ snapshot, eventId, payloadHash, providerData })
    if (!duplicate) {
      this.current = payment({
        provider_payment_id: snapshot.id,
        status: snapshot.status,
        raw_status: snapshot.status,
        paid_at: snapshot.date_approved,
        fulfilled_at: snapshot.status === 'approved'
          ? '2026-08-25T12:01:00.000Z'
          : null,
      })
    }
    return {
      payment_id: PAYMENT_ID,
      status: this.current.status,
      fulfilled: this.current.fulfilled_at !== null,
      duplicate,
    }
  }
}

function providerPayment(status = 'pending') {
  return {
    id: '987654321',
    external_reference: PAYMENT_ID,
    status,
    transaction_amount: 129.9,
    currency_id: 'BRL',
    date_approved: status === 'approved' ? '2026-08-25T12:01:00.000Z' : null,
    date_of_expiration: '2026-08-25T12:30:00.000Z',
    date_last_updated: '2026-08-25T12:01:00.000Z',
    point_of_interaction: {
      transaction_data: {
        qr_code: '000201010212...',
        qr_code_base64: 'iVBORw0KGgo=',
        ticket_url: 'https://www.mercadopago.com.br/payments/987654321/ticket',
      },
    },
  }
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function webhookSignature(
  secret: string,
  dataId: string,
  requestId: string,
  timestamp: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(manifest),
  )
  return `ts=${timestamp},v1=${toHex(signature)}`
}

describe('MercadoPagoPaymentService', () => {
  let repository: FakePaymentRepository

  beforeEach(() => {
    repository = new FakePaymentRepository()
  })

  it('creates PIX with the amount resolved by the repository and provider idempotency', async () => {
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        transaction_amount: 129.9,
        payment_method_id: 'pix',
        external_reference: PAYMENT_ID,
        payer: { email: user.email },
      })
      expect(init?.headers).toMatchObject({ 'X-Idempotency-Key': PAYMENT_ID })
      return Response.json(providerPayment())
    }) as unknown as typeof fetch
    const service = new MercadoPagoPaymentService(repository, {
      accessToken: 'TEST-ACCESS-TOKEN',
      webhookUrl: 'https://api.example.com/v1/webhooks/mercadopago',
      fetchImplementation,
    })

    const result = await service.createPixPayment(user, 'PRO_LIFETIME', 'request-1')

    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(repository.attached).toMatchObject({
      id: '987654321',
      external_reference: PAYMENT_ID,
      transaction_amount: 129.9,
      currency_id: 'BRL',
    })
    expect(result).toMatchObject({
      payment: {
        id: PAYMENT_ID,
        status: 'pending',
        qr_code: '000201010212...',
      },
    })
  })

  it('rejects unavailable product codes before contacting Mercado Pago', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const service = new MercadoPagoPaymentService(repository, {
      accessToken: 'TEST-ACCESS-TOKEN',
      fetchImplementation,
    })

    await expect(service.createPixPayment(user, 'CUSTOM_PRICE', 'request-1'))
      .rejects.toMatchObject({ status: 404, code: 'product_unavailable' })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('returns a safe provider-unavailable error and never grants access on network failure', async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new TypeError('network offline with implementation details')
    }) as unknown as typeof fetch
    const service = new MercadoPagoPaymentService(repository, {
      accessToken: 'TEST-ACCESS-TOKEN',
      fetchImplementation,
    })

    await expect(service.createPixPayment(user, 'PRO_LIFETIME', 'request-1'))
      .rejects.toMatchObject({
        status: 503,
        code: 'payment_provider_unavailable',
        message: 'O provedor de pagamento está temporariamente indisponível.',
      })
    expect(repository.failed).toBe(true)
    expect(repository.current.fulfilled_at).toBeNull()
  })

  it('validates the documented HMAC manifest in constant-time compatible form', async () => {
    const signature = await webhookSignature('webhook-secret', 'ABC123', 'request-1', '1704908010')
    await expect(validateMercadoPagoSignature({
      xSignature: signature,
      xRequestId: 'request-1',
      dataId: 'ABC123',
      secret: 'webhook-secret',
    })).resolves.toBe(true)
    await expect(validateMercadoPagoSignature({
      xSignature: signature,
      xRequestId: 'request-tampered',
      dataId: 'ABC123',
      secret: 'webhook-secret',
    })).resolves.toBe(false)
  })

  it('re-fetches authoritative payment state and keeps duplicate webhooks idempotent', async () => {
    const secret = 'webhook-secret'
    const requestId = 'request-1'
    const dataId = '987654321'
    const timestamp = '1704908010'
    const signature = await webhookSignature(secret, dataId, requestId, timestamp)
    const fetchImplementation = vi.fn(
      async () => Response.json(providerPayment('approved')),
    ) as unknown as typeof fetch
    const service = new MercadoPagoPaymentService(repository, {
      accessToken: 'TEST-ACCESS-TOKEN',
      webhookSecret: secret,
      fetchImplementation,
    })
    const event = JSON.stringify({
      id: 4321,
      type: 'payment',
      action: 'payment.updated',
      data: { id: dataId },
    })
    const buildRequest = () => new Request(
      `https://api.example.com/v1/webhooks/mercadopago?data.id=${dataId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': requestId,
          'x-signature': signature,
        },
        body: event,
      },
    )

    await service.handleWebhook(buildRequest())
    await service.handleWebhook(buildRequest())

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(repository.processCalls).toHaveLength(2)
    expect(repository.processCalls[0]).toMatchObject({
      eventId: 'notification:4321',
      snapshot: {
        status: 'approved',
        transaction_amount: 129.9,
        currency_id: 'BRL',
      },
    })
    expect(repository.events.size).toBe(1)
    expect(repository.current.fulfilled_at).not.toBeNull()
  })

  it('rejects a webhook with an invalid signature before provider lookup', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const service = new MercadoPagoPaymentService(repository, {
      accessToken: 'TEST-ACCESS-TOKEN',
      webhookSecret: 'webhook-secret',
      fetchImplementation,
    })
    const request = new Request(
      'https://api.example.com/v1/webhooks/mercadopago?data.id=987654321',
      {
        method: 'POST',
        headers: {
          'x-request-id': 'request-1',
          'x-signature': `ts=1704908010,v1=${'0'.repeat(64)}`,
        },
        body: '{}',
      },
    )

    await expect(service.handleWebhook(request)).rejects.toMatchObject({
      status: 401,
      code: 'invalid_webhook_signature',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(repository.processCalls).toHaveLength(0)
  })
})
