import type { Json, PlanCode } from './database'

export type FeatureMap = Record<string, boolean>

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
  type: 'game' | 'global'
  game_id: string | null
  name: string
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
