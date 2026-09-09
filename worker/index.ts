import { createApi } from './app'
import { apiErrorResponse } from './lib/api-error'
import { SupabaseAuthenticationService } from './services/authentication-service'
import { EntitlementService } from './services/entitlement-service'
import {
  createSupabaseClients,
  SupabaseRepository,
} from './services/supabase-repository'
import { SupabaseAdminRepository } from './services/supabase-admin-repository'
import { AsymmetricLicenseSnapshotService } from './services/license-snapshot-service'
import { MercadoPagoPaymentService } from './services/mercado-pago-service'
import { StripePaymentService } from './services/stripe-service'
import { NowPaymentsService } from './services/nowpayments-service'
import { WhatsAppAdminNotifier } from './services/whatsapp-admin-notifier'
import { FirebaseAdminNotifier } from './services/firebase-admin-notifier'
import { CompositeAdminNotifier } from './services/composite-admin-notifier'
import type { WorkerEnvironment } from './types'

function allowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

type ApiRuntime = ReturnType<typeof createApi>

let cachedRuntime: {
  key: string
  api: ApiRuntime
} | null = null

function runtimeKey(environment: WorkerEnvironment): string {
  return [
    environment.SUPABASE_URL,
    environment.ALLOWED_ORIGINS,
    environment.FIREBASE_PROJECT_ID,
    environment.LICENSE_KEY_ID,
    environment.MERCADOPAGO_CARD_FEE_PERCENT,
    environment.STRIPE_SECRET_KEY,
    environment.STRIPE_WEBHOOK_SECRET,
    environment.STRIPE_PROCESSING_FEE_PERCENT,
    environment.STRIPE_TEST_MODE,
    environment.NOWPAYMENTS_API_KEY,
    environment.NOWPAYMENTS_IPN_SECRET,
    environment.NOWPAYMENTS_WEBHOOK_URL,
  ].join('|')
}

function createRuntime(environment: WorkerEnvironment): ApiRuntime {
  const clients = createSupabaseClients(environment)
  const repository = new SupabaseRepository(clients.data)
  const entitlementService = new EntitlementService(repository)
  const adminRepository = new SupabaseAdminRepository(clients.data)
  const adminMobileNotifier = new CompositeAdminNotifier([
    new FirebaseAdminNotifier({
      projectId: environment.FIREBASE_PROJECT_ID,
      repository: adminRepository,
      serviceAccountJson: environment.FIREBASE_SERVICE_ACCOUNT_JSON,
    }),
    new WhatsAppAdminNotifier({
      accessToken: environment.WHATSAPP_ACCESS_TOKEN,
      apiVersion: environment.WHATSAPP_GRAPH_API_VERSION,
      destinationNumber: environment.ADMIN_WHATSAPP_NUMBER,
      phoneNumberId: environment.WHATSAPP_PHONE_NUMBER_ID,
      templateLanguage: environment.WHATSAPP_TEMPLATE_LANGUAGE,
      templateName: environment.WHATSAPP_TEMPLATE_NAME,
    }),
  ])

  return createApi(
    {
      authentication: new SupabaseAuthenticationService(clients.auth),
      repository,
      adminRepository,
      entitlementService,
      platformRepository: repository,
      chatRepository: repository,
      paymentService: new MercadoPagoPaymentService(repository, {
        accessToken: environment.MERCADOPAGO_ACCESS_TOKEN,
        webhookSecret: environment.MERCADOPAGO_WEBHOOK_SECRET,
        webhookUrl: environment.MERCADOPAGO_WEBHOOK_URL,
        cardProcessingFeePercent: environment.MERCADOPAGO_CARD_FEE_PERCENT,
      }),
      stripePaymentService: new StripePaymentService(repository, {
        secretKey: environment.STRIPE_SECRET_KEY,
        webhookSecret: environment.STRIPE_WEBHOOK_SECRET,
        processingFeePercent: environment.STRIPE_PROCESSING_FEE_PERCENT,
        testMode: environment.STRIPE_TEST_MODE,
      }),
      nowPaymentsService: new NowPaymentsService(repository, {
        apiKey: environment.NOWPAYMENTS_API_KEY,
        ipnSecret: environment.NOWPAYMENTS_IPN_SECRET,
        webhookUrl: environment.NOWPAYMENTS_WEBHOOK_URL,
        processingFeePercent: environment.NOWPAYMENTS_PROCESSING_FEE_PERCENT,
      }),
      licenseSnapshotService: new AsymmetricLicenseSnapshotService(
        entitlementService,
        environment.PRIVATE_LICENSE_KEY,
        environment.LICENSE_KEY_ID,
      ),
      edgeRateLimiter: environment.EDGE_RATE_LIMITER,
      userRateLimiter: environment.USER_RATE_LIMITER,
      deviceRateLimiter: environment.DEVICE_RATE_LIMITER,
      chatRateLimiter: environment.CHAT_RATE_LIMITER,
      paymentRateLimiter: environment.PAYMENT_RATE_LIMITER,
      adminMobileNotifier,
    },
    { allowedOrigins: allowedOrigins(environment.ALLOWED_ORIGINS) },
  )
}

function getRuntime(environment: WorkerEnvironment): ApiRuntime {
  const key = runtimeKey(environment)
  if (!cachedRuntime || cachedRuntime.key !== key) {
    cachedRuntime = { key, api: createRuntime(environment) }
  }
  return cachedRuntime.api
}

export default {
  async fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    try {
      return getRuntime(environment).fetch(request)
    } catch (error) {
      return apiErrorResponse(error)
    }
  },
  async scheduled(
    _controller: { cron: string; scheduledTime: number },
    environment: WorkerEnvironment,
    context: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    const clients = createSupabaseClients(environment)
    const repository = new SupabaseRepository(clients.data)
    const paymentService = new MercadoPagoPaymentService(repository, {
      accessToken: environment.MERCADOPAGO_ACCESS_TOKEN,
      webhookSecret: environment.MERCADOPAGO_WEBHOOK_SECRET,
      webhookUrl: environment.MERCADOPAGO_WEBHOOK_URL,
      cardProcessingFeePercent: environment.MERCADOPAGO_CARD_FEE_PERCENT,
    })
    context.waitUntil(
      Promise.all([
        paymentService.reconcilePendingPayments(25).then((result) => {
          console.log('Mercado Pago reconciliation completed', result)
        }),
      ]),
    )
  },
}
