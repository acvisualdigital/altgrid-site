import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  AppMetricsResponse,
  DeviceResponse,
  FeatureMap,
  LicenseSnapshotResponse,
  PublicGame,
  RegisterDeviceInput,
  ReferralProgramResponse,
  SafeProfile,
  SafeUser,
} from '../src/types/backend-api'
import type {
  AdminAuditEntry,
  AdminAnnouncement,
  AdminAnnouncementInput,
  AdminAnnouncementUpdate,
  AdminChatReport,
  AdminChatReportStatus,
  AdminChatRestriction,
  AdminChatRestrictionInput,
  AdminConfigEntry,
  AdminGame,
  AdminGameInput,
  AdminGameUpdate,
  AdminProduct,
  AdminProductUpdate,
  AdminPublisherRequest,
  AdminPublisherRequestStatus,
  AdminPaymentLog,
  AdminUserDetail,
  AdminUserSummary,
} from '../src/types/admin-api'
import type { PlanCode } from '../src/types/database'
import type { Database, Json } from '../src/types/database'

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface WorkerEnvironment extends Env {}

export interface PlanRecord {
  id: string
  code: string
  name: string
  max_accounts: number
  enabled: boolean
  entitlement_rank: number
  features: FeatureMap
}

export interface LicenseRecord {
  id: string
  user_id: string
  plan_id: string
  status: string
  starts_at: string
  expires_at: string | null
  lifetime: boolean
  founder_number: number | null
  created_at: string
}

export interface EntitlementRecord {
  id: string
  user_id: string
  feature_key: string
  feature_value: Json | null
  priority: number
  starts_at: string
  expires_at: string | null
  created_at: string
}

export interface BackendRepository {
  getAppMetrics(): Promise<AppMetricsResponse>
  heartbeatPresence(userId: string): Promise<void>
  getProfile(userId: string): Promise<SafeProfile | null>
  updateProfile?(userId: string, displayName: string): Promise<SafeProfile>
  getPlans(): Promise<PlanRecord[]>
  getActiveLicenseCandidates(userId: string): Promise<LicenseRecord[]>
  getEntitlementCandidates(userId: string): Promise<EntitlementRecord[]>
  hasProLifetimeUpgradeEligibility(userId: string): Promise<boolean>
  getEnabledGames(): Promise<PublicGame[]>
  getPublicConfig(): Promise<Record<string, Json>>
  registerDevice(
    userId: string,
    input: RegisterDeviceInput,
    now: string,
  ): Promise<DeviceResponse>
  getDevices(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ devices: DeviceResponse[]; hasMore: boolean }>
  getDevice(userId: string, deviceId: string): Promise<DeviceResponse | null>
  revokeDevice(
    userId: string,
    deviceId: string,
    now: string,
  ): Promise<DeviceResponse | null>
  getReferralProgram(userId: string): Promise<ReferralProgramResponse>
  reconcileReferralProgram(limit?: number): Promise<Record<string, unknown>>
  finalizeReferralCampaigns(): Promise<Record<string, unknown>>
}

export interface AnnouncementRecord {
  id: string
  title: string
  message: string
  type: 'info' | 'warning' | 'maintenance'
  published_at: string
  expires_at: string | null
  enabled?: boolean
  created_at?: string
  updated_at?: string
}

export interface PublicProductRecord {
  code: string
  name: string
  description: string | null
  price_amount: number
  currency: string
  lifetime: boolean
}

export interface ChatChannelRecord {
  id: string
  type: 'direct' | 'global' | 'game'
  game_id: string | null
  name: string
  participant_id?: string | null
  participant_plan?: string | null
  participant_founder_number?: number | null
  unread?: number
}

export interface ChatMessageRecord {
  id: string
  channel_id: string
  user_id: string
  display_name: string
  message: string
  created_at: string
  edited_at: string | null
  plan: string
  founder_number: number | null
}

export interface ChatStatusRecord {
  banned: boolean
  muted_until: string | null
  reason: string | null
}

export interface PaymentRecord {
  id: string
  user_id: string
  provider: 'mercadopago'
  provider_payment_id: string | null
  provider_external_reference: string | null
  product_code: string
  amount: number
  currency: string
  status: string
  raw_status: string | null
  fulfilled_at: string | null
  paid_at: string | null
  provider_expires_at: string | null
  failure_reason: string | null
  metadata: Json
  created_at: string
  updated_at: string
}

export interface MercadoPagoCheckoutData {
  qr_code: string
  qr_code_base64: string
  ticket_url: string | null
}

export interface MercadoPagoSnapshot {
  id: string
  external_reference: string
  status: string
  transaction_amount: number
  currency_id: string
  date_approved: string | null
  date_of_expiration: string | null
  date_last_updated: string | null
  checkout: MercadoPagoCheckoutData | null
}

export interface PlatformRepository {
  getAppConfig(): Promise<Record<string, Json>>
  getAnnouncements(): Promise<AnnouncementRecord[]>
  getPublicProducts(): Promise<PublicProductRecord[]>
}

export interface ChatRepository {
  getChatChannels(userId: string): Promise<ChatChannelRecord[]>
  startDirectChat(userId: string, recipientId: string): Promise<ChatChannelRecord>
  deleteDirectChat(userId: string, channelId: string): Promise<void>
  getChatStatus(userId: string): Promise<ChatStatusRecord>
  getChatMessages(
    userId: string,
    channelId: string,
    before: string | null,
    pageSize: number,
  ): Promise<ChatMessageRecord[]>
  sendChatMessage(
    userId: string,
    channelId: string,
    message: string,
  ): Promise<ChatMessageRecord>
  reportChatMessage(
    userId: string,
    messageId: string,
    reason: string,
  ): Promise<{ id: string; status: string }>
}

export interface PaymentRepository {
  createPendingMercadoPagoPayment(
    userId: string,
    productCode: string,
    requestKey: string,
  ): Promise<PaymentRecord>
  attachMercadoPagoPayment(
    userId: string,
    paymentId: string,
    snapshot: MercadoPagoSnapshot,
  ): Promise<PaymentRecord>
  failPendingPayment(
    userId: string,
    paymentId: string,
    reason: string,
  ): Promise<void>
  getUserPayment(userId: string, paymentId: string): Promise<PaymentRecord | null>
  getPaymentById(paymentId: string): Promise<PaymentRecord | null>
  listPendingMercadoPagoPayments(limit: number): Promise<PaymentRecord[]>
  processMercadoPagoPayment(
    snapshot: MercadoPagoSnapshot,
    eventId: string,
    payloadHash: string,
    providerData: Json,
  ): Promise<{ payment_id: string; status: string; fulfilled: boolean; duplicate: boolean }>
}

export interface PaymentService {
  createPixPayment(
    user: SafeUser,
    productCode: string,
    requestKey: string,
  ): Promise<Record<string, unknown>>
  getPayment(userId: string, paymentId: string): Promise<Record<string, unknown> | null>
  reconcilePayment(paymentId: string): Promise<Record<string, unknown> | null>
  reconcilePendingPayments(limit?: number): Promise<{
    checked: number
    failed: number
    updated: number
  }>
  handleWebhook(request: Request): Promise<void>
}

export interface LicenseSnapshotService {
  createSnapshot(userId: string): Promise<LicenseSnapshotResponse>
}

export interface AdminRepository {
  isAdmin(userId: string): Promise<boolean>
  searchAdminUsers(
    actorUserId: string,
    query: string,
    page: number,
    pageSize: number,
  ): Promise<{ users: AdminUserSummary[]; total: number }>
  getAdminUser(actorUserId: string, userId: string): Promise<AdminUserDetail | null>
  getAdminReferrals(
    actorUserId: string,
    status: import('../src/types/admin-api').AdminReferralStatus | null,
    query: string,
    page: number,
    pageSize: number,
  ): Promise<{
    referrals: import('../src/types/admin-api').AdminReferralLog[]
    stats: import('../src/types/admin-api').AdminReferralStats
    total: number
  }>
  adminApproveReferral(
    actorUserId: string,
    referralId: string,
    reason: string,
  ): Promise<import('../src/types/admin-api').AdminReferralLog>
  adminRejectReferral(
    actorUserId: string,
    referralId: string,
    reason: string,
  ): Promise<import('../src/types/admin-api').AdminReferralLog>
  adminGrantProDays(actorUserId: string, targetUserId: string, days: number): Promise<void>
  adminSetPlan(
    actorUserId: string,
    targetUserId: string,
    plan: PlanCode,
    expiresAt?: string | null,
    founderNumber?: number | null,
  ): Promise<void>
  adminActivateLifetime(
    actorUserId: string,
    targetUserId: string,
    plan: Extract<PlanCode, 'PRO' | 'PRO_PLUS' | 'FOUNDER'>,
    founderNumber?: number | null,
  ): Promise<void>
  adminRevokeLicense(actorUserId: string, licenseId: string): Promise<void>
  adminRevokeDevice(actorUserId: string, deviceId: string): Promise<void>
  adminResetDevice(actorUserId: string, deviceId: string): Promise<void>
  getAdminGames(): Promise<AdminGame[]>
  createAdminGame(actorUserId: string, input: AdminGameInput): Promise<AdminGame>
  updateAdminGame(
    actorUserId: string,
    gameId: string,
    input: AdminGameUpdate,
  ): Promise<AdminGame | null>
  getAdminPublisherRequests(actorUserId: string, status: AdminPublisherRequestStatus | null): Promise<AdminPublisherRequest[]>
  reviewAdminPublisherRequest(
    actorUserId: string,
    requestId: string,
    status: Extract<AdminPublisherRequestStatus, 'reviewing' | 'approved' | 'rejected'>,
    notes: string | null,
  ): Promise<AdminPublisherRequest>
  getAdminConfig(): Promise<AdminConfigEntry[]>
  updateAdminConfig(
    actorUserId: string,
    key: string,
    value: Json,
  ): Promise<AdminConfigEntry | null>
  getAdminProducts(): Promise<AdminProduct[]>
  updateAdminProduct(
    actorUserId: string,
    productId: string,
    input: AdminProductUpdate,
  ): Promise<AdminProduct | null>
  getAdminAnnouncements(): Promise<AdminAnnouncement[]>
  createAdminAnnouncement(
    actorUserId: string,
    input: AdminAnnouncementInput,
  ): Promise<AdminAnnouncement>
  updateAdminAnnouncement(
    actorUserId: string,
    announcementId: string,
    input: AdminAnnouncementUpdate,
  ): Promise<AdminAnnouncement | null>
  deleteAdminAnnouncement(actorUserId: string, announcementId: string): Promise<void>
  getAdminChatReports(
    status: AdminChatReportStatus | null,
    page: number,
    pageSize: number,
  ): Promise<{ reports: AdminChatReport[]; total: number }>
  reviewAdminChatReport(
    actorUserId: string,
    reportId: string,
    status: Exclude<AdminChatReportStatus, 'pending'>,
  ): Promise<void>
  setAdminChatRestriction(
    actorUserId: string,
    targetUserId: string,
    input: AdminChatRestrictionInput,
  ): Promise<AdminChatRestriction>
  clearAdminChatRestriction(actorUserId: string, targetUserId: string): Promise<void>
  deleteAdminChatMessage(actorUserId: string, messageId: string): Promise<void>
  clearAdminChat?(actorUserId: string): Promise<void>
  getAdminAudit(
    page: number,
    pageSize: number,
  ): Promise<{ entries: AdminAuditEntry[]; total: number }>
  getAdminPaymentLogs(
    page: number,
    pageSize: number,
  ): Promise<{ payments: AdminPaymentLog[]; total: number }>
}

export type ApplicationRepository = BackendRepository & AdminRepository

export interface AuthenticationService {
  authenticate(request: Request): Promise<SafeUser>
}

export interface SupabaseClients {
  auth: SupabaseClient<Database>
  data: SupabaseClient
}
