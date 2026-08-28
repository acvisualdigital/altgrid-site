import type { Json, PlanCode } from './database'

export interface AdminSessionResponse {
  admin: {
    user_id: string
    role: 'admin'
  }
}

export interface AdminPagination {
  page: number
  page_size: number
  total: number
  has_more: boolean
}

export interface AdminUserSummary {
  id: string
  email: string | null
  display_name: string | null
  referral_code: string
  created_at: string
  plan: PlanCode
  license_status: string | null
  expires_at: string | null
  lifetime: boolean
  founder_number: number | null
}

export interface AdminDevice {
  id: string
  display_name: string | null
  platform: string | null
  app_version: string | null
  first_seen_at: string
  last_seen_at: string
  revoked_at: string | null
}

export interface AdminReferral {
  id: string
  referrer_user_id: string
  referred_user_id: string
  status: string
  qualification_reason: string | null
  created_at: string
  qualified_at: string | null
  rewarded_at: string | null
}

export type AdminReferralStatus = 'pending' | 'qualified' | 'rewarded' | 'rejected'

export interface AdminReferralLog extends AdminReferral {
  campaign_id: string | null
  campaign_name: string | null
  referrer_email: string | null
  referrer_display_name: string | null
  referrer_code: string | null
  referred_email: string | null
  referred_display_name: string | null
  device_hint: string | null
  reward_days: number
}

export interface AdminReferralStats {
  total: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
}

export interface AdminReferralsResponse {
  referrals: AdminReferralLog[]
  stats: AdminReferralStats
  pagination: AdminPagination
}

export interface AdminReferralResponse {
  referral: AdminReferralLog
}

export interface AdminPayment {
  id: string
  provider: string
  product_code: string
  amount: number
  currency: string
  status: string
  fulfilled_at: string | null
  paid_at: string | null
  created_at: string
}

export interface AdminPaymentLog extends AdminPayment {
  user_id: string
  provider_payment_id: string | null
  failure_reason: string | null
  updated_at: string
}

export interface AdminPaymentLogsResponse {
  payments: AdminPaymentLog[]
  pagination: AdminPagination
}

export interface AdminLicense {
  id: string
  plan: PlanCode
  status: string
  starts_at: string
  expires_at: string | null
  lifetime: boolean
  founder_number: number | null
  created_at: string
}

export interface AdminUserDetail extends AdminUserSummary {
  devices: AdminDevice[]
  referrals: AdminReferral[]
  payments: AdminPayment[]
  licenses: AdminLicense[]
  chat_status: {
    banned: boolean
    muted_until: string | null
    reason: string | null
  }
}

export interface AdminUsersResponse {
  users: AdminUserSummary[]
  pagination: AdminPagination
}

export interface AdminUserDetailResponse {
  user: AdminUserDetail
}

export type AdminUserResponse = AdminUserDetailResponse

export interface AdminGame {
  id: string
  slug: string
  name: string
  launch_url: string
  developer_referral_url: string | null
  icon_url: string | null
  enabled: boolean
  sort_order: number
  metadata: Json
  created_at: string
  updated_at: string
}

export interface AdminGamesResponse {
  games: AdminGame[]
}

export interface AdminGameResponse {
  game: AdminGame
}

export interface AdminGameInput {
  slug: string
  name: string
  launch_url: string
  developer_referral_url?: string | null
  icon_url?: string | null
  enabled?: boolean
  sort_order?: number
}

export type AdminGameUpdate = Partial<AdminGameInput>

export interface AdminConfigEntry {
  key: string
  value: Json
  updated_at: string
}

export interface AdminConfigResponse {
  config: AdminConfigEntry[]
}

export interface AdminConfigEntryResponse {
  config: AdminConfigEntry
}

export interface AdminProduct {
  id: string
  code: string
  name: string
  price_amount: number | null
  currency: string
  enabled: boolean
  lifetime: boolean
  updated_at: string
}

export interface AdminProductsResponse {
  products: AdminProduct[]
}

export interface AdminProductResponse {
  product: AdminProduct
}

export interface AdminProductUpdate {
  price_amount?: number | null
  currency?: string
  enabled?: boolean
}

export type AdminAnnouncementType = 'info' | 'warning' | 'maintenance'

export interface AdminAnnouncement {
  id: string
  title: string
  message: string
  type: AdminAnnouncementType
  published_at: string
  expires_at: string | null
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface AdminAnnouncementInput {
  title: string
  message: string
  type: AdminAnnouncementType
  published_at?: string
  expires_at?: string | null
  enabled?: boolean
}

export type AdminAnnouncementUpdate = Partial<AdminAnnouncementInput>

export interface AdminAnnouncementsResponse {
  announcements: AdminAnnouncement[]
}

export interface AdminAnnouncementResponse {
  announcement: AdminAnnouncement
}

export type AdminChatReportStatus = 'pending' | 'reviewed' | 'dismissed' | 'actioned'

export interface AdminChatReport {
  id: string
  message_id: string
  reported_by: string
  reason: string
  status: AdminChatReportStatus
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  message: {
    id: string
    channel_id: string
    user_id: string
    message: string
    created_at: string
    deleted_at: string | null
  } | null
}

export interface AdminChatReportsResponse {
  reports: AdminChatReport[]
  pagination: AdminPagination
}

export interface AdminChatRestriction {
  id: string
  user_id: string
  kind: 'mute' | 'ban'
  reason: string
  expires_at: string | null
  created_at: string
  created_by: string
  revoked_at: string | null
  revoked_by: string | null
}

export interface AdminChatRestrictionInput {
  kind: 'mute' | 'ban'
  reason: string
  expires_at?: string | null
}

export interface AdminChatRestrictionResponse {
  restriction: AdminChatRestriction
}

export interface AdminAuditEntry {
  id: string
  actor_user_id: string
  action: string
  target_type: string
  target_id: string | null
  before_data: Json | null
  after_data: Json | null
  created_at: string
}

export interface AdminAuditResponse {
  entries: AdminAuditEntry[]
  pagination: AdminPagination
}

export interface AdminGrantDaysInput {
  days: number
}

export interface AdminSetPlanInput {
  plan: PlanCode
  expires_at?: string | null
  founder_number?: number | null
}

export interface AdminLifetimeInput {
  plan: Extract<PlanCode, 'PRO' | 'FOUNDER'>
  founder_number?: number | null
}

export interface AdminActionResponse {
  ok: true
}
