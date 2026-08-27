import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '../../src/types/database'
import { SupabaseAuthenticationService } from './authentication-service'

describe('SupabaseAuthenticationService', () => {
  it('passes only the Bearer token to the official getUser validation call', async () => {
    const getUser = vi.fn(async () => ({
      data: {
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'hunter@example.com',
          email_confirmed_at: '2026-08-25T10:05:00.000Z',
          created_at: '2026-08-25T10:00:00.000Z',
          last_sign_in_at: null,
        },
      },
      error: null,
    }))
    const client = {
      auth: { getUser },
    } as unknown as SupabaseClient<Database>
    const service = new SupabaseAuthenticationService(client)

    const result = await service.authenticate(new Request('https://api.example.com/v1/me', {
      headers: { Authorization: 'Bearer signed-user-token' },
    }))

    expect(getUser).toHaveBeenCalledWith('signed-user-token')
    expect(result).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      email: 'hunter@example.com',
      email_confirmed_at: '2026-08-25T10:05:00.000Z',
      created_at: '2026-08-25T10:00:00.000Z',
      last_sign_in_at: null,
    })
  })

  it('does not misclassify an Auth network failure as an invalid token', async () => {
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { message: 'fetch failed' },
        })),
      },
    } as unknown as SupabaseClient<Database>
    const service = new SupabaseAuthenticationService(client)

    await expect(service.authenticate(new Request('https://api.example.com/v1/me', {
      headers: { Authorization: 'Bearer still-valid-token' },
    }))).rejects.toMatchObject({
      status: 500,
      code: 'auth_unavailable',
    })
  })
})
