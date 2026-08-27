import type { Session } from '@supabase/supabase-js'

import {
  AuthService,
  AuthServiceError,
} from './auth-service'
import type {
  AppMetricsResponse,
  ChatChannelsResponse,
  ChatMessageResponse,
  ChatMessagesResponse,
  ChatReportResponse,
  ChatStatusResponse,
  DeviceResponseEnvelope,
  DevicesResponse,
  HealthResponse,
  LicenseSnapshotResponse,
  MeResponse,
  PixPaymentResponse,
  PresenceHeartbeatResponse,
  PublicAnnouncementsResponse,
  PublicConfigResponse,
  PublicGamesResponse,
  PublicProductsResponse,
  RegisterDeviceInput,
  ResolvedEntitlements,
  UpdateProfileInput,
} from '../types/backend-api'
import type {
  AdminActionResponse,
  AdminAnnouncementInput,
  AdminAnnouncementResponse,
  AdminAnnouncementsResponse,
  AdminAnnouncementUpdate,
  AdminAuditResponse,
  AdminChatReportStatus,
  AdminChatReportsResponse,
  AdminChatRestrictionInput,
  AdminChatRestrictionResponse,
  AdminConfigEntryResponse,
  AdminConfigResponse,
  AdminGameInput,
  AdminGameResponse,
  AdminGamesResponse,
  AdminGameUpdate,
  AdminLifetimeInput,
  AdminProductResponse,
  AdminProductsResponse,
  AdminProductUpdate,
  AdminPaymentLogsResponse,
  AdminSessionResponse,
  AdminSetPlanInput,
  AdminUserDetailResponse,
  AdminUsersResponse,
} from '../types/admin-api'
import type { Json } from '../types/database'

const DEFAULT_TIMEOUT_MS = 8_000

export class BackendApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'BackendApiError'
  }
}

export interface BackendApiOptions {
  baseUrl: string
  authService: AuthService
  fetch?: typeof fetch
  timeoutMs?: number
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error('Missing required public environment variable: API_BASE_URL')
  }

  const url = new URL(trimmed)
  const isLocal = ['127.0.0.1', 'localhost'].includes(url.hostname)

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API_BASE_URL must not contain credentials, query, or fragment')
  }

  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('API_BASE_URL must use HTTPS outside localhost')
  }

  return trimmed.replace(/\/+$/, '')
}

function backendErrorFromAuth(
  error: unknown,
  afterUnauthorizedResponse = false,
): BackendApiError {
  if (error instanceof BackendApiError) {
    return error
  }

  if (!(error instanceof AuthServiceError)) {
    return new BackendApiError(
      'authentication_failed',
      'Não foi possível validar sua sessão.',
      0,
    )
  }

  if (
    afterUnauthorizedResponse
    && ['email_not_confirmed', 'invalid_credentials'].includes(error.code)
  ) {
    return new BackendApiError(
      'authentication_required',
      'Sua sessão expirou. Entre novamente.',
      401,
    )
  }

  const status = error.code === 'rate_limited' ? 429 : 0
  return new BackendApiError(error.code, error.message, status)
}

function isApiErrorPayload(
  payload: unknown,
): payload is { error: { code?: string; message?: string } } {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    return false
  }

  const error = (payload as { error?: unknown }).error
  return Boolean(error && typeof error === 'object')
}

export class BackendApi {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number
  private readonly readsInFlight = new Map<string, Promise<unknown>>()

  constructor(private readonly options: BackendApiOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.fetcher = (options.fetch ?? globalThis.fetch).bind(globalThis)
    this.timeoutMs = Math.max(250, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  }

  getMe(): Promise<MeResponse> {
    return this.privateRead<MeResponse>('/v1/me')
  }

  updateProfile(input: UpdateProfileInput): Promise<{ profile: MeResponse['profile'] }> {
    return this.privateRequest<{ profile: MeResponse['profile'] }>('/v1/me/profile', {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    })
  }

  getEntitlements(): Promise<ResolvedEntitlements> {
    return this.privateRead<ResolvedEntitlements>('/v1/me/entitlements')
  }

  getLicenseSnapshot(): Promise<LicenseSnapshotResponse> {
    return this.privateRead<LicenseSnapshotResponse>('/v1/license/snapshot')
  }

  getGames(): Promise<PublicGamesResponse> {
    return this.deduplicate('public:/v1/games', () =>
      this.publicRequest<PublicGamesResponse>('/v1/games'))
  }

  getHealth(): Promise<HealthResponse> {
    return this.deduplicate('public:/health', () =>
      this.publicRequest<HealthResponse>('/health'))
  }

  getAppConfig(): Promise<PublicConfigResponse> {
    return this.deduplicate('public:/v1/app/config', () =>
      this.publicRequest<PublicConfigResponse>('/v1/app/config'))
  }

  getAppMetrics(): Promise<AppMetricsResponse> {
    return this.deduplicate('public:/v1/app/metrics', () =>
      this.publicRequest<AppMetricsResponse>('/v1/app/metrics'))
  }

  sendPresenceHeartbeat(): Promise<PresenceHeartbeatResponse> {
    return this.privateRequest<PresenceHeartbeatResponse>(
      '/v1/presence/heartbeat',
      { method: 'POST' },
    )
  }

  getAnnouncements(): Promise<PublicAnnouncementsResponse> {
    return this.deduplicate('public:/v1/app/announcements', () =>
      this.publicRequest<PublicAnnouncementsResponse>('/v1/app/announcements'))
  }

  getProducts(): Promise<PublicProductsResponse> {
    return this.deduplicate('public:/v1/products', () =>
      this.publicRequest<PublicProductsResponse>('/v1/products'))
  }

  getChatChannels(): Promise<ChatChannelsResponse> {
    return this.privateRead<ChatChannelsResponse>('/v1/chat/channels')
  }

  getChatMessages(
    channelId: string,
    options: { before?: string; pageSize?: number } = {},
  ): Promise<ChatMessagesResponse> {
    const query = new URLSearchParams({
      page_size: String(options.pageSize ?? 50),
    })

    if (options.before) {
      query.set('before', options.before)
    }

    return this.privateRead<ChatMessagesResponse>(
      '/v1/chat/channels/' + encodeURIComponent(channelId)
        + '/messages?' + query,
    )
  }

  sendChatMessage(channelId: string, message: string): Promise<ChatMessageResponse> {
    return this.privateRequest<ChatMessageResponse>(
      '/v1/chat/channels/' + encodeURIComponent(channelId) + '/messages',
      {
        body: JSON.stringify({ message }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    )
  }

  reportChatMessage(messageId: string, reason: string): Promise<ChatReportResponse> {
    return this.privateRequest<ChatReportResponse>(
      '/v1/chat/messages/' + encodeURIComponent(messageId) + '/report',
      {
        body: JSON.stringify({ reason }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    )
  }

  getChatStatus(): Promise<ChatStatusResponse> {
    return this.privateRead<ChatStatusResponse>('/v1/chat/status')
  }

  createPixPayment(productCode: string): Promise<PixPaymentResponse> {
    return this.privateRequest<PixPaymentResponse>('/v1/payments/pix', {
      body: JSON.stringify({ product_code: productCode }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
  }

  getPayment(paymentId: string): Promise<PixPaymentResponse> {
    return this.privateRead<PixPaymentResponse>(
      '/v1/payments/' + encodeURIComponent(paymentId),
    )
  }

  getPublicConfig(): Promise<PublicConfigResponse> {
    return this.deduplicate('public:/v1/config/public', () =>
      this.publicRequest<PublicConfigResponse>('/v1/config/public'))
  }

  getDevices(page = 1, pageSize = 50): Promise<DevicesResponse> {
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })
    return this.privateRead<DevicesResponse>('/v1/devices?' + query)
  }

  registerDevice(input: RegisterDeviceInput): Promise<DeviceResponseEnvelope> {
    return this.privateRequest<DeviceResponseEnvelope>('/v1/devices/register', {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
  }

  revokeDevice(deviceId: string): Promise<DeviceResponseEnvelope> {
    return this.privateRequest<DeviceResponseEnvelope>(
      '/v1/devices/' + encodeURIComponent(deviceId) + '/revoke',
      { method: 'POST' },
    )
  }

  getAdminSession(): Promise<AdminSessionResponse> {
    return this.privateRead<AdminSessionResponse>('/v1/admin/session')
  }

  searchAdminUsers(
    query = '',
    page = 1,
    pageSize = 50,
  ): Promise<AdminUsersResponse> {
    const search = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })

    if (query.trim()) {
      search.set('q', query.trim())
    }

    return this.privateRead<AdminUsersResponse>(
      '/v1/admin/users?' + search.toString(),
    )
  }

  getAdminUser(userId: string): Promise<AdminUserDetailResponse> {
    return this.privateRead<AdminUserDetailResponse>(
      '/v1/admin/users/' + encodeURIComponent(userId),
    )
  }

  grantAdminProDays(
    userId: string,
    days: number,
  ): Promise<AdminActionResponse> {
    return this.adminJsonMutation<AdminActionResponse>(
      '/v1/admin/users/' + encodeURIComponent(userId) + '/grant-days',
      'POST',
      { days },
    )
  }

  setAdminPlan(
    userId: string,
    input: AdminSetPlanInput,
  ): Promise<AdminActionResponse> {
    return this.adminJsonMutation<AdminActionResponse>(
      '/v1/admin/users/' + encodeURIComponent(userId) + '/plan',
      'POST',
      input,
    )
  }

  activateAdminLifetime(
    userId: string,
    input: AdminLifetimeInput,
  ): Promise<AdminActionResponse> {
    return this.adminJsonMutation<AdminActionResponse>(
      '/v1/admin/users/' + encodeURIComponent(userId) + '/lifetime',
      'POST',
      input,
    )
  }

  revokeAdminLicense(licenseId: string): Promise<AdminActionResponse> {
    return this.adminJsonMutation<AdminActionResponse>(
      '/v1/admin/licenses/' + encodeURIComponent(licenseId) + '/revoke',
      'POST',
      {},
    )
  }

  revokeAdminDevice(deviceId: string): Promise<AdminActionResponse> {
    return this.adminJsonMutation<AdminActionResponse>(
      '/v1/admin/devices/' + encodeURIComponent(deviceId) + '/revoke',
      'POST',
      {},
    )
  }

  resetAdminDevice(deviceId: string): Promise<AdminActionResponse> {
    return this.adminJsonMutation<AdminActionResponse>(
      '/v1/admin/devices/' + encodeURIComponent(deviceId) + '/reset',
      'POST',
      {},
    )
  }

  getAdminGames(): Promise<AdminGamesResponse> {
    return this.privateRead<AdminGamesResponse>('/v1/admin/games')
  }

  createAdminGame(input: AdminGameInput): Promise<AdminGameResponse> {
    return this.adminJsonMutation<AdminGameResponse>(
      '/v1/admin/games',
      'POST',
      input,
    )
  }

  updateAdminGame(
    gameId: string,
    input: AdminGameUpdate,
  ): Promise<AdminGameResponse> {
    return this.adminJsonMutation<AdminGameResponse>(
      '/v1/admin/games/' + encodeURIComponent(gameId),
      'PATCH',
      input,
    )
  }

  getAdminConfig(): Promise<AdminConfigResponse> {
    return this.privateRead<AdminConfigResponse>('/v1/admin/config')
  }

  updateAdminConfig(
    key: string,
    value: Json,
  ): Promise<AdminConfigEntryResponse> {
    return this.adminJsonMutation<AdminConfigEntryResponse>(
      '/v1/admin/config/' + encodeURIComponent(key),
      'PATCH',
      { value },
    )
  }

  getAdminProducts(): Promise<AdminProductsResponse> {
    return this.privateRead<AdminProductsResponse>('/v1/admin/products')
  }

  getAdminPaymentLogs(page = 1, pageSize = 50): Promise<AdminPaymentLogsResponse> {
    return this.privateRead<AdminPaymentLogsResponse>(
      `/v1/admin/payments?page=${page}&page_size=${pageSize}`,
    )
  }

  updateAdminProduct(
    productId: string,
    input: AdminProductUpdate,
  ): Promise<AdminProductResponse> {
    return this.adminJsonMutation<AdminProductResponse>(
      '/v1/admin/products/' + encodeURIComponent(productId),
      'PATCH',
      input,
    )
  }

  getAdminAnnouncements(): Promise<AdminAnnouncementsResponse> {
    return this.privateRead<AdminAnnouncementsResponse>(
      '/v1/admin/announcements',
    )
  }

  createAdminAnnouncement(
    input: AdminAnnouncementInput,
  ): Promise<AdminAnnouncementResponse> {
    return this.adminJsonMutation<AdminAnnouncementResponse>(
      '/v1/admin/announcements',
      'POST',
      input,
    )
  }

  updateAdminAnnouncement(
    announcementId: string,
    input: AdminAnnouncementUpdate,
  ): Promise<AdminAnnouncementResponse> {
    return this.adminJsonMutation<AdminAnnouncementResponse>(
      '/v1/admin/announcements/' + encodeURIComponent(announcementId),
      'PATCH',
      input,
    )
  }

  deleteAdminAnnouncement(
    announcementId: string,
  ): Promise<AdminActionResponse> {
    return this.privateRequest<AdminActionResponse>(
      '/v1/admin/announcements/' + encodeURIComponent(announcementId),
      { method: 'DELETE' },
    )
  }

  getAdminChatReports(
    status: AdminChatReportStatus | null = null,
    page = 1,
    pageSize = 50,
  ): Promise<AdminChatReportsResponse> {
    const search = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })

    if (status) {
      search.set('status', status)
    }

    return this.privateRead<AdminChatReportsResponse>(
      '/v1/admin/chat/reports?' + search.toString(),
    )
  }

  reviewAdminChatReport(
    reportId: string,
    status: Exclude<AdminChatReportStatus, 'pending'>,
  ): Promise<AdminActionResponse> {
    return this.adminJsonMutation<AdminActionResponse>(
      '/v1/admin/chat/reports/' + encodeURIComponent(reportId) + '/review',
      'POST',
      { status },
    )
  }

  setAdminChatRestriction(
    userId: string,
    input: AdminChatRestrictionInput,
  ): Promise<AdminChatRestrictionResponse> {
    return this.adminJsonMutation<AdminChatRestrictionResponse>(
      '/v1/admin/chat/users/' + encodeURIComponent(userId) + '/restriction',
      'POST',
      input,
    )
  }

  clearAdminChatRestriction(userId: string): Promise<AdminActionResponse> {
    return this.adminJsonMutation<AdminActionResponse>(
      '/v1/admin/chat/users/' + encodeURIComponent(userId) + '/restriction/clear',
      'POST',
      {},
    )
  }

  deleteAdminChatMessage(messageId: string): Promise<AdminActionResponse> {
    return this.adminJsonMutation<AdminActionResponse>(
      '/v1/admin/chat/messages/' + encodeURIComponent(messageId) + '/delete',
      'POST',
      {},
    )
  }

  clearAdminChat(): Promise<AdminActionResponse> {
    return this.adminJsonMutation<AdminActionResponse>('/v1/admin/chat/clear', 'POST', {})
  }

  getAdminAudit(page = 1, pageSize = 50): Promise<AdminAuditResponse> {
    const search = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })
    return this.privateRead<AdminAuditResponse>(
      '/v1/admin/audit?' + search.toString(),
    )
  }

  private adminJsonMutation<ResponseBody>(
    path: string,
    method: 'PATCH' | 'POST',
    body: unknown,
  ): Promise<ResponseBody> {
    return this.privateRequest<ResponseBody>(path, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method,
    })
  }

  private async privateRead<ResponseBody>(
    path: string,
  ): Promise<ResponseBody> {
    const session = await this.getSessionOrThrow()
    const key = 'private:' + session.user.id + ':' + path

    return this.deduplicate(key, () =>
      this.requestWithSession<ResponseBody>(path, {}, session))
  }

  private async privateRequest<ResponseBody>(
    path: string,
    init: RequestInit = {},
  ): Promise<ResponseBody> {
    const session = await this.getSessionOrThrow()
    return this.requestWithSession<ResponseBody>(path, init, session)
  }

  private async requestWithSession<ResponseBody>(
    path: string,
    init: RequestInit,
    session: Session,
  ): Promise<ResponseBody> {
    try {
      return await this.authenticatedRequest<ResponseBody>(path, init, session)
    } catch (error) {
      if (!(error instanceof BackendApiError) || error.status !== 401) {
        throw error
      }
    }

    let refreshed: Session | null

    try {
      refreshed = await this.withTimeout(
        this.options.authService.refreshSession(),
      )
    } catch (error) {
      throw backendErrorFromAuth(error, true)
    }

    if (!refreshed) {
      throw new BackendApiError(
        'authentication_required',
        'Entre novamente para continuar.',
        401,
      )
    }

    return this.authenticatedRequest<ResponseBody>(path, init, refreshed)
  }

  private authenticatedRequest<ResponseBody>(
    path: string,
    init: RequestInit,
    session: Session,
  ): Promise<ResponseBody> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', 'Bearer ' + session.access_token)

    return this.request<ResponseBody>(path, { ...init, headers })
  }

  private publicRequest<ResponseBody>(
    path: string,
    init: RequestInit = {},
  ): Promise<ResponseBody> {
    return this.request<ResponseBody>(path, init)
  }

  private async getSessionOrThrow(): Promise<Session> {
    let session: Session | null

    try {
      session = await this.withTimeout(this.options.authService.getSession())
    } catch (error) {
      throw backendErrorFromAuth(error)
    }

    if (!session) {
      throw new BackendApiError(
        'authentication_required',
        'Entre novamente para continuar.',
        401,
      )
    }

    return session
  }

  private async request<ResponseBody>(
    path: string,
    init: RequestInit,
  ): Promise<ResponseBody> {
    const controller = new AbortController()
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    let timedOut = false
    const abortFromCaller = (): void => controller.abort(init.signal?.reason)

    if (init.signal?.aborted) {
      throw new BackendApiError(
        'request_cancelled',
        'A operação foi cancelada.',
        0,
      )
    }

    init.signal?.addEventListener('abort', abortFromCaller, { once: true })

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(new BackendApiError(
          'request_timeout',
          'O serviço demorou para responder. Tente novamente.',
          0,
        ))
      }, this.timeoutMs)
    })

    let response: Response
    let text: string

    try {
      const result = await Promise.race([
        this.fetcher(this.baseUrl + path, {
            ...init,
            headers,
            signal: controller.signal,
          })
          .then(async (nextResponse) => ({
            response: nextResponse,
            text: await nextResponse.text(),
          })),
        timeout,
      ])
      response = result.response
      text = result.text
    } catch (error) {
      if (error instanceof BackendApiError) {
        throw error
      }

      if (timedOut) {
        throw new BackendApiError(
          'request_timeout',
          'O serviço demorou para responder. Tente novamente.',
          0,
        )
      }

      if (init.signal?.aborted) {
        throw new BackendApiError(
          'request_cancelled',
          'A operação foi cancelada.',
          0,
        )
      }

      const offline = typeof navigator !== 'undefined' && !navigator.onLine
      throw new BackendApiError(
        offline ? 'offline' : 'connection_failed',
        offline
          ? 'Sem conexão. Suas contas continuam salvas.'
          : 'Não foi possível conectar ao serviço.',
        0,
      )
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
      init.signal?.removeEventListener('abort', abortFromCaller)
    }

    let payload: unknown = null

    if (text) {
      try {
        payload = JSON.parse(text) as unknown
      } catch {
        if (response.ok) {
          throw new BackendApiError(
            'invalid_response',
            'O serviço enviou uma resposta inválida.',
            502,
          )
        }
      }
    }

    if (!response.ok) {
      const apiError = isApiErrorPayload(payload) ? payload.error : null
      throw new BackendApiError(
        typeof apiError?.code === 'string' ? apiError.code : 'request_failed',
        typeof apiError?.message === 'string'
          ? apiError.message
          : 'Não foi possível concluir a operação.',
        response.status,
      )
    }

    if (payload === null) {
      throw new BackendApiError(
        'invalid_response',
        'O serviço enviou uma resposta inválida.',
        502,
      )
    }

    return payload as ResponseBody
  }

  private deduplicate<ResponseBody>(
    key: string,
    operation: () => Promise<ResponseBody>,
  ): Promise<ResponseBody> {
    const existing = this.readsInFlight.get(key) as
      | Promise<ResponseBody>
      | undefined

    if (existing) {
      return existing
    }

    const request = operation()
    this.readsInFlight.set(key, request)
    void request.finally(() => {
      if (this.readsInFlight.get(key) === request) {
        this.readsInFlight.delete(key)
      }
    }).catch(() => undefined)

    return request
  }

  private async withTimeout<Result>(operation: Promise<Result>): Promise<Result> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new BackendApiError(
          'request_timeout',
          'O serviço demorou para responder. Tente novamente.',
          0,
        ))
      }, this.timeoutMs)
    })

    try {
      return await Promise.race([operation, timeout])
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    }
  }
}
