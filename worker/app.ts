import type {
  AppMetricsResponse,
  DeviceResponseEnvelope,
  DevicesResponse,
  MeResponse,
  PublicConfigResponse,
  PublicGamesResponse,
  PresenceHeartbeatResponse,
} from '../src/types/backend-api'
import { ApiError, apiErrorResponse, jsonResponse } from './lib/api-error'
import { adminAllowedMethods, handleAdminRequest } from './admin-app'
import {
  decodePathSegment,
  readDevicePagination,
  readRegisterDeviceInput,
  readDisplayName,
  requireUuid,
} from './lib/validation'
import {
  readChatMessage,
  readChatPagination,
  readChatReport,
  readAppAdEvent,
  readAppAdRequest,
  readIdempotencyKey,
  readPixInput,
  readPresenceHeartbeat,
} from './lib/platform-validation'
import { EntitlementService } from './services/entitlement-service'
import type {
  AuthenticationService,
  AdminRepository,
  AdminMobileNotifier,
  BackendRepository,
  ChatRepository,
  LicenseSnapshotService,
  PaymentService,
  PlatformRepository,
  RateLimitBinding,
} from './types'

interface ApiDependencies {
  authentication: AuthenticationService
  repository: BackendRepository
  adminRepository?: AdminRepository
  entitlementService: EntitlementService
  edgeRateLimiter: RateLimitBinding
  userRateLimiter: RateLimitBinding
  deviceRateLimiter: RateLimitBinding
  platformRepository?: PlatformRepository
  chatRepository?: ChatRepository
  paymentService?: PaymentService
  licenseSnapshotService?: LicenseSnapshotService
  chatRateLimiter?: RateLimitBinding
  paymentRateLimiter?: RateLimitBinding
  adminMobileNotifier?: AdminMobileNotifier
}

async function safelyNotifyAdmin(
  notifier: AdminMobileNotifier | undefined,
  input: Parameters<AdminMobileNotifier['notify']>[0],
): Promise<void> {
  if (!notifier || notifier.enabled === false) return
  try {
    await notifier.notify(input)
  } catch (error) {
    console.error('Admin mobile notification failed', {
      eventKey: input.eventKey,
      type: input.type,
      error: error instanceof Error ? error.message : 'unexpected_error',
    })
  }
}

interface ApiOptions {
  allowedOrigins?: readonly string[]
  fetcher?: typeof fetch
}

const UPDATE_RELEASE_BASE_URL =
  'https://github.com/acvisualdigital/altgrid-releases/releases/latest/download/'
const WINDOWS_UPDATE_FEED = 'releases.win-x64.json'
const WINDOWS_UPDATE_PACKAGE = /^AltGrid-[0-9A-Za-z.+-]+-win-x64-(?:full|delta)\.nupkg$/
const ANDROID_DOWNLOAD_PATH = '/v1/downloads/android'
const ANDROID_RELEASE_ASSET = 'AltGrid-Android-latest.apk'

function normalizedPath(url: string): string {
  const pathname = new URL(url).pathname
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

function allowedMethods(pathname: string): string[] | null {
  const adminMethods = adminAllowedMethods(pathname)
  if (adminMethods) return adminMethods

  if (
    pathname === '/v1/app/ads/requests'
    || /^\/v1\/app\/ads\/requests\/[^/]+\/pix$/.test(pathname)
  ) return ['GET', 'POST']

  if (
    pathname === '/health'
    || pathname === '/v1/me'
    || pathname === '/v1/me/entitlements'
    || pathname === '/v1/referrals'
    || pathname === '/v1/games'
    || pathname === '/v1/config/public'
    || pathname === '/v1/app/config'
    || pathname === '/v1/app/metrics'
    || pathname === '/v1/app/announcements'
    || pathname === '/v1/app/ads'
    || pathname === '/v1/app/ads/plans'
    || pathname === ANDROID_DOWNLOAD_PATH
    || pathname === '/v1/products'
    || pathname === '/v1/devices'
    || pathname === '/v1/chat/channels'
    || pathname === '/v1/chat/status'
    || pathname === '/v1/license/snapshot'
    || (
      pathname !== '/v1/payments/pix'
      && /^\/v1\/payments\/[^/]+$/.test(pathname)
    )
  ) {
    return ['GET']
  }

  if (
    pathname === '/v1/me/profile'
  ) {
    return ['PATCH']
  }

  if (
    pathname === '/v1/devices/register'
    || pathname === '/v1/presence/heartbeat'
    || /^\/v1\/devices\/[^/]+\/revoke$/.test(pathname)
    || pathname === '/v1/payments/pix'
    || pathname === '/v1/webhooks/mercadopago'
    || /^\/v1\/chat\/messages\/[^/]+\/report$/.test(pathname)
    || /^\/v1\/app\/ads\/[^/]+\/events$/.test(pathname)
  ) {
    return ['POST']
  }

  if (/^\/v1\/chat\/direct\/[^/]+$/.test(pathname)) {
    return ['POST', 'DELETE']
  }

  if (/^\/v1\/updates\/[^/]+$/.test(pathname)) {
    return ['GET']
  }

  if (/^\/v1\/chat\/channels\/[^/]+\/messages$/.test(pathname)) {
    return ['GET', 'POST']
  }

  return null
}

function addCorsHeaders(
  response: Response,
  origin: string | null,
): Response {
  const vary = response.headers.get('Vary')
  if (!vary) {
    response.headers.set('Vary', 'Origin')
  } else if (!vary.toLowerCase().split(',').map((value) => value.trim()).includes('origin')) {
    response.headers.set('Vary', `${vary}, Origin`)
  }

  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin)
  }

  return response
}

export function createApi(
  dependencies: ApiDependencies,
  options: ApiOptions = {},
): { fetch(request: Request): Promise<Response> } {
  const allowedOrigins = new Set(options.allowedOrigins ?? [])

  async function handle(request: Request): Promise<Response> {
    const pathname = normalizedPath(request.url)
    const methods = allowedMethods(pathname)

    if (!methods) {
      throw new ApiError(404, 'not_found', 'Endpoint não encontrado.')
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Idempotency-Key',
          'Access-Control-Allow-Methods': `${methods.join(', ')}, OPTIONS`,
          'Access-Control-Max-Age': '86400',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    if (!methods.includes(request.method)) {
      throw new ApiError(
        405,
        'method_not_allowed',
        'Método não permitido.',
        { Allow: `${methods.join(', ')}, OPTIONS` },
      )
    }

    if (pathname === '/health') {
      return jsonResponse({ ok: true, service: 'altgrid-api' })
    }

    const edgeKey = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    const edgeLimit = await dependencies.edgeRateLimiter.limit({
      key: edgeKey,
    })

    if (!edgeLimit.success) {
      throw new ApiError(
        429,
        'rate_limited',
        'Muitas tentativas. Aguarde e tente novamente.',
      )
    }

    const updateAssetMatch = /^\/v1\/updates\/([^/]+)$/.exec(pathname)
    if (updateAssetMatch) {
      const assetName = decodePathSegment(updateAssetMatch[1])
      if (assetName === WINDOWS_UPDATE_FEED) {
        const upstream = await (options.fetcher ?? fetch)(
          UPDATE_RELEASE_BASE_URL + WINDOWS_UPDATE_FEED,
          { headers: { Accept: 'application/json' } },
        )
        if (!upstream.ok) {
          throw new ApiError(502, 'update_feed_unavailable', 'Atualizações indisponíveis.')
        }
        const feed = await upstream.json() as { Assets?: unknown }
        if (!Array.isArray(feed.Assets)) {
          throw new ApiError(502, 'invalid_update_feed', 'Feed de atualizações inválido.')
        }
        return jsonResponse(feed, 200, {
          'Cache-Control': 'public, max-age=60, s-maxage=60',
        })
      }

      if (WINDOWS_UPDATE_PACKAGE.test(assetName)) {
        return new Response(null, {
          status: 302,
          headers: {
            'Cache-Control': 'public, max-age=60, s-maxage=60',
            Location: UPDATE_RELEASE_BASE_URL + encodeURIComponent(assetName),
          },
        })
      }

      throw new ApiError(404, 'update_asset_not_found', 'Arquivo de atualização não encontrado.')
    }

    if (pathname === ANDROID_DOWNLOAD_PATH) {
      const upstreamHeaders = new Headers({
        Accept: 'application/vnd.android.package-archive, application/octet-stream',
      })
      const range = request.headers.get('Range')
      if (range) upstreamHeaders.set('Range', range)

      const upstream = await (options.fetcher ?? fetch)(
        UPDATE_RELEASE_BASE_URL + ANDROID_RELEASE_ASSET,
        { headers: upstreamHeaders },
      )
      if (!upstream.ok) {
        throw new ApiError(502, 'android_download_unavailable', 'Download do Android indisponível.')
      }

      const responseHeaders = new Headers({
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Content-Disposition': 'attachment; filename="AltGrid-Android-latest.apk"',
        'Content-Type': 'application/vnd.android.package-archive',
        'X-Content-Type-Options': 'nosniff',
      })
      for (const header of ['Accept-Ranges', 'Content-Length', 'Content-Range', 'ETag', 'Last-Modified']) {
        const value = upstream.headers.get(header)
        if (value) responseHeaders.set(header, value)
      }
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      })
    }

    if (pathname === '/v1/games') {
      const body: PublicGamesResponse = {
        games: await dependencies.repository.getEnabledGames(),
      }
      return jsonResponse(body, 200, {
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      })
    }

    if (pathname === '/v1/config/public') {
      const body: PublicConfigResponse = {
        config: await dependencies.repository.getPublicConfig(),
      }
      return jsonResponse(body, 200, {
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      })
    }

    if (pathname === '/v1/app/config') {
      const config = dependencies.platformRepository
        ? await dependencies.platformRepository.getAppConfig()
        : await dependencies.repository.getPublicConfig()
      return jsonResponse({ config }, 200, {
        'Cache-Control': 'public, max-age=30, s-maxage=30',
      })
    }

    if (pathname === '/v1/app/metrics') {
      const body: AppMetricsResponse = await dependencies.repository.getAppMetrics()
      return jsonResponse(body, 200, {
        'Cache-Control': 'public, max-age=30, s-maxage=30',
      })
    }

    if (pathname === '/v1/app/announcements') {
      const announcements = dependencies.platformRepository
        ? await dependencies.platformRepository.getAnnouncements()
        : []
      return jsonResponse({ announcements }, 200, {
        'Cache-Control': 'public, max-age=30, s-maxage=30',
      })
    }

    if (pathname === '/v1/app/ads/plans') {
      const plans = dependencies.platformRepository
        ? await dependencies.platformRepository.getAppAdPlans()
        : []
      return jsonResponse({ plans }, 200, {
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      })
    }

    if (pathname === '/v1/app/ads') {
      const ads = dependencies.platformRepository
        ? await dependencies.platformRepository.getActiveAppAds()
        : []
      return jsonResponse({ ads, popup_cooldown_hours: 6 }, 200, {
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      })
    }

    if (pathname === '/v1/products') {
      const products = dependencies.platformRepository
        ? await dependencies.platformRepository.getPublicProducts()
        : []
      return jsonResponse({ products }, 200, {
        'Cache-Control': 'public, max-age=30, s-maxage=30',
      })
    }

    if (pathname === '/v1/webhooks/mercadopago') {
      if (!dependencies.paymentService) {
        throw new ApiError(503, 'payments_unavailable', 'Pagamento indisponível.')
      }
      const payment = await dependencies.paymentService.handleWebhook(request)
      if (payment && ['approved', 'paid', 'fulfilled'].includes(payment.status)) {
        await safelyNotifyAdmin(dependencies.adminMobileNotifier, {
          eventKey: `payment:${payment.id}:approved`,
          type: 'purchase_approved',
          title: 'Compra aprovada',
          occurredAt: payment.updated_at,
          details: [
            { label: 'Produto', value: payment.product_code },
            { label: 'Valor', value: `${payment.currency} ${payment.amount.toFixed(2)}` },
            { label: 'Status', value: payment.status },
            { label: 'Pagamento', value: payment.id },
          ],
        })
      }
      return jsonResponse({ ok: true })
    }

    const user = await dependencies.authentication.authenticate(request)
    const userLimit = await dependencies.userRateLimiter.limit({
      key: user.id,
    })

    if (!userLimit.success) {
      throw new ApiError(
        429,
        'rate_limited',
        'Muitas tentativas. Aguarde e tente novamente.',
      )
    }

    if (pathname === '/v1/presence/heartbeat') {
      await dependencies.repository.heartbeatPresence(user.id, await readPresenceHeartbeat(request))
      const body: PresenceHeartbeatResponse = { ok: true }
      return jsonResponse(body)
    }

    if (pathname === '/v1/me/profile') {
      if (!dependencies.repository.updateProfile) {
        throw new ApiError(503, 'profile_unavailable', 'Perfil indisponível.')
      }
      const profile = await dependencies.repository.updateProfile(
        user.id,
        await readDisplayName(request),
      )
      return jsonResponse({ profile })
    }

    if (pathname === '/v1/referrals') {
      return jsonResponse(await dependencies.repository.getReferralProgram(user.id))
    }

    if (pathname === '/v1/app/ads/requests') {
      if (!dependencies.platformRepository) {
        throw new ApiError(503, 'advertising_unavailable', 'Anúncios indisponíveis.')
      }
      if (request.method === 'GET') {
        return jsonResponse({
          requests: await dependencies.platformRepository.getUserAppAdRequests(user.id),
        })
      }
      const rateLimiter = dependencies.paymentRateLimiter ?? dependencies.deviceRateLimiter
      const { success } = await rateLimiter.limit({ key: `${user.id}:advertising-request` })
      if (!success) throw new ApiError(429, 'rate_limited', 'Aguarde antes de enviar outra solicitação.')
      const adInput = await readAppAdRequest(request)
      const created = await dependencies.platformRepository.createAppAdRequest(
        user.id,
        adInput,
      )
      await safelyNotifyAdmin(dependencies.adminMobileNotifier, {
        eventKey: `app-ad:${created.id}:created`,
        type: 'ad_request',
        title: 'Novo pedido de anúncio',
        occurredAt: created.created_at,
        details: [
          { label: 'Plano', value: created.plan_code },
          { label: 'Anunciante', value: adInput.advertiser_name },
          { label: 'Título', value: adInput.title },
          { label: 'Tipo', value: adInput.category },
          ...(adInput.game_slug
            ? [{ label: 'Jogo destacado', value: adInput.game_slug }]
            : adInput.catalog_game_name
              ? [{ label: 'Novo jogo solicitado', value: adInput.catalog_game_name }]
              : []),
          { label: 'Período', value: `${created.requested_days} dias` },
          { label: 'Orçamento', value: `${created.currency} ${created.quoted_amount.toFixed(2)}` },
          { label: 'Destino', value: adInput.destination_url },
          { label: 'Solicitação', value: created.id },
        ],
      })
      return jsonResponse({ request: created }, 201)
    }

    const appAdPixMatch = /^\/v1\/app\/ads\/requests\/([^/]+)\/pix$/.exec(pathname)
    if (appAdPixMatch) {
      if (!dependencies.paymentService) {
        throw new ApiError(503, 'payments_unavailable', 'Pagamento indisponível.')
      }
      const requestId = requireUuid(decodePathSegment(appAdPixMatch[1]), 'advertising request id')
      if (request.method === 'GET') {
        const payment = await dependencies.paymentService.getAppAdPayment(user.id, requestId)
        if (!payment) throw new ApiError(404, 'payment_not_found', 'Pagamento não encontrado.')
        return jsonResponse(payment)
      }
      const rateLimiter = dependencies.paymentRateLimiter ?? dependencies.deviceRateLimiter
      const { success } = await rateLimiter.limit({ key: `${user.id}:app-ad-payment` })
      if (!success) throw new ApiError(429, 'rate_limited', 'Aguarde antes de gerar outro PIX.')
      const checkout = await dependencies.paymentService.createAppAdPixPayment(user, requestId)
      const payment = checkout.payment && typeof checkout.payment === 'object'
        ? checkout.payment as Record<string, unknown>
        : null
      await safelyNotifyAdmin(dependencies.adminMobileNotifier, {
        eventKey: `app-ad:${requestId}:pix-created`,
        type: 'purchase_attempt',
        title: 'PIX de anúncio gerado',
        occurredAt: typeof payment?.created_at === 'string' ? payment.created_at : new Date().toISOString(),
        details: [
          { label: 'Cliente', value: user.email ?? user.id },
          { label: 'Solicitação', value: requestId },
          ...(typeof payment?.amount === 'number'
            ? [{ label: 'Valor', value: `${String(payment.currency ?? 'BRL')} ${payment.amount.toFixed(2)}` }]
            : []),
        ],
      })
      return jsonResponse(checkout, 201)
    }

    const appAdEventMatch = /^\/v1\/app\/ads\/([^/]+)\/events$/.exec(pathname)
    if (appAdEventMatch) {
      if (!dependencies.platformRepository) {
        throw new ApiError(503, 'advertising_unavailable', 'Anúncios indisponíveis.')
      }
      const campaignId = requireUuid(decodePathSegment(appAdEventMatch[1]), 'campaign id')
      const input = await readAppAdEvent(request)
      await dependencies.platformRepository.recordAppAdEvent(
        user.id,
        campaignId,
        input.eventType,
        input.placement,
      )
      return jsonResponse({ recorded: true })
    }

    if (pathname.startsWith('/v1/admin/')) {
      if (!dependencies.adminRepository) {
        throw new ApiError(503, 'admin_unavailable', 'Serviço administrativo indisponível.')
      }

      // This authorization is performed server-side for every admin request.
      // Client profile fields and route visibility never grant admin access.
      if (!await dependencies.adminRepository.isAdmin(user.id)) {
        throw new ApiError(403, 'admin_forbidden', 'Acesso administrativo não permitido.')
      }

      return handleAdminRequest(
        request,
        pathname,
        user.id,
        dependencies.adminRepository,
        dependencies.paymentService,
      )
    }

    if (pathname === '/v1/chat/channels') {
      if (!dependencies.chatRepository) {
        throw new ApiError(503, 'chat_unavailable', 'Chat indisponível.')
      }
      return jsonResponse({ channels: await dependencies.chatRepository.getChatChannels(user.id) })
    }

    if (pathname === '/v1/chat/status') {
      if (!dependencies.chatRepository) {
        throw new ApiError(503, 'chat_unavailable', 'Chat indisponível.')
      }
      return jsonResponse({ status: await dependencies.chatRepository.getChatStatus(user.id) })
    }

    const directChatMatch = /^\/v1\/chat\/direct\/([^/]+)$/.exec(pathname)
    if (directChatMatch) {
      if (!dependencies.chatRepository) {
        throw new ApiError(503, 'chat_unavailable', 'Chat indisponível.')
      }
      const directId = requireUuid(
        decodePathSegment(directChatMatch[1]),
        request.method === 'DELETE' ? 'channel id' : 'recipient id',
      )
      if (request.method === 'DELETE') {
        await dependencies.chatRepository.deleteDirectChat(user.id, directId)
        return jsonResponse({ deleted: true })
      }
      const rateLimiter = dependencies.chatRateLimiter ?? dependencies.deviceRateLimiter
      const { success } = await rateLimiter.limit({ key: `${user.id}:chat-direct-start` })
      if (!success) {
        throw new ApiError(429, 'rate_limited', 'Aguarde antes de abrir outra conversa.')
      }
      const channel = await dependencies.chatRepository.startDirectChat(user.id, directId)
      return jsonResponse({ channel }, 201)
    }

    const channelMessagesMatch = /^\/v1\/chat\/channels\/([^/]+)\/messages$/.exec(pathname)
    if (channelMessagesMatch) {
      if (!dependencies.chatRepository) {
        throw new ApiError(503, 'chat_unavailable', 'Chat indisponível.')
      }
      const channelId = requireUuid(
        decodePathSegment(channelMessagesMatch[1]),
        'channel id',
      )
      if (request.method === 'POST') {
        const rateLimiter = dependencies.chatRateLimiter ?? dependencies.deviceRateLimiter
        const { success } = await rateLimiter.limit({ key: `${user.id}:chat-send` })
        if (!success) {
          throw new ApiError(429, 'rate_limited', 'Aguarde antes de enviar outra mensagem.')
        }
        const message = await dependencies.chatRepository.sendChatMessage(
          user.id,
          channelId,
          await readChatMessage(request),
        )
        // Notification lookup is post-commit and optional. A provider/query
        // failure must not report the already inserted message as failed.
        const adminRecipient = await dependencies.chatRepository
          .getDirectChatAdminRecipient?.(user.id, channelId)
          .catch((error) => {
            console.error('Direct-chat admin lookup failed after message commit', {
              channelId,
              error: error instanceof Error ? error.message : 'unexpected_error',
            })
            return null
          })
        if (adminRecipient) {
          await safelyNotifyAdmin(dependencies.adminMobileNotifier, {
            eventKey: `chat:${message.id}:admin-direct`,
            type: 'chat_direct',
            title: 'Nova mensagem direta',
            occurredAt: message.created_at,
            details: [
              { label: 'De', value: message.display_name },
              { label: 'Mensagem', value: message.message.slice(0, 180) },
              { label: 'Conversa', value: channelId },
            ],
          })
        }
        return jsonResponse({ message }, 201)
      }

      const { before, pageSize } = readChatPagination(request.url)
      const rows = await dependencies.chatRepository.getChatMessages(
        user.id,
        channelId,
        before,
        pageSize,
      )
      const hasMore = rows.length > pageSize
      const messages = hasMore ? rows.slice(rows.length - pageSize) : rows
      return jsonResponse({
        messages,
        pagination: {
          has_more: hasMore,
          next_before: hasMore ? messages[0]?.created_at ?? null : null,
        },
      })
    }

    const reportMatch = /^\/v1\/chat\/messages\/([^/]+)\/report$/.exec(pathname)
    if (reportMatch) {
      if (!dependencies.chatRepository) {
        throw new ApiError(503, 'chat_unavailable', 'Chat indisponível.')
      }
      const messageId = requireUuid(decodePathSegment(reportMatch[1]), 'message id')
      const reportReason = await readChatReport(request)
      const report = await dependencies.chatRepository.reportChatMessage(
        user.id,
        messageId,
        reportReason,
      )
      await safelyNotifyAdmin(dependencies.adminMobileNotifier, {
        eventKey: `chat-report:${report.id}:created`,
        type: 'chat_report',
        title: 'Nova denúncia no chat',
        details: [
          { label: 'Motivo', value: reportReason },
          { label: 'Mensagem denunciada', value: messageId },
        ],
      })
      return jsonResponse({ report }, 201)
    }

    if (pathname === '/v1/payments/pix') {
      if (!dependencies.paymentService) {
        throw new ApiError(503, 'payments_unavailable', 'Pagamento indisponível.')
      }
      const rateLimiter = dependencies.paymentRateLimiter ?? dependencies.deviceRateLimiter
      const { success } = await rateLimiter.limit({ key: `${user.id}:payment-create` })
      if (!success) {
        throw new ApiError(429, 'rate_limited', 'Aguarde antes de criar outro pagamento.')
      }
      const { productCode } = await readPixInput(request)
      const checkout = await dependencies.paymentService.createPixPayment(
          user,
          productCode,
          readIdempotencyKey(request),
        )
      const payment = (checkout as { payment?: import('./types').PaymentRecord }).payment
      if (payment && dependencies.adminMobileNotifier) {
        const profile = dependencies.adminMobileNotifier.enabled === false
          ? null
          : await dependencies.repository.getProfile(user.id).catch(() => null)
        const customer = profile?.display_name?.trim()
          ? `${profile.display_name}${user.email ? ` · ${user.email}` : ''}`
          : user.email ?? user.id
        await safelyNotifyAdmin(dependencies.adminMobileNotifier, {
          eventKey: `payment:${payment.id}:attempt`,
          type: 'purchase_attempt',
          title: 'Nova tentativa de compra',
          occurredAt: payment.created_at,
          details: [
            { label: 'Cliente', value: customer },
            { label: 'Produto', value: payment.product_code },
            { label: 'Valor', value: `${payment.currency} ${payment.amount.toFixed(2)}` },
            { label: 'Pagamento', value: payment.id },
          ],
        })
      }
      return jsonResponse(checkout, 201)
    }

    const paymentMatch = /^\/v1\/payments\/([^/]+)$/.exec(pathname)
    if (paymentMatch) {
      if (!dependencies.paymentService) {
        throw new ApiError(503, 'payments_unavailable', 'Pagamento indisponível.')
      }
      const paymentId = requireUuid(decodePathSegment(paymentMatch[1]), 'payment id')
      const payment = await dependencies.paymentService.getPayment(user.id, paymentId)
      if (!payment) {
        throw new ApiError(404, 'payment_not_found', 'Pagamento não encontrado.')
      }
      return jsonResponse(payment)
    }

    if (pathname === '/v1/license/snapshot') {
      if (!dependencies.licenseSnapshotService) {
        throw new ApiError(503, 'license_snapshot_unavailable', 'Licença offline indisponível.')
      }
      return jsonResponse(await dependencies.licenseSnapshotService.createSnapshot(user.id))
    }

    if (pathname === '/v1/me') {
      const [profile, resolution, founderUpgradeEligible] = await Promise.all([
        dependencies.repository.getProfile(user.id),
        dependencies.entitlementService.resolveForUser(user.id),
        dependencies.repository.hasProLifetimeUpgradeEligibility(user.id),
      ])

      if (!profile) {
        throw new ApiError(500, 'profile_missing', 'Perfil do usuário indisponível.')
      }

      const body: MeResponse = {
        user,
        profile,
        license: resolution.license,
        founder_upgrade_eligible: founderUpgradeEligible,
        ...resolution.entitlements,
      }
      return jsonResponse(body)
    }

    if (pathname === '/v1/me/entitlements') {
      const resolution = await dependencies.entitlementService.resolveForUser(user.id)
      return jsonResponse(resolution.entitlements)
    }

    if (pathname === '/v1/devices') {
      const { page, pageSize } = readDevicePagination(request.url)
      const result = await dependencies.repository.getDevices(
        user.id,
        page,
        pageSize,
      )
      const body: DevicesResponse = {
        devices: result.devices,
        pagination: {
          page,
          page_size: pageSize,
          has_more: result.hasMore,
        },
      }
      return jsonResponse(body)
    }

    if (pathname === '/v1/devices/register') {
      const { success } = await dependencies.deviceRateLimiter.limit({
        key: `${user.id}:device-register`,
      })

      if (!success) {
        throw new ApiError(
          429,
          'rate_limited',
          'Muitas tentativas. Aguarde e tente novamente.',
        )
      }

      const input = await readRegisterDeviceInput(request)
      const device = await dependencies.repository.registerDevice(
        user.id,
        input,
        new Date().toISOString(),
      )
      const body: DeviceResponseEnvelope = { device }
      return jsonResponse(body, 200)
    }

    const revokeMatch = /^\/v1\/devices\/([^/]+)\/revoke$/.exec(pathname)

    if (revokeMatch) {
      const deviceId = requireUuid(decodePathSegment(revokeMatch[1]), 'device id')
      const { success } = await dependencies.deviceRateLimiter.limit({
        key: `${user.id}:device-revoke`,
      })

      if (!success) {
        throw new ApiError(
          429,
          'rate_limited',
          'Muitas tentativas. Aguarde e tente novamente.',
        )
      }

      const existing = await dependencies.repository.getDevice(user.id, deviceId)

      if (!existing) {
        throw new ApiError(404, 'device_not_found', 'Dispositivo não encontrado.')
      }

      if (existing.revoked_at) {
        throw new ApiError(409, 'device_already_revoked', 'Dispositivo já revogado.')
      }

      const device = await dependencies.repository.revokeDevice(
        user.id,
        deviceId,
        new Date().toISOString(),
      )

      if (!device) {
        throw new ApiError(409, 'conflict', 'O dispositivo foi alterado. Tente novamente.')
      }

      const body: DeviceResponseEnvelope = { device }
      return jsonResponse(body)
    }

    throw new ApiError(404, 'not_found', 'Endpoint não encontrado.')
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const origin = request.headers.get('origin')
      const corsOrigin = origin && allowedOrigins.has(origin) ? origin : null

      try {
        if (origin && !corsOrigin) {
          throw new ApiError(403, 'origin_not_allowed', 'Origem não permitida.')
        }

        return addCorsHeaders(await handle(request), corsOrigin)
      } catch (error) {
        return addCorsHeaders(apiErrorResponse(error), corsOrigin)
      }
    },
  }
}
