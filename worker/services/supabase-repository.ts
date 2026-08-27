import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from '@supabase/supabase-js'

import type {
  AppMetricsResponse,
  DeviceResponse,
  FeatureMap,
  PublicGame,
  RegisterDeviceInput,
  SafeProfile,
} from '../../src/types/backend-api'
import type { Database, Json } from '../../src/types/database'
import { ApiError } from '../lib/api-error'
import type {
  AnnouncementRecord,
  BackendRepository,
  ChatChannelRecord,
  ChatMessageRecord,
  ChatRepository,
  ChatStatusRecord,
  EntitlementRecord,
  LicenseRecord,
  MercadoPagoSnapshot,
  PaymentRecord,
  PaymentRepository,
  PlanRecord,
  PlatformRepository,
  PublicProductRecord,
  SupabaseClients,
  WorkerEnvironment,
} from '../types'

const DEVICE_COLUMNS = [
  'id',
  'device_hash',
  'display_name',
  'platform',
  'app_version',
  'first_seen_at',
  'last_seen_at',
  'revoked_at',
].join(',')

const PUBLIC_CONFIG_KEYS = [
  'minimum_app_version',
  'status_page_url',
  'support_url',
]

function requireSecret(value: string | undefined): string {
  const normalized = value?.trim()

  if (!normalized) {
    throw new ApiError(500, 'server_misconfigured', 'Serviço não configurado.')
  }

  return normalized
}

function throwDataError(error: PostgrestError): never {
  const message = error.message.toLowerCase()

  if (error.code === '23505') {
    throw new ApiError(409, 'conflict', 'O registro já existe.')
  }

  if (error.code === '42501') {
    throw new ApiError(403, 'forbidden', 'Operação não permitida.')
  }

  if (message.includes('rate limit') || message.includes('too many requests')) {
    throw new ApiError(
      429,
      'rate_limited',
      'Muitas tentativas. Aguarde e tente novamente.',
    )
  }

  if (message.includes('founder sold out')) {
    throw new ApiError(409, 'founder_sold_out', 'As unidades Founder estão esgotadas.')
  }

  if (message.includes('product unavailable')) {
    throw new ApiError(404, 'product_unavailable', 'Produto indisponível.')
  }

  if (message.includes('chat channel not found')) {
    throw new ApiError(404, 'chat_channel_not_found', 'Canal de chat não encontrado.')
  }

  if (message.includes('chat message not found')) {
    throw new ApiError(404, 'chat_message_not_found', 'Mensagem não encontrada.')
  }

  if (message.includes('chat banned')) {
    throw new ApiError(403, 'chat_banned', 'Seu acesso ao chat foi suspenso.')
  }

  if (message.includes('chat muted')) {
    throw new ApiError(403, 'chat_muted', 'Você está temporariamente silenciado no chat.')
  }

  if (error.code === '22023' || error.code === '23514') {
    throw new ApiError(400, 'validation_error', 'Os dados informados são inválidos.')
  }

  throw new ApiError(500, 'database_error', 'Não foi possível acessar os dados.')
}

export function createSupabaseClients(
  environment: WorkerEnvironment,
): SupabaseClients {
  const url = requireSecret(environment.SUPABASE_URL)
  const serviceRoleKey = requireSecret(environment.SUPABASE_SERVICE_ROLE_KEY)
  const options = {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  } as const

  // The user token is passed only to auth.getUser(token). The data client keeps
  // the service-role credential and every private query is scoped by user_id.
  return {
    auth: createClient<Database>(url, serviceRoleKey, options),
    data: createClient(url, serviceRoleKey, options),
  }
}

export class SupabaseRepository implements
  BackendRepository,
  PlatformRepository,
  ChatRepository,
  PaymentRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getAppMetrics(): Promise<AppMetricsResponse> {
    const { data, error } = await this.client.rpc('app_metrics')

    if (error) throwDataError(error)
    return data as AppMetricsResponse
  }

  async heartbeatPresence(userId: string): Promise<void> {
    const { error } = await this.client.rpc('record_presence', {
      p_user_id: userId,
    })

    if (error) throwDataError(error)
  }

  async getProfile(userId: string): Promise<SafeProfile | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id,display_name,referral_code,created_at,updated_at')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      throwDataError(error)
    }

    return data
  }

  async updateProfile(userId: string, displayName: string): Promise<SafeProfile> {
    const { data, error } = await this.client
      .from('profiles')
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select('id,display_name,referral_code,created_at,updated_at')
      .single()

    if (error) throwDataError(error)
    return data as SafeProfile
  }

  async getPlans(): Promise<PlanRecord[]> {
    const { data, error } = await this.client
      .from('plans')
      .select('id,code,name,max_accounts,enabled,entitlement_rank,features')

    if (error) {
      throwDataError(error)
    }

    const plans = (data ?? []) as Array<Omit<PlanRecord, 'features'> & { features: Json }>

    return plans.map((plan) => ({
      ...plan,
      features: plan.features as FeatureMap,
    }))
  }

  async getActiveLicenseCandidates(userId: string): Promise<LicenseRecord[]> {
    const { data, error } = await this.client
      .from('licenses')
      .select(
        'id,user_id,plan_id,status,starts_at,expires_at,lifetime,founder_number,created_at',
      )
      .eq('user_id', userId)
      .eq('status', 'active')

    if (error) {
      throwDataError(error)
    }

    return data ?? []
  }

  async getEntitlementCandidates(userId: string): Promise<EntitlementRecord[]> {
    const { data, error } = await this.client
      .from('entitlements')
      .select(
        'id,user_id,feature_key,feature_value,priority,starts_at,expires_at,created_at',
      )
      .eq('user_id', userId)

    if (error) {
      throwDataError(error)
    }

    return data ?? []
  }

  async getEnabledGames(): Promise<PublicGame[]> {
    const { data, error } = await this.client
      .from('games')
      .select(
        'id,slug,name,launch_url,developer_referral_url,icon_url,sort_order,metadata',
      )
      .eq('enabled', true)
      .order('sort_order', { ascending: true })
      .order('slug', { ascending: true })

    if (error) {
      throwDataError(error)
    }

    return data ?? []
  }

  async getPublicConfig(): Promise<Record<string, Json>> {
    const { data, error } = await this.client
      .from('app_config')
      .select('key,value')
      .eq('is_public', true)
      .in('key', PUBLIC_CONFIG_KEYS)
      .order('key', { ascending: true })

    if (error) {
      throwDataError(error)
    }

    const config = Object.create(null) as Record<string, Json>

    for (const entry of (data ?? []) as Array<{ key: string; value: Json }>) {
      config[entry.key] = entry.value
    }

    return config
  }

  async getAppConfig(): Promise<Record<string, Json>> {
    const { data, error } = await this.client
      .from('app_config')
      .select('key,value')
      .eq('is_public', true)
      .order('key', { ascending: true })

    if (error) throwDataError(error)
    const config = Object.create(null) as Record<string, Json>
    for (const entry of (data ?? []) as Array<{ key: string; value: Json }>) {
      config[entry.key] = entry.value
    }
    return config
  }

  async getAnnouncements(): Promise<AnnouncementRecord[]> {
    const now = new Date().toISOString()
    const { data, error } = await this.client
      .from('announcements')
      .select('id,title,message,type,published_at,expires_at')
      .eq('enabled', true)
      .lte('published_at', now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(50)

    if (error) throwDataError(error)
    return (data ?? []) as AnnouncementRecord[]
  }

  async getPublicProducts(): Promise<PublicProductRecord[]> {
    const { data, error } = await this.client
      .from('products')
      .select('code,name,description,price_amount,currency,lifetime')
      .in('code', ['PRO_LIFETIME', 'FOUNDER_LIFETIME'])
      .eq('enabled', true)
      .not('price_amount', 'is', null)
      .gt('price_amount', 0)
      .order('code', { ascending: true })

    if (error) throwDataError(error)
    return (data ?? []) as PublicProductRecord[]
  }

  async getChatChannels(): Promise<ChatChannelRecord[]> {
    const { data, error } = await this.client
      .from('chat_channels')
      .select('id,type,game_id,name')
      .eq('enabled', true)
      .order('type', { ascending: true })
      .order('name', { ascending: true })

    if (error) throwDataError(error)
    return (data ?? []) as ChatChannelRecord[]
  }

  async getChatStatus(userId: string): Promise<ChatStatusRecord> {
    const { data, error } = await this.client.rpc('chat_status', {
      p_user_id: userId,
    })
    if (error) throwDataError(error)
    return data as ChatStatusRecord
  }

  async getChatMessages(
    userId: string,
    channelId: string,
    before: string | null,
    pageSize: number,
  ): Promise<ChatMessageRecord[]> {
    const { data, error } = await this.client.rpc('chat_list_messages', {
      p_user_id: userId,
      p_channel_id: channelId,
      p_before: before,
      p_page_size: pageSize,
    })
    if (error) throwDataError(error)
    return (data ?? []) as ChatMessageRecord[]
  }

  async sendChatMessage(
    userId: string,
    channelId: string,
    message: string,
  ): Promise<ChatMessageRecord> {
    const { data, error } = await this.client.rpc('chat_send_message', {
      p_user_id: userId,
      p_channel_id: channelId,
      p_message: message,
    })
    if (error) throwDataError(error)
    return data as ChatMessageRecord
  }

  async reportChatMessage(
    userId: string,
    messageId: string,
    reason: string,
  ): Promise<{ id: string; status: string }> {
    const { data, error } = await this.client.rpc('chat_report_message', {
      p_user_id: userId,
      p_message_id: messageId,
      p_reason: reason,
    })
    if (error) throwDataError(error)
    return data as { id: string; status: string }
  }

  async createPendingMercadoPagoPayment(
    userId: string,
    productCode: string,
    requestKey: string,
  ): Promise<PaymentRecord> {
    const { data, error } = await this.client.rpc(
      'create_pending_mercadopago_payment',
      {
        p_user_id: userId,
        p_product_code: productCode,
        p_request_key: requestKey,
      },
    )
    if (error) throwDataError(error)
    return data as PaymentRecord
  }

  async attachMercadoPagoPayment(
    userId: string,
    paymentId: string,
    snapshot: MercadoPagoSnapshot,
  ): Promise<PaymentRecord> {
    const { data, error } = await this.client.rpc('attach_mercadopago_payment', {
      p_user_id: userId,
      p_payment_id: paymentId,
      p_provider_payment_id: snapshot.id,
      p_status: snapshot.status,
      p_expires_at: snapshot.date_of_expiration,
      p_checkout_data: snapshot.checkout as unknown as Json,
    })
    if (error) throwDataError(error)
    return data as PaymentRecord
  }

  async failPendingPayment(
    userId: string,
    paymentId: string,
    reason: string,
  ): Promise<void> {
    const { error } = await this.client.rpc('fail_pending_payment', {
      p_user_id: userId,
      p_payment_id: paymentId,
      p_reason: reason,
    })
    if (error) throwDataError(error)
  }

  async getUserPayment(
    userId: string,
    paymentId: string,
  ): Promise<PaymentRecord | null> {
    const { data, error } = await this.client
      .from('payments')
      .select([
        'id', 'user_id', 'provider', 'provider_payment_id',
        'provider_external_reference', 'product_code', 'amount', 'currency',
        'status', 'raw_status', 'fulfilled_at', 'paid_at',
        'provider_expires_at', 'failure_reason', 'metadata',
        'created_at', 'updated_at',
      ].join(','))
      .eq('id', paymentId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throwDataError(error)
    return data as PaymentRecord | null
  }

  async processMercadoPagoPayment(
    snapshot: MercadoPagoSnapshot,
    eventId: string,
    payloadHash: string,
    providerData: Json,
  ): Promise<{
      payment_id: string
      status: string
      fulfilled: boolean
      duplicate: boolean
    }> {
    const { data, error } = await this.client.rpc('process_mercadopago_payment', {
      p_provider_payment_id: snapshot.id,
      p_external_reference: snapshot.external_reference,
      p_provider_status: snapshot.status,
      p_amount: snapshot.transaction_amount,
      p_currency: snapshot.currency_id,
      p_paid_at: snapshot.date_approved,
      p_event_id: eventId,
      p_payload_hash: payloadHash,
      p_provider_data: providerData,
    })
    if (error) throwDataError(error)
    return data as {
      payment_id: string
      status: string
      fulfilled: boolean
      duplicate: boolean
    }
  }

  async registerDevice(
    userId: string,
    input: RegisterDeviceInput,
    now: string,
  ): Promise<DeviceResponse> {
    const values: Database['public']['Tables']['devices']['Insert'] = {
      user_id: userId,
      device_hash: input.device_hash,
      last_seen_at: now,
    }

    if (input.display_name !== undefined) {
      values.display_name = input.display_name
    }
    if (input.platform !== undefined) {
      values.platform = input.platform
    }
    if (input.app_version !== undefined) {
      values.app_version = input.app_version
    }

    const { data, error } = await this.client
      .from('devices')
      .upsert(values, { onConflict: 'user_id,device_hash' })
      .select(DEVICE_COLUMNS)
      .single()

    if (error) {
      throwDataError(error)
    }

    return data as unknown as DeviceResponse
  }

  async getDevices(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ devices: DeviceResponse[]; hasMore: boolean }> {
    const offset = (page - 1) * pageSize
    const { data, error } = await this.client
      .from('devices')
      .select(DEVICE_COLUMNS)
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize)

    if (error) {
      throwDataError(error)
    }

    const rows = (data ?? []) as unknown as DeviceResponse[]

    return {
      devices: rows.slice(0, pageSize),
      hasMore: rows.length > pageSize,
    }
  }

  async getDevice(
    userId: string,
    deviceId: string,
  ): Promise<DeviceResponse | null> {
    const { data, error } = await this.client
      .from('devices')
      .select(DEVICE_COLUMNS)
      .eq('id', deviceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      throwDataError(error)
    }

    return data as DeviceResponse | null
  }

  async revokeDevice(
    userId: string,
    deviceId: string,
    now: string,
  ): Promise<DeviceResponse | null> {
    const { data, error } = await this.client
      .from('devices')
      .update({ revoked_at: now, last_seen_at: now })
      .eq('id', deviceId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select(DEVICE_COLUMNS)
      .maybeSingle()

    if (error) {
      throwDataError(error)
    }

    return data as DeviceResponse | null
  }
}
