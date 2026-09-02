import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { SupabaseAdminRepository } from './supabase-admin-repository'

const ACTOR = '00000000-0000-4000-8000-000000000001'
const TARGET = '00000000-0000-4000-8000-000000000002'

function repositoryWithRpc(
  implementation: (name: string, parameters: Record<string, unknown>) => unknown,
) {
  const rpc = vi.fn(async (name: string, parameters: Record<string, unknown>) => ({
    data: implementation(name, parameters),
    error: null,
  }))
  return {
    repository: new SupabaseAdminRepository({ rpc } as unknown as SupabaseClient),
    rpc,
  }
}

describe('SupabaseAdminRepository RPC boundary', () => {
  it('checks admin status using only the service-role RPC result', async () => {
    const { repository, rpc } = repositoryWithRpc(() => true)
    await expect(repository.isAdmin(ACTOR)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('is_admin', { p_user_id: ACTOR })
  })

  it('passes all required atomic license parameters and an audit reason', async () => {
    const { repository, rpc } = repositoryWithRpc(() => ({ before: null, after: {} }))
    const expiresAt = '2027-01-01T00:00:00.000Z'
    await repository.adminGrantProDays(ACTOR, TARGET, 15)
    await repository.adminSetPlan(ACTOR, TARGET, 'FOUNDER', expiresAt, 42)
    await repository.adminActivateLifetime(ACTOR, TARGET, 'FOUNDER', 42)

    expect(rpc).toHaveBeenNthCalledWith(1, 'admin_grant_pro_days', {
      p_actor_user_id: ACTOR,
      p_target_user_id: TARGET,
      p_days: 15,
      p_reason: 'Painel administrativo',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_set_plan', {
      p_actor_user_id: ACTOR,
      p_target_user_id: TARGET,
      p_plan_code: 'FOUNDER',
      p_expires_at: expiresAt,
      p_founder_number: 42,
      p_reason: 'Painel administrativo',
    })
    expect(rpc).toHaveBeenNthCalledWith(3, 'admin_activate_lifetime', {
      p_actor_user_id: ACTOR,
      p_target_user_id: TARGET,
      p_plan_code: 'FOUNDER',
      p_founder_number: 42,
      p_reason: 'Painel administrativo',
    })
  })

  it('creates a disabled game in the same audited RPC', async () => {
    const after = {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Em manutenção',
      slug: 'em-manutencao',
      launch_url: 'https://game.example.com/play',
      developer_referral_url: null,
      icon_url: null,
      enabled: false,
      sort_order: 20,
      metadata: {},
      created_at: '2026-08-26T00:00:00.000Z',
      updated_at: '2026-08-26T00:00:00.000Z',
    }
    const { repository, rpc } = repositoryWithRpc(() => ({ before: null, after }))

    await expect(repository.createAdminGame(ACTOR, {
      name: after.name,
      slug: after.slug,
      launch_url: after.launch_url,
      enabled: false,
      sort_order: after.sort_order,
    })).resolves.toMatchObject({ enabled: false })

    expect(rpc).toHaveBeenCalledWith('admin_create_game', {
      p_actor_user_id: ACTOR,
      p_name: after.name,
      p_slug: after.slug,
      p_launch_url: after.launch_url,
      p_developer_referral_url: null,
      p_icon_url: null,
      p_enabled: false,
      p_sort_order: after.sort_order,
    })
  })

  it('maps search RPC rows to the public admin DTO', async () => {
    const { repository } = repositoryWithRpc(() => ({
      page: 1,
      page_size: 10,
      total: 1,
      items: [{
        user_id: TARGET,
        email: 'cliente@example.com',
        display_name: 'Cliente',
        referral_code: 'HUNT-ABCDEFGH',
        created_at: '2026-08-20T00:00:00.000Z',
        plan_code: 'PRO',
        license_status: 'active',
        expires_at: '2026-09-20T00:00:00.000Z',
        lifetime: false,
        founder_number: null,
      }],
    }))
    await expect(repository.searchAdminUsers(ACTOR, 'cliente', 1, 10)).resolves.toEqual({
      users: [expect.objectContaining({ id: TARGET, plan: 'PRO' })],
      total: 1,
    })
  })

  it('strips device hashes, raw metadata and provider payment IDs from detail', async () => {
    const { repository } = repositoryWithRpc(() => ({
      user: { id: TARGET, email: 'cliente@example.com', created_at: '2026-08-20T00:00:00.000Z' },
      profile: { user_id: TARGET, display_name: 'Cliente', created_at: '2026-08-20T00:00:00.000Z' },
      current_access: {
        plan_code: 'FREE',
        license_status: null,
        expires_at: null,
        lifetime: false,
        founder_number: null,
      },
      licenses: [],
      devices: [{
        id: '20000000-0000-4000-8000-000000000001',
        device_hash: 'secret-fingerprint',
        display_name: 'PC',
        platform: 'windows',
        app_version: '1.0.0',
        first_seen_at: '2026-08-20T00:00:00.000Z',
        last_seen_at: '2026-08-25T00:00:00.000Z',
        revoked_at: null,
        metadata: { secret: true },
      }],
      referrals: { as_referrer: [], as_referred: [] },
      payments: [{
        id: '70000000-0000-4000-8000-000000000001',
        provider: 'mercadopago',
        provider_payment_id: 'provider-secret',
        product_code: 'PRO_LIFETIME',
        amount: 99,
        currency: 'BRL',
        status: 'approved',
        fulfilled_at: null,
        paid_at: null,
        created_at: '2026-08-20T00:00:00.000Z',
      }],
    }))

    const detail = await repository.getAdminUser(ACTOR, TARGET)
    expect(detail?.devices[0]).not.toHaveProperty('device_hash')
    expect(detail?.devices[0]).not.toHaveProperty('metadata')
    expect(detail?.payments[0]).not.toHaveProperty('provider_payment_id')
  })

  it('includes Founder upgrade in the administrable product query', async () => {
    const products = [{
      id: '40000000-0000-4000-8000-000000000001',
      code: 'FOUNDER_UPGRADE',
      name: 'Founder Upgrade',
      price_amount: 75,
      currency: 'BRL',
      enabled: true,
      lifetime: true,
      updated_at: '2026-08-27T12:00:00.000Z',
    }]
    const order = vi.fn(async () => ({ data: products, error: null }))
    const inFilter = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ in: inFilter }))
    const from = vi.fn(() => ({ select }))
    const repository = new SupabaseAdminRepository({ from } as unknown as SupabaseClient)

    await expect(repository.getAdminProducts()).resolves.toEqual(products)
    expect(inFilter).toHaveBeenCalledWith('code', [
      'PRO_LIFETIME',
      'PRO_PLUS_LIFETIME',
      'PRO_PLUS_UPGRADE',
      'FOUNDER_LIFETIME',
      'FOUNDER_UPGRADE',
      'PLUS_FOUNDER_UPGRADE',
    ])
  })
})
