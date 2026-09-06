import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { SupabaseRepository } from './supabase-repository'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const CHANNEL_ID = '10000000-0000-4000-8000-000000000001'
const PAYMENT_ID = '20000000-0000-4000-8000-000000000001'
const RECIPIENT_ID = '00000000-0000-4000-8000-000000000099'

function chatRpcClient(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  const chain: Record<string, unknown> = { error: null }
  chain.delete = vi.fn(() => chain)
  chain.update = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  return { from: vi.fn(() => chain), rpc } as unknown as SupabaseClient
}

describe('SupabaseRepository presence and metrics RPC boundary', () => {
  it('reads only the aggregate metrics returned by the database function', async () => {
    const metrics = {
      users: { active: 7, total: 42 },
      active_window_seconds: 900,
      generated_at: '2026-08-27T12:00:00.000Z',
    }
    const rpc = vi.fn(async () => ({ data: metrics, error: null }))
    const repository = new SupabaseRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.getAppMetrics()).resolves.toEqual(metrics)
    expect(rpc).toHaveBeenCalledWith('app_metrics')
  })

  it('reuses aggregate metrics briefly instead of querying Postgres for every client', async () => {
    const metrics = {
      users: { active: 9, total: 50 },
      active_window_seconds: 900,
      generated_at: '2026-09-05T12:00:00.000Z',
    }
    const rpc = vi.fn(async () => ({ data: metrics, error: null }))
    const repository = new SupabaseRepository({ rpc } as unknown as SupabaseClient)

    await Promise.all([
      repository.getAppMetrics(),
      repository.getAppMetrics(),
      repository.getAppMetrics(),
    ])
    await repository.getAppMetrics()

    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('records presence with the authenticated user id only', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    const repository = new SupabaseRepository({ rpc } as unknown as SupabaseClient)

    await repository.heartbeatPresence(USER_ID)

    expect(rpc).toHaveBeenCalledWith('record_presence', {
      p_user_id: USER_ID,
      p_active_game_slugs: [],
    })
  })

  it('coalesces duplicate presence heartbeats but records changed active games', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    const repository = new SupabaseRepository({ rpc } as unknown as SupabaseClient)

    await Promise.all([
      repository.heartbeatPresence(USER_ID, ['pokerealm', 'huntera']),
      repository.heartbeatPresence(USER_ID, ['huntera', 'pokerealm']),
    ])
    await repository.heartbeatPresence(USER_ID, ['pokerealm', 'huntera'])
    await repository.heartbeatPresence(USER_ID, ['huntera'])

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenNthCalledWith(1, 'record_presence', {
      p_user_id: USER_ID,
      p_active_game_slugs: ['huntera', 'pokerealm'],
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'record_presence', {
      p_user_id: USER_ID,
      p_active_game_slugs: ['huntera'],
    })
  })

  it('reads Founder upgrade eligibility only from the protected database function', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }))
    const repository = new SupabaseRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.hasProLifetimeUpgradeEligibility(USER_ID)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('has_pro_lifetime_upgrade_eligibility', {
      p_user_id: USER_ID,
    })
  })

  it('leaves chat plan and founder identity to the server-side RPC', async () => {
    const serverMessage = {
      id: '20000000-0000-4000-8000-000000000001',
      channel_id: CHANNEL_ID,
      user_id: USER_ID,
      display_name: 'Founder',
      message: 'Olá',
      created_at: '2026-08-27T12:00:00.000Z',
      edited_at: null,
      plan: 'FOUNDER',
      founder_number: 7,
    }
    const rpc = vi.fn(async () => ({ data: serverMessage, error: null }))
    const repository = new SupabaseRepository(chatRpcClient(rpc))

    await expect(repository.sendChatMessage(USER_ID, CHANNEL_ID, 'Olá'))
      .resolves.toEqual(serverMessage)
    expect(rpc).toHaveBeenCalledWith('chat_send_message', {
      p_user_id: USER_ID,
      p_channel_id: CHANNEL_ID,
      p_message: 'Olá',
    })
  })

  it('starts direct conversations through the protected database function', async () => {
    const directChannel = {
      id: CHANNEL_ID,
      type: 'direct',
      game_id: null,
      name: 'Amigo',
      participant_id: RECIPIENT_ID,
      unread: 0,
    }
    const rpc = vi.fn(async () => ({ data: directChannel, error: null }))
    const repository = new SupabaseRepository(chatRpcClient(rpc))

    await expect(repository.startDirectChat(USER_ID, RECIPIENT_ID))
      .resolves.toEqual(directChannel)
    expect(rpc).toHaveBeenCalledWith('chat_start_direct', {
      p_user_id: USER_ID,
      p_recipient_id: RECIPIENT_ID,
    })
  })

  it('surfaces the server-side Founder upgrade eligibility rejection', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: 'P0001',
        details: null,
        hint: null,
        message: 'founder upgrade requires pro lifetime',
      },
    }))
    const repository = new SupabaseRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.createPendingMercadoPagoPayment(
      USER_ID,
      'FOUNDER_UPGRADE',
      'upgrade-request',
    )).rejects.toMatchObject({
      status: 409,
      code: 'founder_upgrade_ineligible',
      message: 'O upgrade Founder requer uma compra PRO Lifetime ativa.',
    })

    expect(rpc).toHaveBeenCalledWith('create_pending_mercadopago_payment', {
      p_user_id: USER_ID,
      p_product_code: 'FOUNDER_UPGRADE',
      p_request_key: 'upgrade-request',
    })
  })

  it('creates and attaches Mercado Pago card checkouts through protected RPCs', async () => {
    const pending = { id: PAYMENT_ID, provider: 'mercadopago', amount: 155.88 }
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: pending, error: null })
      .mockResolvedValueOnce({
        data: { ...pending, raw_status: 'preference_created' },
        error: null,
      })
    const repository = new SupabaseRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.createPendingMercadoPagoCardPayment(
      USER_ID,
      'PRO_LIFETIME',
      'card-request',
      20,
    )).resolves.toEqual(pending)
    expect(rpc).toHaveBeenNthCalledWith(1, 'create_pending_mercadopago_card_payment', {
      p_user_id: USER_ID,
      p_product_code: 'PRO_LIFETIME',
      p_request_key: 'card-request',
      p_processing_fee_percent: 20,
    })

    await repository.attachMercadoPagoCheckout(
      USER_ID,
      PAYMENT_ID,
      'preference-altgrid',
      '2026-09-06T12:30:00.000Z',
      'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=altgrid',
    )
    expect(rpc).toHaveBeenNthCalledWith(2, 'attach_mercadopago_checkout', {
      p_user_id: USER_ID,
      p_payment_id: PAYMENT_ID,
      p_preference_id: 'preference-altgrid',
      p_expires_at: '2026-09-06T12:30:00.000Z',
      p_checkout_url: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=altgrid',
    })
  })

  it('surfaces the previous lifetime plan requirement for new upgrades', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: 'P0001',
        details: null,
        hint: null,
        message: 'lifetime upgrade requires the previous lifetime plan',
      },
    }))
    const repository = new SupabaseRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.createPendingMercadoPagoPayment(
      USER_ID,
      'PRO_PLUS_UPGRADE',
      'upgrade-plus-request',
    )).rejects.toMatchObject({
      status: 409,
      code: 'lifetime_upgrade_ineligible',
    })
  })
})
