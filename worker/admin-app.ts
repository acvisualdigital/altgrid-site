import type {
  AdminActionResponse,
  AdminAnnouncementResponse,
  AdminAppAdRequestResponse,
  AdminAppAdRequestsResponse,
  AdminAppAdStatus,
  AdminAnnouncementsResponse,
  AdminAuditResponse,
  AdminConfigEntryResponse,
  AdminConfigResponse,
  AdminChatReportsResponse,
  AdminChatRestrictionResponse,
  AdminGameResponse,
  AdminGamesResponse,
  AdminProductResponse,
  AdminPublisherRequestResponse,
  AdminPublisherRequestsResponse,
  AdminPublisherRequestStatus,
  AdminProductsResponse,
  AdminPaymentLogsResponse,
  AdminReferralResponse,
  AdminReferralsResponse,
  AdminSessionResponse,
  AdminUserDetailResponse,
  AdminUsersResponse,
} from '../src/types/admin-api'
import {
  readAdminAnnouncementInput,
  readAdminAnnouncementUpdate,
  readAdminAppAdReview,
  readAdminChatReportPagination,
  readAdminChatReportStatus,
  readAdminChatRestriction,
  readAdminConfigValue,
  readAdminGameInput,
  readAdminGameUpdate,
  readAdminPagination,
  readAdminReferralReason,
  readAdminReferralSearch,
  readAdminProductUpdate,
  readAdminSearch,
  readGrantDays,
  readLifetimePlan,
  readSetPlan,
  requireAdminConfigKey,
} from './lib/admin-validation'
import { ApiError, jsonResponse } from './lib/api-error'
import { decodePathSegment, requireUuid } from './lib/validation'
import type { AdminRepository, PaymentService } from './types'

export function adminAllowedMethods(pathname: string): string[] | null {
  if (pathname === '/v1/admin/push-devices') return ['POST', 'DELETE']
  if (pathname === '/v1/admin/announcements') return ['GET', 'POST']
  if (pathname === '/v1/admin/chat/reports') return ['GET']
  if (pathname === '/v1/admin/chat/clear') return ['POST']
  if (pathname === '/v1/admin/referrals') return ['GET']
  if (pathname === '/v1/admin/publisher-requests') return ['GET']
  if (pathname === '/v1/admin/app-ads') return ['GET']

  if (
    pathname === '/v1/admin/session'
    || pathname === '/v1/admin/users'
    || pathname === '/v1/admin/games'
    || pathname === '/v1/admin/config'
    || pathname === '/v1/admin/products'
    || pathname === '/v1/admin/audit'
    || pathname === '/v1/admin/payments'
    || /^\/v1\/admin\/users\/[^/]+$/.test(pathname)
  ) return pathname === '/v1/admin/games' ? ['GET', 'POST'] : ['GET']

  if (
    /^\/v1\/admin\/users\/[^/]+\/(grant-days|plan|lifetime)$/.test(pathname)
    || /^\/v1\/admin\/licenses\/[^/]+\/revoke$/.test(pathname)
    || /^\/v1\/admin\/devices\/[^/]+\/(revoke|reset)$/.test(pathname)
    || /^\/v1\/admin\/chat\/reports\/[^/]+\/review$/.test(pathname)
    || /^\/v1\/admin\/chat\/users\/[^/]+\/restriction(\/clear)?$/.test(pathname)
    || /^\/v1\/admin\/chat\/messages\/[^/]+\/delete$/.test(pathname)
    || /^\/v1\/admin\/payments\/[^/]+\/reconcile$/.test(pathname)
    || /^\/v1\/admin\/referrals\/[^/]+\/(approve|reject)$/.test(pathname)
    || /^\/v1\/admin\/publisher-requests\/[^/]+\/review$/.test(pathname)
    || /^\/v1\/admin\/app-ads\/[^/]+\/review$/.test(pathname)
  ) return ['POST']

  if (
    /^\/v1\/admin\/games\/[^/]+$/.test(pathname)
    || /^\/v1\/admin\/config\/[^/]+$/.test(pathname)
    || /^\/v1\/admin\/products\/[^/]+$/.test(pathname)
  ) return ['PATCH']

  if (/^\/v1\/admin\/announcements\/[^/]+$/.test(pathname)) {
    return ['PATCH', 'DELETE']
  }

  return null
}

function pagination(page: number, pageSize: number, total: number) {
  return {
    page,
    page_size: pageSize,
    total,
    has_more: page * pageSize < total,
  }
}

function routeId(match: RegExpMatchArray, label: string): string {
  return requireUuid(decodePathSegment(match[1]), label)
}

export async function handleAdminRequest(
  request: Request,
  pathname: string,
  actorUserId: string,
  repository: AdminRepository,
  paymentService?: PaymentService,
): Promise<Response> {
  if (pathname === '/v1/admin/push-devices') {
    let body: { platform?: unknown; token?: unknown }
    try {
      body = await request.json() as { platform?: unknown; token?: unknown }
    } catch {
      throw new ApiError(400, 'invalid_json', 'Corpo da solicitação inválido.')
    }
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    if (token.length < 20 || token.length > 4096) {
      throw new ApiError(400, 'invalid_push_token', 'Token de notificação inválido.')
    }
    if (body.platform !== 'android') {
      throw new ApiError(400, 'invalid_push_platform', 'Plataforma de notificação inválida.')
    }
    if (request.method === 'DELETE') {
      await repository.unregisterAdminPushDevice(actorUserId, token)
    } else {
      await repository.registerAdminPushDevice(actorUserId, token, 'android')
    }
    return jsonResponse({ ok: true } satisfies AdminActionResponse)
  }

  if (pathname === '/v1/admin/session') {
    const body: AdminSessionResponse = {
      admin: { user_id: actorUserId, role: 'admin' },
    }
    return jsonResponse(body)
  }

  if (pathname === '/v1/admin/users') {
    const { query, page, pageSize } = readAdminSearch(request.url)
    const result = await repository.searchAdminUsers(actorUserId, query, page, pageSize)
    const body: AdminUsersResponse = {
      users: result.users,
      pagination: pagination(page, pageSize, result.total),
    }
    return jsonResponse(body)
  }

  if (pathname === '/v1/admin/referrals') {
    const { status, query, page, pageSize } = readAdminReferralSearch(request.url)
    const result = await repository.getAdminReferrals(
      actorUserId,
      status,
      query,
      page,
      pageSize,
    )
    return jsonResponse({
      referrals: result.referrals,
      stats: result.stats,
      pagination: pagination(page, pageSize, result.total),
    } satisfies AdminReferralsResponse)
  }

  const referralActionMatch = /^\/v1\/admin\/referrals\/([^/]+)\/(approve|reject)$/.exec(pathname)
  if (referralActionMatch) {
    const referralId = routeId(referralActionMatch, 'referral id')
    const reason = await readAdminReferralReason(request)
    const referral = referralActionMatch[2] === 'approve'
      ? await repository.adminApproveReferral(actorUserId, referralId, reason)
      : await repository.adminRejectReferral(actorUserId, referralId, reason)
    return jsonResponse({ referral } satisfies AdminReferralResponse)
  }

  const userDetailMatch = /^\/v1\/admin\/users\/([^/]+)$/.exec(pathname)
  if (userDetailMatch) {
    const userId = routeId(userDetailMatch, 'user id')
    const user = await repository.getAdminUser(actorUserId, userId)
    if (!user) throw new ApiError(404, 'user_not_found', 'Usuário não encontrado.')
    const body: AdminUserDetailResponse = { user }
    return jsonResponse(body)
  }

  const userActionMatch =
    /^\/v1\/admin\/users\/([^/]+)\/(grant-days|plan|lifetime)$/.exec(pathname)
  if (userActionMatch) {
    const targetUserId = routeId(userActionMatch, 'user id')
    if (userActionMatch[2] === 'grant-days') {
      await repository.adminGrantProDays(
        actorUserId,
        targetUserId,
        await readGrantDays(request),
      )
    } else if (userActionMatch[2] === 'plan') {
      const input = await readSetPlan(request)
      await repository.adminSetPlan(
        actorUserId,
        targetUserId,
        input.plan,
        input.expires_at,
        input.founder_number,
      )
    } else {
      const input = await readLifetimePlan(request)
      await repository.adminActivateLifetime(
        actorUserId,
        targetUserId,
        input.plan,
        input.founder_number,
      )
    }
    const body: AdminActionResponse = { ok: true }
    return jsonResponse(body)
  }

  const licenseMatch = /^\/v1\/admin\/licenses\/([^/]+)\/revoke$/.exec(pathname)
  if (licenseMatch) {
    await repository.adminRevokeLicense(actorUserId, routeId(licenseMatch, 'license id'))
    return jsonResponse({ ok: true } satisfies AdminActionResponse)
  }

  const deviceMatch = /^\/v1\/admin\/devices\/([^/]+)\/(revoke|reset)$/.exec(pathname)
  if (deviceMatch) {
    const deviceId = routeId(deviceMatch, 'device id')
    if (deviceMatch[2] === 'revoke') {
      await repository.adminRevokeDevice(actorUserId, deviceId)
    } else {
      await repository.adminResetDevice(actorUserId, deviceId)
    }
    return jsonResponse({ ok: true } satisfies AdminActionResponse)
  }

  if (pathname === '/v1/admin/games') {
    if (request.method === 'GET') {
      return jsonResponse({ games: await repository.getAdminGames() } satisfies AdminGamesResponse)
    }
    const game = await repository.createAdminGame(actorUserId, await readAdminGameInput(request))
    return jsonResponse({ game } satisfies AdminGameResponse, 201)
  }

  if (pathname === '/v1/admin/publisher-requests') {
    const rawStatus = new URL(request.url).searchParams.get('status')
    const allowed: AdminPublisherRequestStatus[] = ['pending', 'reviewing', 'approved', 'rejected', 'cancelled']
    if (rawStatus && !allowed.includes(rawStatus as AdminPublisherRequestStatus)) {
      throw new ApiError(400, 'invalid_publisher_status', 'Status de solicitação inválido.')
    }
    const requests = await repository.getAdminPublisherRequests(
      actorUserId,
      rawStatus as AdminPublisherRequestStatus | null,
    )
    return jsonResponse({ requests } satisfies AdminPublisherRequestsResponse)
  }

  const publisherReviewMatch = /^\/v1\/admin\/publisher-requests\/([^/]+)\/review$/.exec(pathname)
  if (publisherReviewMatch) {
    const requestId = routeId(publisherReviewMatch, 'publisher request id')
    let body: { status?: unknown; notes?: unknown }
    try { body = await request.json() as { status?: unknown; notes?: unknown } } catch {
      throw new ApiError(400, 'invalid_json', 'Corpo da solicitação inválido.')
    }
    if (!['reviewing', 'approved', 'rejected'].includes(String(body.status))) {
      throw new ApiError(400, 'invalid_publisher_review', 'Escolha revisar, aprovar ou recusar.')
    }
    const notes = body.notes === undefined || body.notes === null ? null : String(body.notes).trim()
    if (notes && notes.length > 2000) {
      throw new ApiError(400, 'publisher_notes_too_long', 'As observações devem ter até 2.000 caracteres.')
    }
    const reviewed = await repository.reviewAdminPublisherRequest(
      actorUserId,
      requestId,
      String(body.status) as 'reviewing' | 'approved' | 'rejected',
      notes,
    )
    return jsonResponse({ request: reviewed } satisfies AdminPublisherRequestResponse)
  }

  if (pathname === '/v1/admin/app-ads') {
    const rawStatus = new URL(request.url).searchParams.get('status')
    const allowed: AdminAppAdStatus[] = ['pending', 'reviewing', 'payment_pending', 'approved', 'rejected', 'cancelled']
    if (rawStatus && !allowed.includes(rawStatus as AdminAppAdStatus)) {
      throw new ApiError(400, 'invalid_advertising_status', 'Status de anúncio inválido.')
    }
    const requests = await repository.getAdminAppAdRequests(
      actorUserId,
      rawStatus as AdminAppAdStatus | null,
    )
    return jsonResponse({ requests } satisfies AdminAppAdRequestsResponse)
  }

  const appAdReviewMatch = /^\/v1\/admin\/app-ads\/([^/]+)\/review$/.exec(pathname)
  if (appAdReviewMatch) {
    const requestId = routeId(appAdReviewMatch, 'advertising request id')
    const input = await readAdminAppAdReview(request)
    const reviewed = await repository.reviewAdminAppAdRequest(
      actorUserId,
      requestId,
      input.status,
      input.notes ?? null,
    )
    return jsonResponse({ request: reviewed } satisfies AdminAppAdRequestResponse)
  }

  const gameMatch = /^\/v1\/admin\/games\/([^/]+)$/.exec(pathname)
  if (gameMatch) {
    const gameId = routeId(gameMatch, 'game id')
    const game = await repository.updateAdminGame(
      actorUserId,
      gameId,
      await readAdminGameUpdate(request),
    )
    if (!game) throw new ApiError(404, 'game_not_found', 'Jogo não encontrado.')
    return jsonResponse({ game } satisfies AdminGameResponse)
  }

  if (pathname === '/v1/admin/config') {
    const body: AdminConfigResponse = { config: await repository.getAdminConfig() }
    return jsonResponse(body)
  }

  const configMatch = /^\/v1\/admin\/config\/([^/]+)$/.exec(pathname)
  if (configMatch) {
    const key = requireAdminConfigKey(decodePathSegment(configMatch[1]))
    const config = await repository.updateAdminConfig(
      actorUserId,
      key,
      await readAdminConfigValue(request, key),
    )
    if (!config) throw new ApiError(404, 'config_not_found', 'Configuração não encontrada.')
    return jsonResponse({ config } satisfies AdminConfigEntryResponse)
  }

  if (pathname === '/v1/admin/products') {
    const body: AdminProductsResponse = { products: await repository.getAdminProducts() }
    return jsonResponse(body)
  }

  if (pathname === '/v1/admin/announcements') {
    if (request.method === 'GET') {
      return jsonResponse({
        announcements: await repository.getAdminAnnouncements(),
      } satisfies AdminAnnouncementsResponse)
    }
    const announcement = await repository.createAdminAnnouncement(
      actorUserId,
      await readAdminAnnouncementInput(request),
    )
    return jsonResponse({ announcement } satisfies AdminAnnouncementResponse, 201)
  }

  const announcementMatch = /^\/v1\/admin\/announcements\/([^/]+)$/.exec(pathname)
  if (announcementMatch) {
    const announcementId = routeId(announcementMatch, 'announcement id')
    if (request.method === 'DELETE') {
      await repository.deleteAdminAnnouncement(actorUserId, announcementId)
      return jsonResponse({ ok: true } satisfies AdminActionResponse)
    }
    const announcement = await repository.updateAdminAnnouncement(
      actorUserId,
      announcementId,
      await readAdminAnnouncementUpdate(request),
    )
    if (!announcement) {
      throw new ApiError(404, 'announcement_not_found', 'Aviso não encontrado.')
    }
    return jsonResponse({ announcement } satisfies AdminAnnouncementResponse)
  }

  if (pathname === '/v1/admin/chat/reports') {
    const { status, page, pageSize } = readAdminChatReportPagination(request.url)
    const result = await repository.getAdminChatReports(status, page, pageSize)
    return jsonResponse({
      reports: result.reports,
      pagination: pagination(page, pageSize, result.total),
    } satisfies AdminChatReportsResponse)
  }

  const chatReportMatch = /^\/v1\/admin\/chat\/reports\/([^/]+)\/review$/.exec(pathname)
  if (chatReportMatch) {
    await repository.reviewAdminChatReport(
      actorUserId,
      routeId(chatReportMatch, 'report id'),
      await readAdminChatReportStatus(request),
    )
    return jsonResponse({ ok: true } satisfies AdminActionResponse)
  }

  const chatRestrictionMatch =
    /^\/v1\/admin\/chat\/users\/([^/]+)\/restriction(\/clear)?$/.exec(pathname)
  if (chatRestrictionMatch) {
    const targetUserId = routeId(chatRestrictionMatch, 'user id')
    if (chatRestrictionMatch[2]) {
      await repository.clearAdminChatRestriction(actorUserId, targetUserId)
      return jsonResponse({ ok: true } satisfies AdminActionResponse)
    }
    const restriction = await repository.setAdminChatRestriction(
      actorUserId,
      targetUserId,
      await readAdminChatRestriction(request),
    )
    return jsonResponse({ restriction } satisfies AdminChatRestrictionResponse)
  }

  const chatMessageMatch = /^\/v1\/admin\/chat\/messages\/([^/]+)\/delete$/.exec(pathname)
  if (chatMessageMatch) {
    await repository.deleteAdminChatMessage(
      actorUserId,
      routeId(chatMessageMatch, 'message id'),
    )
    return jsonResponse({ ok: true } satisfies AdminActionResponse)
  }

  if (pathname === '/v1/admin/chat/clear') {
    if (!repository.clearAdminChat) {
      throw new ApiError(503, 'chat_unavailable', 'Limpeza do chat indisponível.')
    }
    await repository.clearAdminChat(actorUserId)
    return jsonResponse({ ok: true } satisfies AdminActionResponse)
  }

  const productMatch = /^\/v1\/admin\/products\/([^/]+)$/.exec(pathname)
  if (productMatch) {
    const productId = routeId(productMatch, 'product id')
    const product = await repository.updateAdminProduct(
      actorUserId,
      productId,
      await readAdminProductUpdate(request),
    )
    if (!product) throw new ApiError(404, 'product_not_found', 'Produto não encontrado.')
    return jsonResponse({ product } satisfies AdminProductResponse)
  }

  if (pathname === '/v1/admin/audit') {
    const { page, pageSize } = readAdminPagination(request.url)
    const result = await repository.getAdminAudit(page, pageSize)
    const body: AdminAuditResponse = {
      entries: result.entries,
      pagination: pagination(page, pageSize, result.total),
    }
    return jsonResponse(body)
  }

  if (pathname === '/v1/admin/payments') {
    const { page, pageSize } = readAdminPagination(request.url)
    const result = await repository.getAdminPaymentLogs(page, pageSize)
    const body: AdminPaymentLogsResponse = {
      payments: result.payments,
      pagination: pagination(page, pageSize, result.total),
    }
    return jsonResponse(body)
  }

  const paymentReconcileMatch = /^\/v1\/admin\/payments\/([^/]+)\/reconcile$/.exec(pathname)
  if (paymentReconcileMatch) {
    if (!paymentService) {
      throw new ApiError(503, 'payments_unavailable', 'Pagamento indisponível.')
    }
    const paymentId = routeId(paymentReconcileMatch, 'payment id')
    const result = await paymentService.reconcilePayment(paymentId)
    if (!result) {
      throw new ApiError(404, 'payment_not_found', 'Pagamento não encontrado.')
    }
    return jsonResponse(result)
  }

  throw new ApiError(404, 'not_found', 'Endpoint não encontrado.')
}
