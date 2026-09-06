import { describe, expect, it, vi } from 'vitest'

import type { SafeUser } from '../../src/types/backend-api'
import type { PaymentRecord, StripePaymentRepository } from '../types'
import { StripePaymentService, validateStripeSignature } from './stripe-service'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const PAYMENT_ID = '10000000-0000-4000-8000-000000000001'
const user: SafeUser = {
  id: USER_ID, email: 'yacaciio@gmail.com',
  email_confirmed_at: '2026-09-06T00:00:00.000Z',
  created_at: '2026-09-06T00:00:00.000Z', last_sign_in_at: null,
}

function record(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: PAYMENT_ID, user_id: USER_ID, provider: 'stripe', provider_payment_id: null,
    provider_external_reference: PAYMENT_ID, product_code: 'PRO_LIFETIME',
    amount: 23.88, currency: 'BRL', status: 'pending', raw_status: null,
    fulfilled_at: null, paid_at: null, provider_expires_at: null, failure_reason: null,
    metadata: { base_amount: 19.9, processing_fee: 3.98, processing_fee_percent: 20 },
    created_at: '2026-09-06T00:00:00.000Z', updated_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  }
}

class Repository implements StripePaymentRepository {
  current = record()
  fee = 0
  product = ''
  processedInput: Record<string, unknown> | null = null
  async createPendingStripePayment(_user: string, _product: string, _key: string, fee: number) {
    this.fee = fee
    this.product = _product
    return this.current
  }
  async attachStripeCheckout(_user: string, _payment: string, sessionId: string, expiresAt: string, checkoutUrl: string) {
    this.current = record({
      provider_payment_id: sessionId, provider_expires_at: expiresAt,
      metadata: { base_amount: 19.9, processing_fee: 3.98, processing_fee_percent: 20, checkout: { checkout_url: checkoutUrl } },
    })
    return this.current
  }
  async processStripeCheckout(input: Record<string, unknown>) {
    this.processedInput = input
    return { payment_id: PAYMENT_ID, status: 'paid', fulfilled: true, duplicate: false }
  }
  async getPaymentById() { return this.current }
}

describe('StripePaymentService', () => {
  it('adds the configured percentage fee and creates a one-time hosted Checkout', async () => {
    const repository = new Repository()
    const fetchImplementation = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ''))
      expect(body.get('mode')).toBe('payment')
      expect(body.get('payment_method_types[0]')).toBe('card')
      expect(body.has('automatic_payment_methods[enabled]')).toBe(false)
      expect(body.get('line_items[0][price_data][unit_amount]')).toBe('2388')
      expect(body.get('metadata[altgrid_payment_id]')).toBe(PAYMENT_ID)
      return new Response(JSON.stringify({
        id: 'cs_test_altgrid', url: 'https://checkout.stripe.com/c/pay/test', expires_at: 1_788_658_000,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const service = new StripePaymentService(repository, {
      secretKey: 'rk_test_example', processingFeePercent: '20', testMode: 'true', fetchImplementation,
    })
    const result = await service.createCheckout(user, 'PRO_LIFETIME', 'request-1')
    expect(repository.fee).toBe(20)
    expect(result.payment).toMatchObject({ amount: 23.88, base_amount: 19.9, processing_fee: 3.98 })
  })

  it('uses the same percentage rule for plan upgrades', async () => {
    const repository = new Repository()
    const service = new StripePaymentService(repository, {
      secretKey: 'rk_test_example', processingFeePercent: '20', testMode: 'true',
      fetchImplementation: vi.fn(async () => new Response(JSON.stringify({
        id: 'cs_test_upgrade', url: 'https://checkout.stripe.com/c/pay/upgrade', expires_at: 1_788_658_000,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    })

    await service.createCheckout(user, 'PLUS_FOUNDER_UPGRADE', 'request-upgrade')

    expect(repository.product).toBe('PLUS_FOUNDER_UPGRADE')
    expect(repository.fee).toBe(20)
  })

  it('restricts test Checkout to the administrator account', async () => {
    const service = new StripePaymentService(new Repository(), {
      secretKey: 'rk_test_example', testMode: 'true', fetchImplementation: vi.fn(),
    })
    await expect(service.createCheckout(
      { ...user, email: 'cliente@example.com' }, 'PRO_LIFETIME', 'request-2',
    )).rejects.toMatchObject({ status: 403, code: 'stripe_test_restricted' })
  })

  it('rejects a test key when the environment is marked as live', async () => {
    const service = new StripePaymentService(new Repository(), {
      secretKey: 'rk_test_example', testMode: 'false', fetchImplementation: vi.fn(),
    })
    await expect(service.createCheckout(user, 'PRO_LIFETIME', 'request-3'))
      .rejects.toMatchObject({ status: 503, code: 'payments_unavailable' })
  })

  it('processes test webhooks without fulfilling or replacing a real license', async () => {
    const repository = new Repository()
    const secret = 'whsec_test'
    const service = new StripePaymentService(repository, {
      secretKey: 'rk_test_example', webhookSecret: secret, testMode: 'true', fetchImplementation: vi.fn(),
    })
    const body = JSON.stringify({
      id: 'evt_test_checkout', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_test_altgrid', client_reference_id: PAYMENT_ID,
        amount_total: 2388, currency: 'brl', payment_status: 'paid',
        metadata: { altgrid_payment_id: PAYMENT_ID, altgrid_environment: 'test' },
      } },
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)))
    const signature = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')

    await service.handleWebhook(new Request('https://altgrid.test/webhook', {
      method: 'POST', body, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
    }))

    expect(repository.processedInput).toMatchObject({
      status: 'open', paidAt: null,
      providerData: { payment_status: 'paid', test_fulfillment_suppressed: true },
    })
  })

  it('verifies Stripe webhook signatures and rejects changed payloads', async () => {
    const secret = 'whsec_test'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = '{"id":"evt_test"}'
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)))
    const signature = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
    expect(await validateStripeSignature(body, `t=${timestamp},v1=${signature}`, secret)).toBe(true)
    expect(await validateStripeSignature(`${body} `, `t=${timestamp},v1=${signature}`, secret)).toBe(false)
  })
})
