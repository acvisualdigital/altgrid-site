import type {
  AdminAnnouncement,
  AdminAnnouncementInput,
  AdminAnnouncementUpdate,
  AdminAuditEntry,
  AdminConfigEntry,
  AdminChatReport,
  AdminChatReportStatus,
  AdminChatRestriction,
  AdminChatRestrictionInput,
  AdminGame,
  AdminGameInput,
  AdminGameUpdate,
  AdminProduct,
  AdminProductUpdate,
  AdminPublisherRequest,
  AdminPublisherRequestStatus,
  AdminReferralLog,
  AdminReferralStats,
  AdminReferralStatus,
  AdminPaymentLog,
  AdminUserDetail,
  AdminUserSummary,
} from '../../src/types/admin-api'
import type { Json, PlanCode } from '../../src/types/database'
import type { AdminRepository } from '../types'

export class FakeAdminRepository implements AdminRepository {
  admin = false
  users: AdminUserDetail[] = []
  games: AdminGame[] = []
  publisherRequests: AdminPublisherRequest[] = []
  config: AdminConfigEntry[] = []
  products: AdminProduct[] = []
  announcements: AdminAnnouncement[] = []
  chatReports: AdminChatReport[] = []
  chatRestrictions: AdminChatRestriction[] = []
  audit: AdminAuditEntry[] = []
  referrals: AdminReferralLog[] = []
  calls: Array<{ action: string; actor: string; target: string; value?: unknown }> = []

  async isAdmin(): Promise<boolean> {
    return this.admin
  }

  async searchAdminUsers(
    _actor: string,
    query: string,
    page: number,
    pageSize: number,
  ): Promise<{ users: AdminUserSummary[]; total: number }> {
    const normalized = query.toLowerCase()
    const filtered = this.users.filter((user) => !normalized || [
      user.id,
      user.email ?? '',
      user.referral_code,
    ].some((value) => value.toLowerCase().includes(normalized)))
    const offset = (page - 1) * pageSize
    return { users: filtered.slice(offset, offset + pageSize), total: filtered.length }
  }

  async getAdminUser(_actor: string, userId: string): Promise<AdminUserDetail | null> {
    return this.users.find((user) => user.id === userId) ?? null
  }

  async getAdminReferrals(
    _actor: string,
    status: AdminReferralStatus | null,
    query: string,
    page: number,
    pageSize: number,
  ): Promise<{ referrals: AdminReferralLog[]; stats: AdminReferralStats; total: number }> {
    const normalized = query.toLowerCase()
    const searched = this.referrals.filter((referral) => (
      (!status || referral.status === status)
      && (!normalized || [
        referral.referrer_email ?? '', referral.referred_email ?? '',
        referral.referrer_display_name ?? '', referral.referred_display_name ?? '',
        referral.referrer_code ?? '', referral.id,
      ].some((value) => value.toLowerCase().includes(normalized)))
    ))
    const offset = (page - 1) * pageSize
    const count = (wanted: AdminReferralStatus) => this.referrals.filter(
      (referral) => referral.status === wanted,
    ).length
    return {
      referrals: searched.slice(offset, offset + pageSize),
      stats: {
        total: this.referrals.length,
        pending: count('pending'),
        qualified: count('qualified'),
        rewarded: count('rewarded'),
        rejected: count('rejected'),
      },
      total: searched.length,
    }
  }

  async adminApproveReferral(
    actor: string,
    referralId: string,
    reason: string,
  ): Promise<AdminReferralLog> {
    const referral = this.referrals.find((item) => item.id === referralId)
    if (!referral) throw new Error('Referral not found')
    referral.status = 'rewarded'
    referral.qualification_reason = `manual_admin_approval: ${reason}`
    referral.qualified_at ??= '2026-08-25T12:00:00.000Z'
    referral.rewarded_at = '2026-08-25T12:00:00.000Z'
    referral.reward_days = 1
    this.record(actor, 'referral.approve', 'referral', referralId, referral as unknown as Json)
    return referral
  }

  async adminRejectReferral(
    actor: string,
    referralId: string,
    reason: string,
  ): Promise<AdminReferralLog> {
    const referral = this.referrals.find((item) => item.id === referralId)
    if (!referral) throw new Error('Referral not found')
    referral.status = 'rejected'
    referral.qualification_reason = `manual_admin_rejection: ${reason}`
    referral.rewarded_at = null
    referral.reward_days = 0
    this.record(actor, 'referral.reject', 'referral', referralId, referral as unknown as Json)
    return referral
  }

  private record(
    actor: string,
    action: string,
    targetType: string,
    target: string,
    after: Json,
    before: Json | null = null,
  ) {
    this.calls.push({ action, actor, target, value: after })
    this.audit.unshift({
      id: `90000000-0000-4000-8000-${String(this.audit.length + 1).padStart(12, '0')}`,
      actor_user_id: actor,
      action,
      target_type: targetType,
      target_id: target,
      before_data: before,
      after_data: after,
      created_at: '2026-08-25T12:00:00.000Z',
    })
  }

  async adminGrantProDays(actor: string, target: string, days: number): Promise<void> {
    this.record(actor, 'license.grant_pro_days', 'user', target, { days })
  }

  async adminSetPlan(
    actor: string,
    target: string,
    plan: PlanCode,
    expiresAt?: string | null,
    founderNumber?: number | null,
  ): Promise<void> {
    this.record(actor, 'license.set_plan', 'user', target, {
      plan,
      expires_at: expiresAt ?? null,
      founder_number: founderNumber ?? null,
    })
  }

  async adminActivateLifetime(
    actor: string,
    target: string,
    plan: 'PRO' | 'PRO_PLUS' | 'FOUNDER',
    founderNumber?: number | null,
  ): Promise<void> {
    this.record(actor, 'license.activate_lifetime', 'user', target, {
      plan,
      founder_number: founderNumber ?? null,
    })
  }

  async adminRevokeLicense(actor: string, target: string): Promise<void> {
    this.record(actor, 'license.revoke', 'license', target, {})
  }

  async adminRevokeDevice(actor: string, target: string): Promise<void> {
    this.record(actor, 'device.revoke', 'device', target, {})
  }

  async adminResetDevice(actor: string, target: string): Promise<void> {
    this.record(actor, 'device.reset', 'device', target, {})
  }

  async getAdminGames(): Promise<AdminGame[]> {
    return [...this.games].sort((a, b) => a.sort_order - b.sort_order || a.slug.localeCompare(b.slug))
  }

  async getAdminPublisherRequests(
    _actor: string,
    status: AdminPublisherRequestStatus | null,
  ): Promise<AdminPublisherRequest[]> {
    return this.publisherRequests.filter((entry) => !status || entry.status === status)
  }

  async reviewAdminPublisherRequest(
    actor: string,
    requestId: string,
    status: Extract<AdminPublisherRequestStatus, 'reviewing' | 'approved' | 'rejected'>,
    notes: string | null,
  ): Promise<AdminPublisherRequest> {
    const entry = this.publisherRequests.find((candidate) => candidate.id === requestId)
    if (!entry) throw new Error('Publisher request not found')
    entry.status = status
    entry.admin_notes = notes
    entry.reviewed_by = actor
    entry.reviewed_at = '2026-08-30T12:00:00.000Z'
    entry.updated_at = entry.reviewed_at
    if (entry.request_type === 'campaign' && status === 'approved') {
      entry.campaign_starts_at = entry.reviewed_at
      entry.campaign_ends_at = entry.plan_code === 'launch_30'
        ? '2026-09-29T12:00:00.000Z'
        : '2026-09-06T12:00:00.000Z'
    }
    this.record(actor, `site.publisher_request.${status}`, 'site_developer_request', requestId, entry as unknown as Json)
    return entry
  }

  async createAdminGame(actor: string, input: AdminGameInput): Promise<AdminGame> {
    const game: AdminGame = {
      id: '30000000-0000-4000-8000-000000000099',
      developer_referral_url: null,
      icon_url: null,
      enabled: true,
      sort_order: 0,
      metadata: {},
      created_at: '2026-08-25T12:00:00.000Z',
      updated_at: '2026-08-25T12:00:00.000Z',
      ...input,
    }
    this.games.push(game)
    this.record(actor, 'game.create', 'game', game.id, game as unknown as Json)
    return game
  }

  async updateAdminGame(
    actor: string,
    gameId: string,
    input: AdminGameUpdate,
  ): Promise<AdminGame | null> {
    const game = this.games.find((candidate) => candidate.id === gameId)
    if (!game) return null
    Object.assign(game, input)
    this.record(actor, 'game.update', 'game', gameId, input as Json)
    return game
  }

  async getAdminConfig(): Promise<AdminConfigEntry[]> {
    return this.config
  }

  async updateAdminConfig(
    actor: string,
    key: string,
    value: Json,
  ): Promise<AdminConfigEntry | null> {
    const entry = this.config.find((candidate) => candidate.key === key)
    if (!entry) return null
    const before = structuredClone(entry) as unknown as Json
    entry.value = value
    this.record(actor, 'config.update', 'app_config', key, entry as unknown as Json, before)
    return entry
  }

  async getAdminProducts(): Promise<AdminProduct[]> {
    return this.products
  }

  async getAdminPaymentLogs(): Promise<{ payments: AdminPaymentLog[]; total: number }> {
    return { payments: [], total: 0 }
  }

  async updateAdminProduct(
    actor: string,
    productId: string,
    input: AdminProductUpdate,
  ): Promise<AdminProduct | null> {
    const product = this.products.find((candidate) => candidate.id === productId)
    if (!product) return null
    Object.assign(product, input)
    this.record(actor, 'product.update', 'product', productId, input as Json)
    return product
  }

  async getAdminAnnouncements(): Promise<AdminAnnouncement[]> {
    return this.announcements
  }

  async createAdminAnnouncement(
    actor: string,
    input: AdminAnnouncementInput,
  ): Promise<AdminAnnouncement> {
    const now = '2026-08-25T12:00:00.000Z'
    const announcement: AdminAnnouncement = {
      id: '81000000-0000-4000-8000-000000000001',
      title: input.title,
      message: input.message,
      type: input.type,
      published_at: input.published_at ?? now,
      expires_at: input.expires_at ?? null,
      enabled: input.enabled ?? true,
      created_at: now,
      updated_at: now,
    }
    this.announcements.unshift(announcement)
    this.record(actor, 'announcement.create', 'announcement', announcement.id, announcement as unknown as Json)
    return announcement
  }

  async updateAdminAnnouncement(
    actor: string,
    announcementId: string,
    input: AdminAnnouncementUpdate,
  ): Promise<AdminAnnouncement | null> {
    const announcement = this.announcements.find((item) => item.id === announcementId)
    if (!announcement) return null
    Object.assign(announcement, input)
    this.record(actor, 'announcement.update', 'announcement', announcementId, input as Json)
    return announcement
  }

  async deleteAdminAnnouncement(actor: string, announcementId: string): Promise<void> {
    this.announcements = this.announcements.filter((item) => item.id !== announcementId)
    this.record(actor, 'announcement.delete', 'announcement', announcementId, {})
  }

  async getAdminChatReports(
    status: AdminChatReportStatus | null,
    page: number,
    pageSize: number,
  ): Promise<{ reports: AdminChatReport[]; total: number }> {
    const filtered = status
      ? this.chatReports.filter((report) => report.status === status)
      : this.chatReports
    const offset = (page - 1) * pageSize
    return { reports: filtered.slice(offset, offset + pageSize), total: filtered.length }
  }

  async reviewAdminChatReport(
    actor: string,
    reportId: string,
    status: Exclude<AdminChatReportStatus, 'pending'>,
  ): Promise<void> {
    const report = this.chatReports.find((item) => item.id === reportId)
    if (report) report.status = status
    this.record(actor, 'chat.report.review', 'chat_report', reportId, { status })
  }

  async setAdminChatRestriction(
    actor: string,
    target: string,
    input: AdminChatRestrictionInput,
  ): Promise<AdminChatRestriction> {
    const restriction: AdminChatRestriction = {
      id: '82000000-0000-4000-8000-000000000001',
      user_id: target,
      kind: input.kind,
      reason: input.reason,
      expires_at: input.expires_at ?? null,
      created_at: '2026-08-25T12:00:00.000Z',
      created_by: actor,
      revoked_at: null,
      revoked_by: null,
    }
    this.chatRestrictions.push(restriction)
    this.record(actor, `chat.${input.kind}`, 'user', target, restriction as unknown as Json)
    return restriction
  }

  async clearAdminChatRestriction(actor: string, target: string): Promise<void> {
    this.chatRestrictions = this.chatRestrictions.filter((item) => item.user_id !== target)
    this.record(actor, 'chat.restriction.clear', 'user', target, {})
  }

  async deleteAdminChatMessage(actor: string, messageId: string): Promise<void> {
    this.record(actor, 'chat.message.delete', 'chat_message', messageId, {})
  }

  async getAdminAudit(
    page: number,
    pageSize: number,
  ): Promise<{ entries: AdminAuditEntry[]; total: number }> {
    const offset = (page - 1) * pageSize
    return {
      entries: this.audit.slice(offset, offset + pageSize),
      total: this.audit.length,
    }
  }
}
