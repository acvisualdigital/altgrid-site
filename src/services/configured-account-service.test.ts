import { describe, expect, it } from 'vitest'

import {
  CUSTOM_GAME_SLUG,
  ConfiguredAccountService,
} from './configured-account-service'
import { PermissionService } from './permission-service'
import type { ResolvedEntitlements } from '../types/backend-api'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

class FailingWriteStorage extends MemoryStorage {
  failWrites = false

  override setItem(key: string, value: string): void {
    if (this.failWrites) {
      throw new Error('storage denied')
    }

    super.setItem(key, value)
  }
}

const free: ResolvedEntitlements = {
  account_limit: 2,
  expires_at: null,
  features: {},
  founder_number: null,
  lifetime: false,
  plan: 'FREE',
}

describe('ConfiguredAccountService', () => {
  it('keeps every configured account even when the simultaneous limit is lower', async () => {
    let nextId = 0
    const accounts = new ConfiguredAccountService({
      createId: () => 'account-' + ++nextId,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
      storage: new MemoryStorage(),
    })
    const permissions = new PermissionService(free)
    const userId = '00000000-0000-4000-8000-000000000001'

    for (let index = 1; index <= 20; index += 1) {
      accounts.add(userId, {
        displayName: 'Conta ' + index,
        gameSlug: 'huntera',
      })
    }

    const configured = accounts.list(userId)
    expect(configured).toHaveLength(20)
    await permissions.openSession(configured[0]!.id, () => undefined)
    await permissions.openSession(configured[1]!.id, () => undefined)
    await expect(
      permissions.openSession(configured[2]!.id, () => undefined),
    ).resolves.toBe('limit_reached')
    expect(accounts.list(userId)).toHaveLength(20)
  })

  it('isolates saved configurations by authenticated user', () => {
    const storage = new MemoryStorage()
    const service = new ConfiguredAccountService({
      createId: () => 'account-1',
      storage,
    })

    service.add('user-a', { displayName: 'Conta A', gameSlug: 'tibia' })

    expect(service.list('user-a')).toHaveLength(1)
    expect(service.list('user-b')).toEqual([])
    expect(new ConfiguredAccountService({ storage }).list('user-a')).toHaveLength(
      1,
    )
  })

  it('renames only the requested user account and persists it in legacy storage', () => {
    const storage = new MemoryStorage()
    let nextId = 0
    const service = new ConfiguredAccountService({
      createId: () => 'account-' + ++nextId,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
      storage,
    })
    const userAAccount = service.add('user-a', {
      displayName: 'Conta original',
      gameSlug: 'huntera',
    })
    const userBAccount = service.add('user-b', {
      displayName: 'Conta de outro usuario',
      gameSlug: 'tibia',
    })

    expect(service.rename('user-a', userAAccount.id, '  Conta principal  ')).toEqual({
      ...userAAccount,
      displayName: 'Conta principal',
    })
    expect(service.list('user-b')).toEqual([userBAccount])

    const restored = new ConfiguredAccountService({ storage })
    expect(restored.list('user-a')).toEqual([
      { ...userAAccount, displayName: 'Conta principal' },
    ])
    expect(storage.getItem('hunterafarm.configured-accounts.v1:user-a')).not.toBeNull()
  })

  it('does not mutate accounts for invalid renames and removes only the explicit target', () => {
    const storage = new MemoryStorage()
    let nextId = 0
    const service = new ConfiguredAccountService({
      createId: () => 'account-' + ++nextId,
      storage,
    })
    const first = service.add('user-a', {
      displayName: 'Conta 1',
      gameSlug: 'huntera',
    })
    const second = service.add('user-a', {
      displayName: 'Conta 2',
      gameSlug: 'tibia',
    })
    const otherUser = service.add('user-b', {
      displayName: 'Conta B',
      gameSlug: 'huntera',
    })

    expect(service.rename('user-a', first.id, '   ')).toBeNull()
    expect(service.rename('user-a', 'missing', 'Novo nome')).toBeNull()
    expect(service.list('user-a')).toEqual([first, second])
    expect(service.remove('user-a', 'missing')).toBe(false)
    expect(service.remove('user-a', first.id)).toBe(true)
    expect(service.remove('user-a', first.id)).toBe(false)

    expect(new ConfiguredAccountService({ storage }).list('user-a')).toEqual([
      second,
    ])
    expect(service.list('user-b')).toEqual([otherUser])
  })

  it('keeps the current run consistent when persistent storage starts rejecting writes', () => {
    const storage = new FailingWriteStorage()
    const service = new ConfiguredAccountService({
      createId: () => 'account-1',
      storage,
    })
    const account = service.add('user-a', {
      displayName: 'Conta antiga',
      gameSlug: 'huntera',
    })
    storage.failWrites = true

    service.rename('user-a', account.id, 'Conta atualizada')

    expect(service.list('user-a')[0]?.displayName).toBe('Conta atualizada')
  })

  it('persists a custom launch URL without invalidating legacy accounts', () => {
    const storage = new MemoryStorage()
    const service = new ConfiguredAccountService({
      createId: () => 'custom-account',
      storage,
    })

    const saved = service.add('user-a', {
      customLaunchUrl: '  https://custom.example.com/play  ',
      displayName: 'Conta personalizada',
      gameSlug: CUSTOM_GAME_SLUG,
    })

    expect(saved.customLaunchUrl).toBe('https://custom.example.com/play')
    expect(new ConfiguredAccountService({ storage }).list('user-a')).toEqual([
      saved,
    ])

    storage.setItem('hunterafarm.configured-accounts.v1:user-b', JSON.stringify([{
      createdAt: '2026-08-25T12:00:00.000Z',
      displayName: 'Conta antiga',
      gameSlug: 'huntera',
      id: 'legacy-account',
    }]))
    expect(new ConfiguredAccountService({ storage }).list('user-b')).toEqual([{
      createdAt: '2026-08-25T12:00:00.000Z',
      displayName: 'Conta antiga',
      gameSlug: 'huntera',
      id: 'legacy-account',
    }])
  })

  it('persists the AltGrid Bot preference only on the requested account', () => {
    const storage = new MemoryStorage()
    let nextId = 0
    const service = new ConfiguredAccountService({
      createId: () => 'account-' + ++nextId,
      storage,
    })
    const first = service.add('user-a', {
      displayName: 'Stonegy 1',
      gameSlug: 'stonegy',
    })
    const second = service.add('user-a', {
      displayName: 'Stonegy 2',
      gameSlug: 'stonegy',
    })

    expect(service.setStonegyBotEnabled('user-a', first.id, true))
      .toMatchObject({ id: first.id, stonegyBotEnabled: true })
    expect(service.list('user-a')).toEqual([
      { ...first, stonegyBotEnabled: true },
      second,
    ])
    expect(new ConfiguredAccountService({ storage }).list('user-a')[0])
      .toMatchObject({ id: first.id, stonegyBotEnabled: true })
    expect(service.setStonegyBotEnabled('user-a', 'missing', true)).toBeNull()
  })
})
