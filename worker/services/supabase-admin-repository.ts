import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import type {
  AdminAnnouncement,
  AdminAppAdRequest,
  AdminAppAdStatus,
  AdminAnnouncementInput,
  AdminAnnouncementUpdate,
  AdminAuditEntry,
  AdminConfigEntry,
  AdminChatReport,
  AdminChatReportStatus,
  AdminChatRestriction,
  AdminChatRestrictionInput,
  AdminDevice,
  AdminGame,
  AdminGameInput,
  AdminGameUpdate,
  AdminLicense,
  AdminPayment,
  AdminPaymentLog,
  AdminProduct,
  AdminProductUpdate,
  AdminPublisherRequest,
  AdminPublisherRequestStatus,
  AdminReferral,
  AdminReferralLog,
  AdminReferralStats,
  AdminReferralStatus,
  AdminUserDetail,
  AdminUserSummary,
} from '../../src/types/admin-api'
import type { Json, PlanCode } from '../../src/types/database'
import { ApiError } from '../lib/api-error'
import type { AdminRepository } from '../types'

const ADMIN_CONFIG_KEYS = [
  'referral_referrer_days',
  'referral_referred_days',
  'founder_max_sales',
  'maintenance',
  'minimum_version',
  'latest_version',
  'update_channel',
]
const ADMIN_PRODUCT_CODES = [
  'PRO_LIFETIME',
  'PRO_PLUS_LIFETIME',
  'PRO_PLUS_UPGRADE',
  'FOUNDER_LIFETIME',
  'FOUNDER_UPGRADE',
  'PLUS_FOUNDER_UPGRADE',
]

type ProfileRow = {
  user_id: string
  display_name: string | null
  referral_code: string
  created_at: string
}

type LicenseRow = {
  id: string
  user_id: string
  status: string
  starts_at: string
  expires_at: string | null
  lifetime: boolean
  founder_number: number | null
  created_at: string
  plans: { code: PlanCode } | Array<{ code: PlanCode }> | null
}

type SearchUsersRpcResult = {
  page: number
  page_size: number
  total: number
  items: Array<{
    user_id: string
    email: string | null
    display_name: string | null
    referral_code: string | null
    created_at: string
    plan_code: PlanCode
    license_status: string | null
    expires_at: string | null
    lifetime: boolean
    founder_number: number | null
  }>
}

type UserDetailRpcResult = {
  user: { id: string; email: string | null; created_at: string }
  profile: ProfileRow | null
  current_access: {
    plan_code: PlanCode
    license_status: string | null
    expires_at: string | null
    lifetime: boolean
    founder_number: number | null
  }
  licenses: Array<LicenseRow & { plan_code: PlanCode }>
  devices: AdminDevice[]
  referrals: { as_referrer: AdminReferral[]; as_referred: AdminReferral[] }
  payments: AdminPayment[]
}

type ReferralListRpcResult = {
  page: number
  page_size: number
  total: number
  stats: AdminReferralStats
  items: AdminReferralLog[]
}

function dataError(error: PostgrestError): never {
  if (error.code === '23505') {
    throw new ApiError(409, 'conflict', 'O registro já existe.')
  }
  if (error.code === '22023' || error.code === '23503' || error.code === '23514') {
    throw new ApiError(400, 'validation_error', 'Os dados informados são inválidos.')
  }
  if (error.code === '42501') {
    throw new ApiError(403, 'admin_forbidden', 'Acesso administrativo não permitido.')
  }
  if (error.code === 'P0002') {
    throw new ApiError(404, 'not_found', 'Registro não encontrado.')
  }
  throw new ApiError(500, 'database_error', 'Não foi possível acessar os dados administrativos.')
}

export class SupabaseAdminRepository implements AdminRepository {
  constructor(private readonly client: SupabaseClient) {}

  async isAdmin(userId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc('is_admin', {
      p_user_id: userId,
    })
    if (error) dataError(error)
    return data === true
  }

  async searchAdminUsers(
    actorUserId: string,
    query: string,
    page: number,
    pageSize: number,
  ): Promise<{ users: AdminUserSummary[]; total: number }> {
    const { data, error } = await this.client.rpc('admin_search_users', {
      p_actor_user_id: actorUserId,
      p_query: query,
      p_page: page,
      p_page_size: pageSize,
    })
    if (error) dataError(error)
    const result = data as unknown as SearchUsersRpcResult
    return {
      users: result.items.map((item) => ({
        id: item.user_id,
        email: item.email,
        display_name: item.display_name,
        referral_code: item.referral_code ?? '',
        created_at: item.created_at,
        plan: item.plan_code,
        license_status: item.license_status,
        expires_at: item.expires_at,
        lifetime: item.lifetime,
        founder_number: item.founder_number,
      })),
      total: result.total,
    }
  }

  async getAdminUser(
    actorUserId: string,
    userId: string,
  ): Promise<AdminUserDetail | null> {
    const { data, error } = await this.client.rpc('admin_get_user_detail', {
      p_actor_user_id: actorUserId,
      p_user_id: userId,
    })
    if (error) {
      if (error.code === 'P0002') return null
      dataError(error)
    }

    const result = data as unknown as UserDetailRpcResult
    const { data: chatStatus, error: chatStatusError } = await this.client.rpc(
      'chat_status',
      { p_user_id: userId },
    )
    if (chatStatusError) dataError(chatStatusError)
    const access = result.current_access
    const profile = result.profile
    const devices = (result.devices ?? []).map((device) => ({
      id: device.id,
      display_name: device.display_name,
      platform: device.platform,
      app_version: device.app_version,
      first_seen_at: device.first_seen_at,
      last_seen_at: device.last_seen_at,
      revoked_at: device.revoked_at,
    }))
    const licenses: AdminLicense[] = (result.licenses ?? []).map((row) => ({
      id: row.id,
      plan: row.plan_code,
      status: row.status,
      starts_at: row.starts_at,
      expires_at: row.expires_at,
      lifetime: row.lifetime,
      founder_number: row.founder_number,
      created_at: row.created_at,
    }))

    return {
      id: result.user.id,
      email: result.user.email,
      display_name: profile?.display_name ?? null,
      referral_code: profile?.referral_code ?? '',
      created_at: result.user.created_at,
      plan: access.plan_code,
      license_status: access.license_status,
      expires_at: access.expires_at,
      lifetime: access.lifetime,
      founder_number: access.founder_number,
      devices,
      referrals: [
        ...(result.referrals?.as_referrer ?? []),
        ...(result.referrals?.as_referred ?? []),
      ],
      payments: (result.payments ?? []).map((payment) => ({
        id: payment.id,
        provider: payment.provider,
        product_code: payment.product_code,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        fulfilled_at: payment.fulfilled_at,
        paid_at: payment.paid_at,
        created_at: payment.created_at,
      })),
      licenses,
      chat_status: chatStatus as AdminUserDetail['chat_status'],
    }
  }

  async getAdminReferrals(
    actorUserId: string,
    status: AdminReferralStatus | null,
    query: string,
    page: number,
    pageSize: number,
  ): Promise<{ referrals: AdminReferralLog[]; stats: AdminReferralStats; total: number }> {
    const { data, error } = await this.client.rpc('admin_list_referrals', {
      p_actor_user_id: actorUserId,
      p_status: status,
      p_query: query,
      p_page: page,
      p_page_size: pageSize,
    })
    if (error) dataError(error)
    const result = data as unknown as ReferralListRpcResult
    return {
      referrals: result.items ?? [],
      stats: result.stats,
      total: result.total,
    }
  }

  adminApproveReferral(
    actorUserId: string,
    referralId: string,
    reason: string,
  ): Promise<AdminReferralLog> {
    return this.adminRpcResult<AdminReferralLog>('admin_approve_referral', {
      p_actor_user_id: actorUserId,
      p_referral_id: referralId,
      p_reason: reason,
    })
  }

  adminRejectReferral(
    actorUserId: string,
    referralId: string,
    reason: string,
  ): Promise<AdminReferralLog> {
    return this.adminRpcResult<AdminReferralLog>('admin_reject_referral', {
      p_actor_user_id: actorUserId,
      p_referral_id: referralId,
      p_reason: reason,
    })
  }

  private async adminRpc(name: string, parameters: Record<string, unknown>): Promise<void> {
    const { error } = await this.client.rpc(name, parameters)
    if (error) dataError(error)
  }

  private async adminRpcAfter<T>(
    name: string,
    parameters: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await this.client.rpc(name, parameters)
    if (error) dataError(error)
    return (data as { after: T }).after
  }

  private async adminRpcResult<T>(
    name: string,
    parameters: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await this.client.rpc(name, parameters)
    if (error) dataError(error)
    return data as T
  }

  adminGrantProDays(actorUserId: string, targetUserId: string, days: number): Promise<void> {
    return this.adminRpc('admin_grant_pro_days', {
      p_actor_user_id: actorUserId,
      p_target_user_id: targetUserId,
      p_days: days,
      p_reason: 'Painel administrativo',
    })
  }

  adminSetPlan(
    actorUserId: string,
    targetUserId: string,
    plan: PlanCode,
    requestedExpiresAt?: string | null,
    founderNumber?: number | null,
  ): Promise<void> {
    // A minimal plan switch without an explicit term receives 30 days. The
    // admin UI may send expires_at when an exact temporary term is required.
    const expiresAt = plan === 'FREE'
      ? null
      : requestedExpiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString()
    return this.adminRpc('admin_set_plan', {
      p_actor_user_id: actorUserId,
      p_target_user_id: targetUserId,
      p_plan_code: plan,
      p_expires_at: expiresAt,
      p_founder_number: founderNumber ?? null,
      p_reason: 'Painel administrativo',
    })
  }

  adminActivateLifetime(
    actorUserId: string,
    targetUserId: string,
    plan: 'PRO' | 'PRO_PLUS' | 'FOUNDER',
    founderNumber?: number | null,
  ): Promise<void> {
    return this.adminRpc('admin_activate_lifetime', {
      p_actor_user_id: actorUserId,
      p_target_user_id: targetUserId,
      p_plan_code: plan,
      p_founder_number: founderNumber ?? null,
      p_reason: 'Painel administrativo',
    })
  }

  adminRevokeLicense(actorUserId: string, licenseId: string): Promise<void> {
    return this.adminRpc('admin_revoke_license', {
      p_actor_user_id: actorUserId,
      p_license_id: licenseId,
      p_reason: 'Painel administrativo',
    })
  }

  adminRevokeDevice(actorUserId: string, deviceId: string): Promise<void> {
    return this.adminRpc('admin_revoke_device', {
      p_actor_user_id: actorUserId,
      p_device_id: deviceId,
      p_reason: 'Painel administrativo',
    })
  }

  adminResetDevice(actorUserId: string, deviceId: string): Promise<void> {
    return this.adminRpc('admin_reset_device', {
      p_actor_user_id: actorUserId,
      p_device_id: deviceId,
      p_reason: 'Painel administrativo',
    })
  }

  async getAdminGames(): Promise<AdminGame[]> {
    const { data, error } = await this.client
      .from('games')
      .select('id,slug,name,launch_url,developer_referral_url,icon_url,enabled,sort_order,metadata,created_at,updated_at')
      .order('sort_order', { ascending: true })
      .order('slug', { ascending: true })
    if (error) dataError(error)
    return (data ?? []) as AdminGame[]
  }

  async createAdminGame(actorUserId: string, input: AdminGameInput): Promise<AdminGame> {
    return this.adminRpcAfter<AdminGame>('admin_create_game', {
      p_actor_user_id: actorUserId,
      p_name: input.name,
      p_slug: input.slug,
      p_launch_url: input.launch_url,
      p_developer_referral_url: input.developer_referral_url ?? null,
      p_icon_url: input.icon_url ?? null,
      p_enabled: input.enabled ?? true,
      p_sort_order: input.sort_order ?? 0,
    })
  }

  async updateAdminGame(
    actorUserId: string,
    gameId: string,
    input: AdminGameUpdate,
  ): Promise<AdminGame | null> {
    const { data: before, error: beforeError } = await this.client
      .from('games').select('*').eq('id', gameId).maybeSingle()
    if (beforeError) dataError(beforeError)
    if (!before) return null
    const current = before as AdminGame
    return this.adminRpcAfter<AdminGame>('admin_update_game', {
      p_actor_user_id: actorUserId,
      p_game_id: gameId,
      p_name: input.name ?? current.name,
      p_slug: input.slug ?? current.slug,
      p_launch_url: input.launch_url ?? current.launch_url,
      p_developer_referral_url: input.developer_referral_url === undefined
        ? current.developer_referral_url
        : input.developer_referral_url,
      p_icon_url: input.icon_url === undefined ? current.icon_url : input.icon_url,
      p_enabled: input.enabled ?? current.enabled,
      p_sort_order: input.sort_order ?? current.sort_order,
    })
  }

  async getAdminPublisherRequests(
    actorUserId: string,
    status: AdminPublisherRequestStatus | null,
  ): Promise<AdminPublisherRequest[]> {
    const { data, error } = await this.client.rpc('admin_list_site_developer_requests', {
      p_actor_user_id: actorUserId,
      p_status: status,
    })
    if (error) dataError(error)
    return (data ?? []) as AdminPublisherRequest[]
  }

  async reviewAdminPublisherRequest(
    actorUserId: string,
    requestId: string,
    status: Extract<AdminPublisherRequestStatus, 'reviewing' | 'approved' | 'rejected'>,
    notes: string | null,
  ): Promise<AdminPublisherRequest> {
    const reviewed = await this.adminRpcResult<AdminPublisherRequest>(
      'admin_review_site_developer_request',
      {
        p_actor_user_id: actorUserId,
        p_request_id: requestId,
        p_status: status,
        p_notes: notes,
      },
    )
    const [enriched] = await this.getAdminPublisherRequests(actorUserId, status)
      .then((entries) => entries.filter((entry) => entry.id === reviewed.id))
    return enriched ?? reviewed
  }

  async getAdminAppAdRequests(
    actorUserId: string,
    status: AdminAppAdStatus | null,
  ): Promise<AdminAppAdRequest[]> {
    const { data, error } = await this.client.rpc('admin_list_app_ad_requests', {
      p_actor_user_id: actorUserId,
      p_status: status,
    })
    if (error) dataError(error)
    return (data ?? []).map((entry: AdminAppAdRequest) => ({
      ...entry,
      quoted_amount: Number(entry.quoted_amount),
    }))
  }

  async reviewAdminAppAdRequest(
    actorUserId: string,
    requestId: string,
    status: Extract<AdminAppAdStatus, 'reviewing' | 'payment_pending' | 'rejected'>,
    notes: string | null,
  ): Promise<AdminAppAdRequest> {
    await this.adminRpcResult<AdminAppAdRequest>('admin_review_app_ad_request', {
      p_actor_user_id: actorUserId,
      p_request_id: requestId,
      p_status: status,
      p_notes: notes,
    })
    const entries = await this.getAdminAppAdRequests(actorUserId, status)
    const reviewed = entries.find((entry) => entry.id === requestId)
    if (!reviewed) throw new ApiError(404, 'advertising_request_not_found', 'Solicitação não encontrada.')
    return reviewed
  }

  async getAdminConfig(): Promise<AdminConfigEntry[]> {
    const { data, error } = await this.client
      .from('app_config')
      .select('key,value,updated_at')
      .in('key', ADMIN_CONFIG_KEYS)
      .order('key', { ascending: true })
    if (error) dataError(error)
    return (data ?? []) as AdminConfigEntry[]
  }

  async updateAdminConfig(
    actorUserId: string,
    key: string,
    value: Json,
  ): Promise<AdminConfigEntry | null> {
    const { data: before, error: beforeError } = await this.client
      .from('app_config').select('key,value,updated_at').eq('key', key).maybeSingle()
    if (beforeError) dataError(beforeError)
    if (!before) return null
    return this.adminRpcAfter<AdminConfigEntry>('admin_update_config', {
      p_actor_user_id: actorUserId,
      p_key: key,
      p_value: value,
    })
  }

  async getAdminProducts(): Promise<AdminProduct[]> {
    const { data, error } = await this.client
      .from('products')
      .select('id,code,name,price_amount,currency,enabled,lifetime,updated_at')
      .in('code', ADMIN_PRODUCT_CODES)
      .order('code', { ascending: true })
    if (error) dataError(error)
    return (data ?? []) as AdminProduct[]
  }

  async updateAdminProduct(
    actorUserId: string,
    productId: string,
    input: AdminProductUpdate,
  ): Promise<AdminProduct | null> {
    const columns = 'id,code,name,price_amount,currency,enabled,lifetime,updated_at'
    const { data: before, error: beforeError } = await this.client
      .from('products').select(columns).eq('id', productId)
      .in('code', ADMIN_PRODUCT_CODES).maybeSingle()
    if (beforeError) dataError(beforeError)
    if (!before) return null
    const current = before as AdminProduct
    return this.adminRpcAfter<AdminProduct>('admin_update_product', {
      p_actor_user_id: actorUserId,
      p_code: current.code,
      p_price_amount: input.price_amount === undefined
        ? current.price_amount
        : input.price_amount,
      p_currency: input.currency ?? current.currency,
      p_enabled: input.enabled ?? current.enabled,
    })
  }

  async getAdminAnnouncements(): Promise<AdminAnnouncement[]> {
    const { data, error } = await this.client
      .from('announcements')
      .select('id,title,message,type,published_at,expires_at,enabled,created_at,updated_at')
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
    if (error) dataError(error)
    return (data ?? []) as AdminAnnouncement[]
  }

  createAdminAnnouncement(
    actorUserId: string,
    input: AdminAnnouncementInput,
  ): Promise<AdminAnnouncement> {
    const publishedAt = input.published_at ?? new Date().toISOString()
    return this.adminRpcAfter<AdminAnnouncement>('admin_upsert_announcement', {
      p_actor_user_id: actorUserId,
      p_id: null,
      p_title: input.title,
      p_message: input.message,
      p_type: input.type,
      p_published_at: publishedAt,
      p_expires_at: input.expires_at ?? null,
      p_enabled: input.enabled ?? true,
    })
  }

  async updateAdminAnnouncement(
    actorUserId: string,
    announcementId: string,
    input: AdminAnnouncementUpdate,
  ): Promise<AdminAnnouncement | null> {
    const columns = 'id,title,message,type,published_at,expires_at,enabled,created_at,updated_at'
    const { data: before, error } = await this.client
      .from('announcements')
      .select(columns)
      .eq('id', announcementId)
      .maybeSingle()
    if (error) dataError(error)
    if (!before) return null
    const current = before as AdminAnnouncement
    return this.adminRpcAfter<AdminAnnouncement>('admin_upsert_announcement', {
      p_actor_user_id: actorUserId,
      p_id: announcementId,
      p_title: input.title ?? current.title,
      p_message: input.message ?? current.message,
      p_type: input.type ?? current.type,
      p_published_at: input.published_at ?? current.published_at,
      p_expires_at: input.expires_at === undefined
        ? current.expires_at
        : input.expires_at,
      p_enabled: input.enabled ?? current.enabled,
    })
  }

  deleteAdminAnnouncement(actorUserId: string, announcementId: string): Promise<void> {
    return this.adminRpc('admin_delete_announcement', {
      p_actor_user_id: actorUserId,
      p_id: announcementId,
    })
  }

  async getAdminChatReports(
    status: AdminChatReportStatus | null,
    page: number,
    pageSize: number,
  ): Promise<{ reports: AdminChatReport[]; total: number }> {
    const offset = (page - 1) * pageSize
    let query = this.client
      .from('chat_reports')
      .select(
        'id,message_id,reported_by,reason,status,created_at,reviewed_at,reviewed_by,message:chat_messages(id,channel_id,user_id,message,created_at,deleted_at)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (status) query = query.eq('status', status)
    const { data, error, count } = await query
    if (error) dataError(error)
    const reports = (data ?? []).map((row) => {
      const value = row as unknown as Omit<AdminChatReport, 'message'> & {
        message: AdminChatReport['message'] | AdminChatReport['message'][]
      }
      return {
        ...value,
        message: Array.isArray(value.message) ? value.message[0] ?? null : value.message,
      }
    })
    return { reports, total: count ?? 0 }
  }

  reviewAdminChatReport(
    actorUserId: string,
    reportId: string,
    status: Exclude<AdminChatReportStatus, 'pending'>,
  ): Promise<void> {
    return this.adminRpc('admin_review_chat_report', {
      p_actor_user_id: actorUserId,
      p_report_id: reportId,
      p_status: status,
    })
  }

  setAdminChatRestriction(
    actorUserId: string,
    targetUserId: string,
    input: AdminChatRestrictionInput,
  ): Promise<AdminChatRestriction> {
    return this.adminRpcAfter<AdminChatRestriction>('admin_set_chat_restriction', {
      p_actor_user_id: actorUserId,
      p_target_user_id: targetUserId,
      p_kind: input.kind,
      p_reason: input.reason,
      p_expires_at: input.expires_at ?? null,
    })
  }

  clearAdminChatRestriction(actorUserId: string, targetUserId: string): Promise<void> {
    return this.adminRpc('admin_clear_chat_restriction', {
      p_actor_user_id: actorUserId,
      p_target_user_id: targetUserId,
    })
  }

  deleteAdminChatMessage(actorUserId: string, messageId: string): Promise<void> {
    return this.adminRpc('admin_delete_chat_message', {
      p_actor_user_id: actorUserId,
      p_message_id: messageId,
    })
  }

  clearAdminChat(actorUserId: string): Promise<void> {
    return this.adminRpc('admin_clear_chat_messages', {
      p_actor_user_id: actorUserId,
    })
  }

  async getAdminAudit(
    page: number,
    pageSize: number,
  ): Promise<{ entries: AdminAuditEntry[]; total: number }> {
    const offset = (page - 1) * pageSize
    const { data, error, count } = await this.client
      .from('admin_audit_logs')
      .select('id,actor_user_id,action,target_type,target_id,before_data,after_data,created_at', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) dataError(error)
    return { entries: (data ?? []) as AdminAuditEntry[], total: count ?? 0 }
  }

  async getAdminPaymentLogs(
    page: number,
    pageSize: number,
  ): Promise<{ payments: AdminPaymentLog[]; total: number }> {
    const offset = (page - 1) * pageSize
    const { data, error, count } = await this.client
      .from('payments')
      .select('id,user_id,provider,provider_payment_id,product_code,amount,currency,status,failure_reason,fulfilled_at,paid_at,created_at,updated_at', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) dataError(error)
    return { payments: (data ?? []) as AdminPaymentLog[], total: count ?? 0 }
  }
}
