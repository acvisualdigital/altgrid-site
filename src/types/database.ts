export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type PlanCode = 'FREE' | 'PRO' | 'FOUNDER'

export type LicenseStatus = 'active' | 'expired' | 'suspended' | 'revoked'

export interface UserProfile {
  id: string
  user_id: string
  display_name: string | null
  referral_code: string
  referred_by: string | null
  created_at: string
  updated_at: string
}

export interface Plan {
  id: string
  code: PlanCode
  name: string
  max_accounts: number
  enabled: boolean
  is_lifetime_available: boolean
  sort_order: number
  entitlement_rank: number
  features: Json
  metadata: Json
  created_at: string
  updated_at: string
}

export interface License {
  id: string
  user_id: string
  plan_id: string
  status: LicenseStatus
  starts_at: string
  expires_at: string | null
  lifetime: boolean
  founder_number: number | null
  source: string | null
  created_at: string
  updated_at: string
}

export interface Entitlement {
  id: string
  user_id: string
  feature_key: string
  feature_value: Json | null
  priority: number
  starts_at: string
  expires_at: string | null
  source_type: string | null
  source_id: string | null
  created_at: string
}

export interface Device {
  id: string
  user_id: string
  device_hash: string
  display_name: string | null
  platform: string | null
  app_version: string | null
  first_seen_at: string
  last_seen_at: string
  revoked_at: string | null
  metadata: Json
}

export interface GamePreset {
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

export interface AdminUser {
  user_id: string
  role: 'admin'
  enabled: boolean
  created_at: string
  created_by: string | null
}

export interface AdminAuditLog {
  id: string
  actor_user_id: string
  action: string
  target_type: string
  target_id: string | null
  before_data: Json | null
  after_data: Json | null
  created_at: string
}

interface Referral {
  id: string
  referrer_user_id: string
  referred_user_id: string
  status: 'pending' | 'qualified' | 'rewarded' | 'rejected'
  qualification_reason: string | null
  created_at: string
  qualified_at: string | null
  rewarded_at: string | null
}

interface ReferralReward {
  id: string
  referral_id: string
  beneficiary_user_id: string
  reward_type: string
  reward_days: number
  created_at: string
  metadata: Json
}

interface Product {
  id: string
  code: string
  name: string
  description: string | null
  plan_id: string | null
  price_amount: number | null
  currency: string
  lifetime: boolean
  enabled: boolean
  metadata: Json
  created_at: string
  updated_at: string
}

interface Payment {
  id: string
  user_id: string
  provider: string
  provider_payment_id: string | null
  provider_external_reference: string | null
  product_code: string
  amount: number
  currency: string
  status: string
  raw_status: string | null
  fulfilled_at: string | null
  created_at: string
  updated_at: string
  paid_at: string | null
  metadata: Json
}

interface PaymentEvent {
  id: string
  provider: string
  provider_event_id: string
  payment_id: string | null
  event_type: string | null
  processed: boolean
  received_at: string
  processed_at: string | null
  payload_hash: string | null
  metadata: Json
}

interface AppConfig {
  key: string
  value: Json
  is_public: boolean
  updated_at: string
}

type InsertRow<Row, RequiredKeys extends keyof Row> = Pick<Row, RequiredKeys> &
  Partial<Omit<Row, RequiredKeys>>

type EntitlementInsert = Omit<
  InsertRow<Entitlement, 'user_id' | 'feature_key' | 'feature_value'>,
  'feature_value'
> & { feature_value: boolean }

type EntitlementUpdate = Omit<Partial<Entitlement>, 'feature_value'> & {
  feature_value?: boolean
}

type TableDefinition<Row, Insert, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      profiles: TableDefinition<UserProfile, InsertRow<UserProfile, 'user_id'>>
      plans: TableDefinition<
        Plan,
        InsertRow<Plan, 'code' | 'name' | 'max_accounts'>
      >
      licenses: TableDefinition<
        License,
        InsertRow<License, 'user_id' | 'plan_id' | 'status'>
      >
      entitlements: TableDefinition<
        Entitlement,
        EntitlementInsert,
        EntitlementUpdate
      >
      devices: TableDefinition<
        Device,
        InsertRow<Device, 'user_id' | 'device_hash'>
      >
      games: TableDefinition<
        GamePreset,
        InsertRow<GamePreset, 'slug' | 'name' | 'launch_url'>
      >
      referrals: TableDefinition<
        Referral,
        InsertRow<
          Referral,
          'referrer_user_id' | 'referred_user_id' | 'status'
        >
      >
      referral_rewards: TableDefinition<
        ReferralReward,
        InsertRow<
          ReferralReward,
          | 'referral_id'
          | 'beneficiary_user_id'
          | 'reward_type'
          | 'reward_days'
        >
      >
      products: TableDefinition<
        Product,
        InsertRow<Product, 'code' | 'name'>
      >
      payments: TableDefinition<
        Payment,
        InsertRow<
          Payment,
          'user_id' | 'provider' | 'product_code' | 'amount' | 'status'
        >
      >
      payment_events: TableDefinition<
        PaymentEvent,
        InsertRow<PaymentEvent, 'provider' | 'provider_event_id'>
      >
      app_config: TableDefinition<
        AppConfig,
        InsertRow<AppConfig, 'key' | 'value'>
      >
      admin_users: TableDefinition<
        AdminUser,
        InsertRow<AdminUser, 'user_id'>
      >
      admin_audit_logs: TableDefinition<
        AdminAuditLog,
        InsertRow<
          AdminAuditLog,
          'actor_user_id' | 'action' | 'target_type'
        >
      >
    }
    Views: { [_ in never]: never }
    Functions: {
      is_current_user_admin: {
        Args: { [_ in never]: never }
        Returns: boolean
      }
      is_admin: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      admin_grant_pro_days: {
        Args: {
          p_actor_user_id: string
          p_target_user_id: string
          p_days: number
          p_reason: string | null
        }
        Returns: Json
      }
      admin_set_plan: {
        Args: {
          p_actor_user_id: string
          p_target_user_id: string
          p_plan_code: string
          p_expires_at: string | null
          p_founder_number: number | null
          p_reason: string | null
        }
        Returns: Json
      }
      admin_activate_lifetime: {
        Args: {
          p_actor_user_id: string
          p_target_user_id: string
          p_plan_code: string
          p_founder_number: number | null
          p_reason: string | null
        }
        Returns: Json
      }
      admin_revoke_license: {
        Args: {
          p_actor_user_id: string
          p_license_id: string
          p_reason: string | null
        }
        Returns: Json
      }
      admin_revoke_device: {
        Args: {
          p_actor_user_id: string
          p_device_id: string
          p_reason: string | null
        }
        Returns: Json
      }
      admin_reset_device: {
        Args: {
          p_actor_user_id: string
          p_device_id: string
          p_reason: string | null
        }
        Returns: Json
      }
      admin_create_game: {
        Args: {
          p_actor_user_id: string
          p_name: string
          p_slug: string
          p_launch_url: string
          p_developer_referral_url: string | null
          p_icon_url: string | null
          p_enabled: boolean
          p_sort_order: number
        }
        Returns: Json
      }
      admin_update_game: {
        Args: {
          p_actor_user_id: string
          p_game_id: string
          p_name: string
          p_slug: string
          p_launch_url: string
          p_developer_referral_url: string | null
          p_icon_url: string | null
          p_enabled: boolean
          p_sort_order: number
        }
        Returns: Json
      }
      admin_reorder_games: {
        Args: {
          p_actor_user_id: string
          p_game_ids: string[]
        }
        Returns: Json
      }
      admin_update_config: {
        Args: {
          p_actor_user_id: string
          p_key: string
          p_value: Json
        }
        Returns: Json
      }
      admin_update_product: {
        Args: {
          p_actor_user_id: string
          p_code: string
          p_price_amount: number | null
          p_currency: string
          p_enabled: boolean
        }
        Returns: Json
      }
      admin_search_users: {
        Args: {
          p_actor_user_id: string
          p_query: string
          p_page: number
          p_page_size: number
        }
        Returns: Json
      }
      admin_get_user_detail: {
        Args: {
          p_actor_user_id: string
          p_user_id: string
        }
        Returns: Json
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
