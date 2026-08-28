import type { Json } from '../../src/types/database'
import type { SafeUser } from '../../src/types/backend-api'
import { ApiError } from '../lib/api-error'
import type {
  MercadoPagoCheckoutData,
  MercadoPagoSnapshot,
  PaymentRecord,
  PaymentRepository,
  PaymentService,
} from '../types'

const MERCADO_PAGO_API = 'https://api.mercadopago.com'
const PRODUCT_CODES = new Set([
  'PRO_LIFETIME',
  'PRO_PLUS_LIFETIME',
  'PRO_PLUS_UPGRADE',
  'FOUNDER_LIFETIME',
  'FOUNDER_UPGRADE',
  'PLUS_FOUNDER_UPGRADE',
])
const WEBHOOK_BODY_LIMIT = 32_768
const HEX_SHA256 = /^[a-f0-9]{64}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Fetch = typeof fetch

interface MercadoPagoOptions {
  accessToken?: string
  webhookSecret?: string
  webhookUrl?: string
  fetchImplementation?: Fetch
}

interface MercadoPagoPaymentBody {
  id?: string | number
  external_reference?: string | null
  status?: string
  transaction_amount?: number
  currency_id?: string
  date_approved?: string | null
  date_of_expiration?: string | null
  date_last_updated?: string | null
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string
      qr_code_base64?: string
      ticket_url?: string
    }
  }
}

function configuredSecret(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new ApiError(
      503,
      'payments_unavailable',
      `Pagamento indisponível: ${name} não configurado.`,
    )
  }
  return normalized
}

function basePaymentResponse(payment: PaymentRecord): Record<string, unknown> {
  const checkout = payment.metadata && typeof payment.metadata === 'object'
    && !Array.isArray(payment.metadata)
    ? payment.metadata.checkout
    : null
  const safeCheckout = checkout && typeof checkout === 'object' && !Array.isArray(checkout)
    ? checkout as Record<string, Json | undefined>
    : null

  return {
    id: payment.id,
    status: payment.status,
    product_code: payment.product_code,
    amount: Number(payment.amount),
    currency: payment.currency,
    qr_code: typeof safeCheckout?.qr_code === 'string' ? safeCheckout.qr_code : null,
    qr_code_base64: typeof safeCheckout?.qr_code_base64 === 'string'
      ? safeCheckout.qr_code_base64
      : null,
    ticket_url: typeof safeCheckout?.ticket_url === 'string'
      ? safeCheckout.ticket_url
      : null,
    expires_at: payment.provider_expires_at,
    paid_at: payment.paid_at,
    fulfilled_at: payment.fulfilled_at,
  }
}

function paymentSnapshot(body: MercadoPagoPaymentBody): MercadoPagoSnapshot {
  const checkout = body.point_of_interaction?.transaction_data
  const id = String(body.id ?? '').trim()
  const externalReference = body.external_reference?.trim() ?? ''
  const status = body.status?.trim() ?? ''
  const amount = Number(body.transaction_amount)
  const currency = body.currency_id?.trim().toUpperCase() ?? ''

  if (
    !id
    || !/^[0-9]+$/.test(id)
    || !UUID.test(externalReference)
    || !status
    || !Number.isFinite(amount)
    || amount <= 0
    || !/^[A-Z]{3}$/.test(currency)
  ) {
    throw new ApiError(
      502,
      'payment_provider_error',
      'O provedor retornou um pagamento inválido.',
    )
  }

  let checkoutData: MercadoPagoCheckoutData | null = null
  if (checkout?.qr_code && checkout.qr_code_base64) {
    checkoutData = {
      qr_code: checkout.qr_code,
      qr_code_base64: checkout.qr_code_base64,
      ticket_url: checkout.ticket_url ?? null,
    }
  }

  return {
    id,
    external_reference: externalReference.toLowerCase(),
    status,
    transaction_amount: amount,
    currency_id: currency,
    date_approved: body.date_approved ?? null,
    date_of_expiration: body.date_of_expiration ?? null,
    date_last_updated: body.date_last_updated ?? null,
    checkout: checkoutData,
  }
}

async function providerJson(response: Response): Promise<MercadoPagoPaymentBody> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError(
      502,
      'payment_provider_error',
      'O provedor de pagamento retornou uma resposta inválida.',
    )
  }

  if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
    console.error('Mercado Pago rejected payment request', {
      status: response.status,
    })
    throw new ApiError(
      502,
      'payment_provider_error',
      'Não foi possível processar o pagamento no provedor.',
    )
  }

  return body as MercadoPagoPaymentBody
}

async function providerRequest(
  fetchImplementation: Fetch,
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImplementation(input, init)
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      503,
      'payment_provider_unavailable',
      'O provedor de pagamento está temporariamente indisponível.',
    )
  }
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

/** Implements Mercado Pago's documented id/request-id/ts HMAC manifest. */
export async function validateMercadoPagoSignature(input: {
  xSignature: string | null
  xRequestId: string | null
  dataId: string | null
  secret: string
}): Promise<boolean> {
  if (!input.xSignature || !input.xRequestId || !input.dataId) return false

  const parts = new Map<string, string>()
  for (const rawPart of input.xSignature.split(',')) {
    const separator = rawPart.indexOf('=')
    if (separator < 1) continue
    parts.set(
      rawPart.slice(0, separator).trim(),
      rawPart.slice(separator + 1).trim(),
    )
  }

  const timestamp = parts.get('ts')
  const signature = parts.get('v1')?.toLowerCase()
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature || !HEX_SHA256.test(signature)) {
    return false
  }

  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.xRequestId};ts:${timestamp};`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const calculated = hex(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(manifest),
  ))
  return constantTimeEqual(calculated, signature)
}

async function requestText(request: Request): Promise<string> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > WEBHOOK_BODY_LIMIT) {
    throw new ApiError(413, 'payload_too_large', 'O corpo da requisição é muito grande.')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > WEBHOOK_BODY_LIMIT) {
    throw new ApiError(413, 'payload_too_large', 'O corpo da requisição é muito grande.')
  }
  return text
}

export class MercadoPagoPaymentService implements PaymentService {
  private readonly fetchImplementation: Fetch

  constructor(
    private readonly repository: PaymentRepository,
    private readonly options: MercadoPagoOptions,
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch
  }

  private async getProviderPayment(providerPaymentId: string): Promise<MercadoPagoSnapshot> {
    const accessToken = configuredSecret(this.options.accessToken, 'MERCADOPAGO_ACCESS_TOKEN')
    if (!/^[0-9]+$/.test(providerPaymentId)) {
      throw new ApiError(400, 'validation_error', 'Identificador de pagamento inválido.')
    }
    const response = await providerRequest(
      this.fetchImplementation,
      `${MERCADO_PAGO_API}/v1/payments/${encodeURIComponent(providerPaymentId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
    return paymentSnapshot(await providerJson(response))
  }

  async createPixPayment(
    user: SafeUser,
    productCode: string,
    requestKey: string,
  ): Promise<Record<string, unknown>> {
    if (!PRODUCT_CODES.has(productCode)) {
      throw new ApiError(404, 'product_unavailable', 'Produto indisponível.')
    }
    if (!user.email) {
      throw new ApiError(
        409,
        'verified_email_required',
        'Confirme um e-mail antes de iniciar o pagamento.',
      )
    }

    const accessToken = configuredSecret(this.options.accessToken, 'MERCADOPAGO_ACCESS_TOKEN')
    const localPayment = await this.repository.createPendingMercadoPagoPayment(
      user.id,
      productCode,
      requestKey,
    )

    if (localPayment.provider_payment_id) {
      return { payment: basePaymentResponse(localPayment) }
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1_000).toISOString()
    const providerBody: Record<string, unknown> = {
      transaction_amount: Number(localPayment.amount),
      description: `AltGrid ${productCode.includes('FOUNDER') ? 'Founder' : productCode.includes('PLUS') ? 'PLUS' : 'PRO'} Lifetime`,
      payment_method_id: 'pix',
      payer: { email: user.email },
      external_reference: localPayment.id,
      date_of_expiration: expiresAt,
      metadata: { altgrid_payment_id: localPayment.id },
    }
    if (this.options.webhookUrl?.trim()) {
      providerBody.notification_url = this.options.webhookUrl.trim()
    }

    try {
      const response = await providerRequest(
        this.fetchImplementation,
        `${MERCADO_PAGO_API}/v1/payments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': localPayment.id,
          },
          body: JSON.stringify(providerBody),
          signal: AbortSignal.timeout(15_000),
        },
      )
      const snapshot = paymentSnapshot(await providerJson(response))
      if (snapshot.external_reference !== localPayment.id) {
        throw new ApiError(
          502,
          'payment_provider_error',
          'O provedor retornou uma referência de pagamento inválida.',
        )
      }
      const attached = await this.repository.attachMercadoPagoPayment(
        user.id,
        localPayment.id,
        snapshot,
      )
      return { payment: basePaymentResponse(attached) }
    } catch (error) {
      try {
        await this.repository.failPendingPayment(
          user.id,
          localPayment.id,
          'provider creation failed',
        )
      } catch {
        // Preserve the provider error; a stale pending row is still safe and
        // cannot grant access without server-side reconciliation.
      }
      throw error
    }
  }

  async getPayment(
    userId: string,
    paymentId: string,
  ): Promise<Record<string, unknown> | null> {
    let payment = await this.repository.getUserPayment(userId, paymentId)
    if (!payment) return null

    if (this.shouldReconcile(payment)) {
      await this.reconcileRecord(payment, 'status_refresh')
      payment = await this.repository.getUserPayment(userId, paymentId)
      if (!payment) return null
    }

    return { payment: basePaymentResponse(payment) }
  }

  private shouldReconcile(payment: PaymentRecord): payment is PaymentRecord & {
    provider_payment_id: string
  } {
    return Boolean(
      payment.provider_payment_id
      && ['pending', 'in_process'].includes(payment.status),
    )
  }

  private async reconcileRecord(
    payment: PaymentRecord & { provider_payment_id: string },
    source: 'admin_refresh' | 'scheduled_refresh' | 'status_refresh',
  ): Promise<void> {
    const snapshot = await this.getProviderPayment(payment.provider_payment_id)
    if (snapshot.external_reference !== payment.id) {
      throw new ApiError(502, 'payment_provider_error', 'Referência de pagamento inválida.')
    }
    const eventId = `${source}:${snapshot.id}:${snapshot.date_last_updated ?? snapshot.status}`
    await this.repository.processMercadoPagoPayment(
      snapshot,
      eventId,
      await this.payloadHash(JSON.stringify(snapshot)),
      { source, provider_status: snapshot.status },
    )
  }

  async reconcilePayment(paymentId: string): Promise<Record<string, unknown> | null> {
    let payment = await this.repository.getPaymentById(paymentId)
    if (!payment) return null
    if (this.shouldReconcile(payment)) {
      await this.reconcileRecord(payment, 'admin_refresh')
      payment = await this.repository.getPaymentById(paymentId)
      if (!payment) return null
    }
    return { payment: basePaymentResponse(payment) }
  }

  async reconcilePendingPayments(limit = 25): Promise<{
    checked: number
    failed: number
    updated: number
  }> {
    const payments = await this.repository.listPendingMercadoPagoPayments(limit)
    let failed = 0
    let updated = 0
    for (const payment of payments) {
      if (!this.shouldReconcile(payment)) continue
      try {
        await this.reconcileRecord(payment, 'scheduled_refresh')
        updated += 1
      } catch (error) {
        failed += 1
        console.error('Scheduled Mercado Pago reconciliation failed', {
          paymentId: payment.id,
          error: error instanceof ApiError ? error.code : 'unexpected_error',
        })
      }
    }
    return { checked: payments.length, failed, updated }
  }

  private async payloadHash(payload: string): Promise<string> {
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)))
  }

  async handleWebhook(request: Request): Promise<void> {
    const webhookSecret = configuredSecret(
      this.options.webhookSecret,
      'MERCADOPAGO_WEBHOOK_SECRET',
    )
    const url = new URL(request.url)
    const dataId = url.searchParams.get('data.id') ?? url.searchParams.get('data_id')
    const requestId = request.headers.get('x-request-id')
    const valid = await validateMercadoPagoSignature({
      xSignature: request.headers.get('x-signature'),
      xRequestId: requestId,
      dataId,
      secret: webhookSecret,
    })
    if (!valid) {
      throw new ApiError(401, 'invalid_webhook_signature', 'Assinatura inválida.')
    }

    const rawBody = await requestText(request)
    let event: unknown
    try {
      event = JSON.parse(rawBody)
    } catch {
      throw new ApiError(400, 'validation_error', 'JSON inválido.')
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new ApiError(400, 'validation_error', 'Evento inválido.')
    }
    const body = event as Record<string, unknown>
    if (body.type !== 'payment' || !dataId || !/^[0-9]+$/.test(dataId)) {
      throw new ApiError(400, 'unsupported_webhook_event', 'Evento não suportado.')
    }

    // The body only identifies the resource. The authoritative status, amount,
    // currency and external_reference always come from this server-to-server GET.
    const snapshot = await this.getProviderPayment(dataId)
    const bodyData = body.data
    if (
      !bodyData
      || typeof bodyData !== 'object'
      || Array.isArray(bodyData)
      || String((bodyData as Record<string, unknown>).id ?? '') !== dataId
    ) {
      throw new ApiError(400, 'validation_error', 'Evento inconsistente.')
    }

    const notificationId = String(body.id ?? requestId ?? '').trim()
    if (!notificationId || notificationId.length > 200) {
      throw new ApiError(400, 'validation_error', 'Evento sem identificador.')
    }
    const eventId = `notification:${notificationId}`
    await this.repository.processMercadoPagoPayment(
      snapshot,
      eventId,
      await this.payloadHash(rawBody),
      {
        notification_id: notificationId,
        action: typeof body.action === 'string' ? body.action : null,
        type: 'payment',
        provider_status: snapshot.status,
      },
    )
  }
}
