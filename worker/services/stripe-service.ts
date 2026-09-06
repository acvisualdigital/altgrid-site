import type { Json } from '../../src/types/database'
import type { SafeUser } from '../../src/types/backend-api'
import { ApiError } from '../lib/api-error'
import type { PaymentRecord, StripePaymentRepository } from '../types'

const STRIPE_API = 'https://api.stripe.com/v1'
const PRODUCT_CODES = new Set([
  'PRO_LIFETIME', 'PRO_PLUS_LIFETIME', 'PRO_PLUS_UPGRADE',
  'FOUNDER_LIFETIME', 'FOUNDER_UPGRADE', 'PLUS_FOUNDER_UPGRADE',
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Fetch = typeof fetch

interface StripeOptions {
  secretKey?: string
  webhookSecret?: string
  processingFeePercent?: string
  testMode?: string
  fetchImplementation?: Fetch
}

const OWNER_EMAIL = 'yacaciio@gmail.com'

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '')
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new ApiError(503, 'payments_unavailable', `Pagamento indisponível: ${name} não configurado.`)
  return normalized
}

function paymentResponse(payment: PaymentRecord): Record<string, unknown> {
  const metadata = payment.metadata && typeof payment.metadata === 'object' && !Array.isArray(payment.metadata)
    ? payment.metadata as Record<string, Json | undefined> : {}
  const checkout = metadata.checkout && typeof metadata.checkout === 'object' && !Array.isArray(metadata.checkout)
    ? metadata.checkout as Record<string, Json | undefined> : {}
  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status,
    product_code: payment.product_code,
    amount: Number(payment.amount),
    base_amount: Number(metadata.base_amount ?? payment.amount),
    processing_fee: Number(metadata.processing_fee ?? 0),
    currency: payment.currency,
    checkout_url: typeof checkout.checkout_url === 'string' ? checkout.checkout_url : null,
    expires_at: payment.provider_expires_at,
    paid_at: payment.paid_at,
    fulfilled_at: payment.fulfilled_at,
  }
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

export async function validateStripeSignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader) return false
  const parts = signatureHeader.split(',').map((part) => part.trim().split('=', 2))
  const timestamp = parts.find(([key]) => key === 't')?.[1]
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value)
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`)))
  return signatures.some((signature) => timingSafeEqual(expected, signature.toLowerCase()))
}

export class StripePaymentService {
  private readonly fetchImplementation: Fetch

  constructor(private readonly repository: StripePaymentRepository, private readonly options: StripeOptions) {
    // Cloudflare's native fetch must be invoked through the runtime binding.
    // Keeping the bare function reference and calling it later loses that
    // binding and throws "Illegal invocation" in production Workers.
    this.fetchImplementation = options.fetchImplementation ?? ((input, init) => globalThis.fetch(input, init))
  }

  async createCheckout(user: SafeUser, productCode: string, requestKey: string): Promise<Record<string, unknown>> {
    if (!PRODUCT_CODES.has(productCode)) throw new ApiError(404, 'product_unavailable', 'Produto indisponível.')
    if (!user.email) throw new ApiError(409, 'verified_email_required', 'Confirme um e-mail antes de iniciar o pagamento.')
    const secretKey = required(this.options.secretKey, 'STRIPE_SECRET_KEY')
    const testMode = enabled(this.options.testMode)
    const testKey = secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_')
    if (testMode !== testKey) {
      throw new ApiError(503, 'payments_unavailable', 'Configuração de ambiente da Stripe inconsistente.')
    }
    if (testMode && user.email.trim().toLowerCase() !== OWNER_EMAIL) {
      throw new ApiError(403, 'stripe_test_restricted', 'Checkout de teste disponível somente para a conta administradora.')
    }
    const feePercent = Number(this.options.processingFeePercent ?? '20')
    if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) throw new ApiError(503, 'payments_unavailable', 'Taxa do Stripe inválida.')
    const local = await this.repository.createPendingStripePayment(user.id, productCode, requestKey, feePercent)
    if (local.provider_payment_id) return { payment: paymentResponse(local) }

    // Stripe requires expires_at to be at least 30 minutes in the future.
    // One extra minute prevents network latency from crossing that boundary.
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 31 * 60
    const params = new URLSearchParams({
      mode: 'payment',
      success_url: 'https://altgrid.com.br/?stripe=success',
      cancel_url: 'https://altgrid.com.br/?stripe=cancelled',
      customer_email: user.email,
      client_reference_id: local.id,
      expires_at: String(expiresAtSeconds),
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'brl',
      'line_items[0][price_data][unit_amount]': String(Math.round(Number(local.amount) * 100)),
      'line_items[0][price_data][product_data][name]': `AltGrid ${productCode.replace(/_/g, ' ')}`,
      'line_items[0][price_data][product_data][description]': 'Licença vitalícia · pagamento único',
      'metadata[altgrid_payment_id]': local.id,
      'metadata[altgrid_product_code]': productCode,
      'metadata[altgrid_environment]': testMode ? 'test' : 'live',
      'payment_intent_data[metadata][altgrid_payment_id]': local.id,
    })
    let response: Response
    try {
      response = await this.fetchImplementation(`${STRIPE_API}/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': local.id,
        },
        body: params,
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      console.error('Stripe Checkout request failed', {
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'Unknown Stripe request failure',
      })
      throw new ApiError(503, 'payment_provider_unavailable', 'A Stripe está temporariamente indisponível.')
    }
    const body = await response.json().catch(() => null) as {
      id?: string
      url?: string
      expires_at?: number
      error?: { code?: string; message?: string; param?: string; type?: string }
    } | null
    if (!response.ok || !body?.id?.startsWith('cs_') || !body.url?.startsWith('https://checkout.stripe.com/')) {
      console.error('Stripe rejected Checkout Session creation', {
        status: response.status,
        code: body?.error?.code,
        type: body?.error?.type,
        param: body?.error?.param,
        message: body?.error?.message,
      })
      throw new ApiError(502, 'payment_provider_error', 'Não foi possível criar o checkout com cartão.')
    }
    const attached = await this.repository.attachStripeCheckout(
      user.id, local.id, body.id,
      new Date((body.expires_at ?? expiresAtSeconds) * 1000).toISOString(), body.url,
    )
    return { payment: paymentResponse(attached) }
  }

  async handleWebhook(request: Request): Promise<PaymentRecord | null> {
    const webhookSecret = required(this.options.webhookSecret, 'STRIPE_WEBHOOK_SECRET')
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > 65_536) throw new ApiError(413, 'payload_too_large', 'Evento muito grande.')
    if (!await validateStripeSignature(rawBody, request.headers.get('stripe-signature'), webhookSecret)) {
      throw new ApiError(401, 'invalid_webhook_signature', 'Assinatura inválida.')
    }
    const event = JSON.parse(rawBody) as { id?: string; type?: string; data?: { object?: Record<string, unknown> } }
    if (!event.id || !event.type || !event.data?.object) throw new ApiError(400, 'validation_error', 'Evento inválido.')
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired'].includes(event.type)) return null
    const session = event.data.object
    const sessionId = String(session.id ?? '')
    const metadata = session.metadata as Record<string, unknown> | undefined
    const paymentId = String(metadata?.altgrid_payment_id ?? session.client_reference_id ?? '')
    const amount = Number(session.amount_total) / 100
    const currency = String(session.currency ?? '').toUpperCase()
    if (!sessionId.startsWith('cs_') || !UUID.test(paymentId) || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      throw new ApiError(400, 'validation_error', 'Checkout inconsistente.')
    }
    const status = event.type === 'checkout.session.expired'
      ? 'expired'
      : session.payment_status === 'paid' ? 'paid' : 'open'
    // Test-mode webhooks exercise the complete signature/event pipeline, but
    // must never grant, revoke or replace a license in the production database.
    const suppressTestFulfillment = enabled(this.options.testMode)
      && metadata?.altgrid_environment === 'test'
      && status === 'paid'
    const processedStatus = suppressTestFulfillment ? 'open' : status
    const payloadHash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody)))
    const processed = await this.repository.processStripeCheckout({
      sessionId, paymentId, status: processedStatus, amount, currency,
      paidAt: processedStatus === 'paid' ? new Date().toISOString() : null,
      eventId: event.id, payloadHash,
      providerData: {
        type: event.type,
        payment_status: String(session.payment_status ?? ''),
        test_fulfillment_suppressed: suppressTestFulfillment,
      } as Json,
    })
    return this.repository.getPaymentById(processed.payment_id)
  }
}
