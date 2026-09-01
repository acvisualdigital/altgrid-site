import type { Json, PlanCode } from './database'

export type FeatureMap = Record<string, boolean>

/** SQL-compatible sentinel used to represent an unlimited account allowance. */
export const UNLIMITED_ACCOUNT_LIMIT = 2_147_483_647

export interface SafeUser {
  id: string
  email: string | null
  email_confirmed_at: string | null
  created_at: string
  last_sign_in_at: string | null
}

export interface SafeProfile {
  id: string
  display_name: string | null
  referral_code: string
  created_at: string
  updated_at: string
}

export interface UpdateProfileInput {
  display_name: string
}

export interface SafeLicense {
  id: string
  status: 'active'
  starts_at: string
  expires_at: string | null
  lifetime: boolean
}

export interface ResolvedEntitlements {
  plan: PlanCode
  lifetime: boolean
  expires_at: string | null
  founder_number: number | null
  account_limit: number
  features: FeatureMap
}

/** The claims signed by the Worker for bounded offline entitlement access. */
export interface LicenseSnapshotPayload {
  user_id: string
  plan: PlanCode
  account_limit: number
  features: FeatureMap
  founder_number: number | null
  lifetime: boolean
  issued_at: string
  expires_at: string
}

/**
 * Compact signed envelope returned by the API. The payload remains encoded so
 * clients can verify its exact bytes before parsing any claims.
 */
export interface SignedLicenseSnapshot {
  payload: string
  signature: string
  alg: 'EdDSA'
  key_id: string
}

export interface LicenseSnapshotResponse {
  snapshot: SignedLicenseSnapshot
}

export interface MeResponse extends ResolvedEntitlements {
  user: SafeUser
  profile: SafeProfile
  license: SafeLicense | null
  founder_upgrade_eligible: boolean
}

export type ReferralStatus = 'pending' | 'qualified' | 'rewarded' | 'rejected'

export interface ReferralCampaignSummary {
  id: string
  name: string
  starts_at: string
  ends_at: string
  status: 'active' | 'finalized'
}

export interface ReferralLeaderboardEntry {
  position: number
  display_name: string
  valid_referrals: number
  prize_plan: Exclude<PlanCode, 'FREE'> | null
  is_current_user: boolean
}

export interface ReferralProgramResponse {
  code: string
  share_url: string
  campaign: ReferralCampaignSummary
  stats: {
    total: number
    valid: number
    pending: number
    rejected: number
    pro_days: number
    position: number | null
  }
  leaderboard: ReferralLeaderboardEntry[]
  recent_referrals: Array<{
    display_name: string
    status: ReferralStatus
    created_at: string
    rewarded_at: string | null
  }>
}

export interface PublicGame {
  id: string
  slug: string
  name: string
  launch_url: string
  developer_referral_url: string | null
  icon_url: string | null
  sort_order: number
  metadata: Json
  /** Defensive compatibility for catalogs that expose disabled rows. */
  enabled?: boolean
}

export interface PublicConfigResponse {
  config: Record<string, Json>
}

export interface AppUserMetrics {
  /** Users with a recent authenticated presence heartbeat. */
  active: number
  /** Distinct accounts that have used AltGrid. */
  total: number
}

/** Public, aggregate-only counters safe to reuse on the future website. */
export interface AppMetricsResponse {
  users: AppUserMetrics
  /** Distinct active AltGrid users grouped by supported game slug. */
  games?: Record<string, number>
  active_window_seconds: number
  generated_at: string
}

export interface PresenceHeartbeatResponse {
  ok: true
}

export interface HealthResponse {
  ok: boolean
  service: string
}

export interface PublicGamesResponse {
  games: PublicGame[]
}

export type AnnouncementType = 'info' | 'maintenance' | 'warning'

export interface PublicAnnouncement {
  id: string
  title: string
  message: string
  type: AnnouncementType
  published_at: string
  expires_at: string | null
}

export interface PublicAnnouncementsResponse {
  announcements: PublicAnnouncement[]
}

export type AppAdCategory = 'game' | 'product' | 'site'
export type AppAdPlacement = 'sidebar' | 'sidebar_popup'

export interface PublicAppAdPlan {
  code: string
  name: string
  description: string
  placement: AppAdPlacement
  min_days: number
  max_days: number
  price_per_day: number
  currency: string
  popup_enabled: boolean
}

export interface PublicAppAd {
  id: string
  category: AppAdCategory
  game_slug?: string | null
  advertiser_name: string
  title: string
  description: string
  destination_url: string
  image_url: string | null
  cta_label: string
  placement: AppAdPlacement
  popup_enabled: boolean
  starts_at: string
  ends_at: string
}

export interface PublicAppAdsResponse {
  ads: PublicAppAd[]
  popup_cooldown_hours: number
}

export interface PublicAppAdPlansResponse {
  plans: PublicAppAdPlan[]
}

export interface CreateAppAdRequestInput {
  plan_code: string
  category: AppAdCategory
  game_slug?: string | null
  catalog_game_name?: string | null
  catalog_launch_url?: string | null
  catalog_icon_url?: string | null
  advertiser_name: string
  title: string
  description: string
  destination_url: string
  image_url?: string | null
  cta_label: string
  requested_days: number
}

export interface AppAdRequestReceipt {
  id: string
  status: AppAdRequestStatus
  plan_code: string
  requested_days: number
  quoted_amount: number
  currency: string
  created_at: string
}

export type AppAdRequestStatus = 'pending' | 'reviewing' | 'payment_pending' | 'approved' | 'rejected' | 'cancelled'

export interface UserAppAdRequest extends AppAdRequestReceipt {
  advertiser_name: string
  title: string
  status: AppAdRequestStatus
  admin_notes: string | null
  starts_at: string | null
  ends_at: string | null
  payment: PixPayment | null
}

export interface UserAppAdRequestsResponse {
  requests: UserAppAdRequest[]
}

export interface AppAdRequestResponse {
  request: AppAdRequestReceipt
}

export interface AppAdEventResponse {
  recorded: true
}

export interface PublicProduct {
  code: string
  name: string
  description: string | null
  price_amount: number
  currency: string
  lifetime: boolean
}

export interface PublicProductsResponse {
  products: PublicProduct[]
}

export interface ChatChannel {
  id: string
  type: 'direct' | 'game' | 'global'
  game_id: string | null
  name: string
  participant_id?: string | null
  participant_plan?: PlanCode | null
  participant_founder_number?: number | null
  unread?: number
}

export interface ChatMessage {
  id: string
  channel_id: string
  user_id: string
  display_name: string
  message: string
  created_at: string
  edited_at: string | null
  plan: PlanCode
  founder_number: number | null
  /** Optional during the rolling backend/client upgrade. */
  role?: 'admin' | 'member'
}

export interface ChatChannelsResponse {
  channels: ChatChannel[]
}

export interface ChatDirectChannelResponse {
  channel: ChatChannel
}

export interface ChatDirectDeleteResponse {
  deleted: boolean
}

export interface ChatMessagesResponse {
  messages: ChatMessage[]
  pagination: {
    has_more: boolean
    next_before: string | null
  }
}

export interface ChatMessageResponse {
  message: ChatMessage
}

export interface ChatReportResponse {
  report: {
    id: string
    status: 'pending'
  }
}

export interface ChatStatusResponse {
  status: {
    muted_until: string | null
    banned: boolean
    reason: string | null
  }
}

export interface PixPayment {
  id: string
  status: string
  product_code: string
  amount: number
  currency: string
  qr_code?: string | null
  qr_code_base64?: string | null
  expires_at?: string | null
  paid_at?: string | null
  fulfilled_at?: string | null
}

export interface PixPaymentResponse {
  payment: PixPayment
}

export interface DeviceResponse {
  id: string
  device_hash: string
  display_name: string | null
  platform: string | null
  app_version: string | null
  first_seen_at: string
  last_seen_at: string
  revoked_at: string | null
}

export interface DevicesResponse {
  devices: DeviceResponse[]
  pagination: {
    page: number
    page_size: number
    has_more: boolean
  }
}

export interface DeviceResponseEnvelope {
  device: DeviceResponse
}

export interface RegisterDeviceInput {
  device_hash: string
  display_name?: string | null
  platform?: string | null
  app_version?: string | null
}

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
  }
}
