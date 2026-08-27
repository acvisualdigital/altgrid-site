import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { SupabaseRepository } from './supabase-repository'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const CHANNEL_ID = '10000000-0000-4000-8000-000000000001'

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

  it('records presence with the authenticated user id only', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    const repository = new SupabaseRepository({ rpc } as unknown as SupabaseClient)

    await repository.heartbeatPresence(USER_ID)

    expect(rpc).toHaveBeenCalledWith('record_presence', {
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
    const repository = new SupabaseRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.sendChatMessage(USER_ID, CHANNEL_ID, 'Olá'))
      .resolves.toEqual(serverMessage)
    expect(rpc).toHaveBeenCalledWith('chat_send_message', {
      p_user_id: USER_ID,
      p_channel_id: CHANNEL_ID,
      p_message: 'Olá',
    })
  })
})
