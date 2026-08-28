import type {
  AppMetricsResponse,
  DeviceResponse,
  PublicGame,
  RegisterDeviceInput,
  ReferralProgramResponse,
  SafeProfile,
} from '../../src/types/backend-api'
import type { Json } from '../../src/types/database'
import type {
  BackendRepository,
  EntitlementRecord,
  LicenseRecord,
  PlanRecord,
} from '../types'

export class FakeRepository implements BackendRepository {
  metrics: AppMetricsResponse = {
    users: { active: 0, total: 0 },
    active_window_seconds: 900,
    generated_at: '2026-08-25T12:00:00.000Z',
  }
  lastPresenceUserId: string | null = null
  profile: SafeProfile | null = {
    id: '10000000-0000-4000-8000-000000000001',
    display_name: 'Hunter',
    referral_code: 'HUNT-ABCDEFGH',
    created_at: '2026-08-25T10:00:00.000Z',
    updated_at: '2026-08-25T10:00:00.000Z',
  }
  plans: PlanRecord[] = []
  licenses: LicenseRecord[] = []
  entitlements: EntitlementRecord[] = []
  founderUpgradeEligible = false
  games: PublicGame[] = []
  config: Record<string, Json> = Object.create(null) as Record<string, Json>
  devices: DeviceResponse[] = []
  referralProgram: ReferralProgramResponse = {
    code: 'HUNT-ABCDEFGH',
    share_url: 'https://altgrid.com.br/?ref=HUNT-ABCDEFGH',
    campaign: {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Corrida de Indicações — Lançamento',
      starts_at: '2026-08-28T03:00:00.000Z',
      ends_at: '2026-10-01T02:59:59.000Z',
      status: 'active',
    },
    stats: { total: 0, valid: 0, pending: 0, rejected: 0, pro_days: 0, position: null },
    leaderboard: [],
    recent_referrals: [],
  }
  lastRegister: {
    userId: string
    input: RegisterDeviceInput
    now: string
  } | null = null

  async getAppMetrics(): Promise<AppMetricsResponse> {
    return this.metrics
  }

  async heartbeatPresence(userId: string): Promise<void> {
    this.lastPresenceUserId = userId
  }

  async getProfile(): Promise<SafeProfile | null> {
    return this.profile
  }

  async getReferralProgram(): Promise<ReferralProgramResponse> {
    return this.referralProgram
  }

  async reconcileReferralProgram(): Promise<Record<string, unknown>> {
    return { checked: 0, pending: 0, rewarded: 0 }
  }

  async finalizeReferralCampaigns(): Promise<Record<string, unknown>> {
    return { awards: 0, finalized_campaigns: 0 }
  }

  async getPlans(): Promise<PlanRecord[]> {
    return this.plans
  }

  async getActiveLicenseCandidates(): Promise<LicenseRecord[]> {
    return this.licenses
  }

  async getEntitlementCandidates(): Promise<EntitlementRecord[]> {
    return this.entitlements
  }

  async hasProLifetimeUpgradeEligibility(): Promise<boolean> {
    return this.founderUpgradeEligible
  }

  async getEnabledGames(): Promise<PublicGame[]> {
    return this.games
      .filter((game) => game.enabled !== false)
      .sort((left, right) =>
        left.sort_order - right.sort_order
        || left.slug.localeCompare(right.slug))
  }

  async getPublicConfig(): Promise<Record<string, Json>> {
    return this.config
  }

  async registerDevice(
    userId: string,
    input: RegisterDeviceInput,
    now: string,
  ): Promise<DeviceResponse> {
    this.lastRegister = { userId, input, now }
    const existing = this.devices.find(
      (device) => device.device_hash === input.device_hash,
    )

    if (existing) {
      existing.display_name = input.display_name ?? existing.display_name
      existing.platform = input.platform ?? existing.platform
      existing.app_version = input.app_version ?? existing.app_version
      existing.last_seen_at = now
      return existing
    }

    const device: DeviceResponse = {
      id: '20000000-0000-4000-8000-000000000001',
      device_hash: input.device_hash,
      display_name: input.display_name ?? null,
      platform: input.platform ?? null,
      app_version: input.app_version ?? null,
      first_seen_at: now,
      last_seen_at: now,
      revoked_at: null,
    }
    this.devices.push(device)
    return device
  }

  async getDevices(
    _userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ devices: DeviceResponse[]; hasMore: boolean }> {
    const offset = (page - 1) * pageSize
    const rows = this.devices.slice(offset, offset + pageSize + 1)
    return {
      devices: rows.slice(0, pageSize),
      hasMore: rows.length > pageSize,
    }
  }

  async getDevice(_userId: string, deviceId: string): Promise<DeviceResponse | null> {
    return this.devices.find((device) => device.id === deviceId) ?? null
  }

  async revokeDevice(
    _userId: string,
    deviceId: string,
    now: string,
  ): Promise<DeviceResponse | null> {
    const device = this.devices.find((candidate) => candidate.id === deviceId)

    if (!device || device.revoked_at) {
      return null
    }

    device.revoked_at = now
    device.last_seen_at = now
    return device
  }
}
