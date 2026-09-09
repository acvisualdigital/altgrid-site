import type { Json } from '../../src/types/database'
import type { SafeUser } from '../../src/types/backend-api'
import { ApiError } from '../lib/api-error'
import type { NowPaymentsRepository, PaymentRecord } from '../types'
import type { NowPaymentsCurrency } from '../lib/platform-validation'

const API = 'https://api.nowpayments.io/v1'
const PRODUCTS = new Set(['PRO_LIFETIME', 'PRO_PLUS_LIFETIME', 'PRO_PLUS_UPGRADE', 'FOUNDER_LIFETIME', 'FOUNDER_UPGRADE', 'PLUS_FOUNDER_UPGRADE'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i
type Fetch = typeof fetch

interface Options { apiKey?: string; ipnSecret?: string; webhookUrl?: string; processingFeePercent?: string; fetchImplementation?: Fetch }
function required(value: string | undefined, name: string): string {
  const v = value?.trim(); if (!v) throw new ApiError(503, 'payments_unavailable', `Pagamento indisponível: ${name} não configurado.`); return v
}
function hex(buffer: ArrayBuffer): string { return [...new Uint8Array(buffer)].map((v) => v.toString(16).padStart(2, '0')).join('') }
function paymentResponse(payment: PaymentRecord): Record<string, unknown> {
  const metadata = payment.metadata && typeof payment.metadata === 'object' && !Array.isArray(payment.metadata) ? payment.metadata as Record<string, Json | undefined> : {}
  const checkout = metadata.checkout && typeof metadata.checkout === 'object' && !Array.isArray(metadata.checkout) ? metadata.checkout as Record<string, Json | undefined> : {}
  return { id: payment.id, provider: payment.provider, status: payment.status, product_code: payment.product_code, amount: Number(payment.amount), base_amount: Number(metadata.base_amount ?? payment.amount), processing_fee: Number(metadata.processing_fee ?? 0), currency: payment.currency, checkout_url: typeof checkout.checkout_url === 'string' ? checkout.checkout_url : null, expires_at: payment.provider_expires_at, paid_at: payment.paid_at, fulfilled_at: payment.fulfilled_at }
}
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).sort().reduce((out, key) => { out[key] = sortJson((value as Record<string, unknown>)[key]); return out }, {} as Record<string, unknown>)
  return value
}
async function validSignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false
  let body: unknown; try { body = JSON.parse(raw) } catch { return false }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(sortJson(body)))))
  return expected === header.toLowerCase()
}

export class NowPaymentsService {
  private readonly fetchImplementation: Fetch
  constructor(private readonly repository: NowPaymentsRepository, private readonly options: Options) { this.fetchImplementation = options.fetchImplementation ?? ((input, init) => globalThis.fetch(input, init)) }

  async createCheckout(user: SafeUser, productCode: string, requestKey: string, payCurrency: NowPaymentsCurrency = 'usdttrc20'): Promise<Record<string, unknown>> {
    if (!PRODUCTS.has(productCode)) throw new ApiError(404, 'product_unavailable', 'Produto indisponível.')
    if (!user.email) throw new ApiError(409, 'verified_email_required', 'Confirme um e-mail antes de iniciar o pagamento.')
    const apiKey = required(this.options.apiKey, 'NOWPAYMENTS_API_KEY')
    const parsedFee = Number(this.options.processingFeePercent ?? '10')
    const processingFeePercent = Number.isFinite(parsedFee) && parsedFee >= 0 && parsedFee <= 100 ? parsedFee : 10
    const local = await this.repository.createPendingNowPaymentsPayment(user.id, productCode, requestKey, processingFeePercent)
    if (local.provider_payment_id) return { payment: paymentResponse(local) }
    const callback = this.options.webhookUrl?.trim() || 'https://altgrid-api.altgrid.workers.dev/v1/webhooks/nowpayments'
    const params = { price_amount: Number(local.amount), price_currency: 'brl', pay_currency: payCurrency, order_id: local.id, order_description: `AltGrid ${productCode.replace(/_/g, ' ')}`, ipn_callback_url: callback, success_url: 'https://altgrid.com.br/?nowpayments=success', cancel_url: 'https://altgrid.com.br/?nowpayments=cancelled' }
    let response: Response
    try { response = await this.fetchImplementation(`${API}/invoice`, { method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(15_000) }) } catch { throw new ApiError(503, 'payment_provider_unavailable', 'O NOWPayments está temporariamente indisponível.') }
    const body = await response.json().catch(() => null) as { id?: string | number; invoice_url?: string; created_at?: string } | null
    if (!response.ok || !body?.id || !body.invoice_url?.startsWith('https://')) throw new ApiError(502, 'payment_provider_error', 'Não foi possível criar o checkout em cripto.')
    const attached = await this.repository.attachNowPaymentsCheckout(user.id, local.id, String(body.id), new Date(Date.now() + 60 * 60 * 1000).toISOString(), body.invoice_url)
    return { payment: paymentResponse(attached) }
  }

  async handleWebhook(request: Request): Promise<PaymentRecord | null> {
    const secret = required(this.options.ipnSecret, 'NOWPAYMENTS_IPN_SECRET')
    const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > 65_536) throw new ApiError(413, 'payload_too_large', 'Evento muito grande.')
    if (!await validSignature(raw, request.headers.get('x-nowpayments-sig'), secret)) throw new ApiError(401, 'invalid_webhook_signature', 'Assinatura IPN inválida.')
    const body = JSON.parse(raw) as Record<string, unknown>
    const providerId = String(body.payment_id ?? ''); const paymentId = String(body.order_id ?? '')
    const amount = Number(body.price_amount); const currency = String(body.price_currency ?? 'BRL').toUpperCase(); const statusRaw = String(body.payment_status ?? '')
    if (!providerId || !UUID.test(paymentId) || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, 'validation_error', 'Notificação IPN inválida.')
    const status = ['finished', 'confirmed'].includes(statusRaw) ? 'approved' : ['waiting', 'confirming', 'sending', 'partially_paid'].includes(statusRaw) ? 'pending' : ['failed', 'expired', 'refunded'].includes(statusRaw) ? 'rejected' : 'pending'
    const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))
    const processed = await this.repository.processNowPaymentsPayment({ providerPaymentId: providerId, paymentId, status, amount, currency, paidAt: status === 'approved' ? new Date().toISOString() : null, eventId: `nowpayments:${providerId}:${statusRaw}`, payloadHash: hash, providerData: body as Json })
    return this.repository.getPaymentById(processed.payment_id)
  }
}
