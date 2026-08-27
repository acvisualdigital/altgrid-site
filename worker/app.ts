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
  readIdempotencyKey,
  readPixInput,
} from './lib/platform-validation'
import { EntitlementService } from './services/entitlement-service'
import type {
  AuthenticationService,
  AdminRepository,
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
}

interface ApiOptions {
  allowedOrigins?: readonly string[]
}

function normalizedPath(url: string): string {
  const pathname = new URL(url).pathname
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

function allowedMethods(pathname: string): string[] | null {
  const adminMethods = adminAllowedMethods(pathname)
  if (adminMethods) return adminMethods

  if (
    pathname === '/health'
    || pathname === '/v1/me'
    || pathname === '/v1/me/entitlements'
    || pathname === '/v1/games'
    || pathname === '/v1/config/public'
    || pathname === '/v1/app/config'
    || pathname === '/v1/app/metrics'
    || pathname === '/v1/app/announcements'
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
  ) {
    return ['POST']
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
      await dependencies.paymentService.handleWebhook(request)
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
      await dependencies.repository.heartbeatPresence(user.id)
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
      )
    }

    if (pathname === '/v1/chat/channels') {
      if (!dependencies.chatRepository) {
        throw new ApiError(503, 'chat_unavailable', 'Chat indisponível.')
      }
      return jsonResponse({ channels: await dependencies.chatRepository.getChatChannels() })
    }

    if (pathname === '/v1/chat/status') {
      if (!dependencies.chatRepository) {
        throw new ApiError(503, 'chat_unavailable', 'Chat indisponível.')
      }
      return jsonResponse({ status: await dependencies.chatRepository.getChatStatus(user.id) })
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
      const report = await dependencies.chatRepository.reportChatMessage(
        user.id,
        messageId,
        await readChatReport(request),
      )
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
      return jsonResponse(
        await dependencies.paymentService.createPixPayment(
          user,
          productCode,
          readIdempotencyKey(request),
        ),
        201,
      )
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
