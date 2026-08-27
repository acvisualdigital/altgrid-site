import { describe, expect, it, vi } from 'vitest'

import {
  GamePresetService,
  GamePresetServiceError,
  normalizeSafeGameUrl,
  validateSafeGameUrl,
  type GamePresetStorage,
} from './game-preset-service'
import type { PublicGame, PublicGamesResponse } from '../types/backend-api'

class MemoryStorage implements GamePresetStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  peek(key: string): string | null {
    return this.values.get(key) ?? null
  }
}

class DeniedStorage implements GamePresetStorage {
  getItem(): string | null {
    throw new Error('storage denied')
  }

  setItem(): void {
    throw new Error('storage denied')
  }
}

let cacheSequence = 0

function cacheKey(label: string): string {
  cacheSequence += 1
  return `test.game-presets.${label}.${cacheSequence}`
}

function game(overrides: Partial<PublicGame> = {}): PublicGame {
  return {
    developer_referral_url: null,
    icon_url: null,
    id: 'game-huntera',
    launch_url: 'https://play.example.com/huntera',
    metadata: { category: 'mmorpg', nested: { region: 'br' } },
    name: 'Huntera',
    slug: 'huntera',
    sort_order: 10,
    ...overrides,
  }
}

function response(games: PublicGame[]): PublicGamesResponse {
  return { games }
}

describe('safe game URL policy', () => {
  it('accepts HTTPS and only loopback HTTP endpoints', () => {
    expect(normalizeSafeGameUrl(' https://games.example.com/play?q=1 ')).toBe(
      'https://games.example.com/play?q=1',
    )
    expect(normalizeSafeGameUrl('http://localhost:3000/game')).toBe(
      'http://localhost:3000/game',
    )
    expect(normalizeSafeGameUrl('http://dev.localhost/game')).toBe(
      'http://dev.localhost/game',
    )
    expect(normalizeSafeGameUrl('http://127.9.8.7/game')).toBe(
      'http://127.9.8.7/game',
    )
    expect(normalizeSafeGameUrl('http://[::1]:4173/game')).toBe(
      'http://[::1]:4173/game',
    )
  })

  it('blocks remote HTTP, unsafe schemes, credentials, and malformed URLs', () => {
    expect(validateSafeGameUrl('http://games.example.com')).toMatchObject({
      code: 'insecure_http',
      ok: false,
    })
    expect(validateSafeGameUrl('javascript:alert(1)')).toMatchObject({
      code: 'unsupported_protocol',
      ok: false,
    })
    expect(normalizeSafeGameUrl('data:text/html,hello')).toBeNull()
    expect(normalizeSafeGameUrl('file:///C:/game.html')).toBeNull()
    expect(normalizeSafeGameUrl('ftp://games.example.com')).toBeNull()
    expect(validateSafeGameUrl('https://user:secret@example.com')).toMatchObject({
      code: 'credentials_not_allowed',
      ok: false,
    })
    expect(normalizeSafeGameUrl('not a url')).toBeNull()
    expect(normalizeSafeGameUrl('https://exam\nple.com')).toBeNull()
  })
})

describe('GamePresetService', () => {
  it('validates, sorts, and deduplicates remote presets deterministically', async () => {
    const duplicateLater = game({
      id: 'duplicate-later',
      name: 'Zeta duplicate',
      sort_order: 50,
    })
    const duplicateFirst = game({
      id: 'duplicate-first',
      name: 'Alpha duplicate',
      sort_order: 2,
    })
    const second = game({
      developer_referral_url: 'https://ref.example.com/create',
      icon_url: 'https://cdn.example.com/game.png',
      id: 'game-two',
      metadata: { modes: ['pvp', 'pve'], promoted: true },
      name: 'Jogo 2',
      slug: 'game-two',
      sort_order: 1,
    })
    const service = new GamePresetService({
      cacheKey: cacheKey('sort'),
      loader: async () => response([duplicateLater, second, duplicateFirst]),
      storage: new MemoryStorage(),
    })

    const games = await service.loadGames()

    expect(games.map((preset) => preset.id)).toEqual([
      'game-two',
      'duplicate-first',
    ])
    expect(games[0]).toMatchObject({
      developer_referral_url: 'https://ref.example.com/create',
      icon_url: 'https://cdn.example.com/game.png',
      metadata: { modes: ['pvp', 'pve'], promoted: true },
    })
  })

  it('keeps games without referral and nulls unsafe optional URLs', async () => {
    const service = new GamePresetService({
      cacheKey: cacheKey('optional-urls'),
      loader: async () => response([
        game({
          developer_referral_url: 'javascript:alert(1)',
          icon_url: 'data:image/svg+xml,unsafe',
        }),
        game({
          developer_referral_url: null,
          id: 'without-referral',
          slug: 'without-referral',
          sort_order: 20,
        }),
      ]),
      storage: new MemoryStorage(),
    })

    const games = await service.loadGames()

    expect(games).toHaveLength(2)
    expect(games[0]).toMatchObject({
      developer_referral_url: null,
      icon_url: null,
    })
    expect(games[1]?.developer_referral_url).toBeNull()
  })

  it('excludes invalid launch URLs and explicitly disabled games', async () => {
    const service = new GamePresetService({
      cacheKey: cacheKey('filtered'),
      loader: async () => response([
        game({ id: 'unsafe', launch_url: 'file:///game', slug: 'unsafe' }),
        game({ enabled: false, id: 'disabled', slug: 'disabled' }),
        game({ id: 'valid', slug: 'valid' }),
      ]),
      storage: new MemoryStorage(),
    })

    await expect(service.loadGames()).resolves.toMatchObject([
      { id: 'valid' },
    ])
  })

  it('restores the last valid catalog from persistent cache when offline', async () => {
    const storage = new MemoryStorage()
    const key = cacheKey('persistent')
    const initial = new GamePresetService({
      cacheKey: key,
      loader: async () => response([game()]),
      storage,
    })
    await initial.loadGames()
    expect(storage.peek(key)).toContain('game-huntera')

    const offline = new GamePresetService({
      cacheKey: key,
      loader: async () => {
        throw new Error('offline')
      },
      storage,
    })

    await expect(offline.loadGames()).resolves.toMatchObject([
      { id: 'game-huntera', metadata: { category: 'mmorpg' } },
    ])
  })

  it('shares the in-memory fallback when persistent storage is denied', async () => {
    const key = cacheKey('memory')
    const initial = new GamePresetService({
      cacheKey: key,
      loader: async () => response([game()]),
      storage: new DeniedStorage(),
    })
    await initial.loadGames()

    const offline = new GamePresetService({
      cacheKey: key,
      loader: async () => {
        throw new Error('offline')
      },
      storage: new DeniedStorage(),
    })

    await expect(offline.loadGames()).resolves.toHaveLength(1)
  })

  it('does not replace valid cache with a wholly invalid enabled response', async () => {
    const storage = new MemoryStorage()
    const key = cacheKey('invalid-update')
    let current: PublicGamesResponse = response([game()])
    const service = new GamePresetService({
      cacheKey: key,
      loader: async () => current,
      storage,
    })
    await service.loadGames()
    current = response([
      game({ id: 'unsafe', launch_url: 'javascript:alert(1)', slug: 'unsafe' }),
    ])

    await expect(service.loadGames()).resolves.toMatchObject([
      { id: 'game-huntera' },
    ])

    const restored = new GamePresetService({
      cacheKey: key,
      loader: async () => {
        throw new Error('offline')
      },
      storage,
    })
    await expect(restored.loadGames()).resolves.toMatchObject([
      { id: 'game-huntera' },
    ])
  })

  it('lets an empty or fully disabled remote catalog clear old cache', async () => {
    const storage = new MemoryStorage()
    const emptyKey = cacheKey('empty-clear')
    let emptyResponse = response([game()])
    const emptyService = new GamePresetService({
      cacheKey: emptyKey,
      loader: async () => emptyResponse,
      storage,
    })
    await emptyService.loadGames()
    emptyResponse = response([])
    await expect(emptyService.loadGames()).resolves.toEqual([])

    const disabledKey = cacheKey('disabled-clear')
    let disabledResponse = response([game()])
    const disabledService = new GamePresetService({
      cacheKey: disabledKey,
      loader: async () => disabledResponse,
      storage,
    })
    await disabledService.loadGames()
    disabledResponse = response([game({ enabled: false })])
    await expect(disabledService.loadGames()).resolves.toEqual([])

    const offlineAfterEmpty = new GamePresetService({
      cacheKey: emptyKey,
      loader: async () => {
        throw new Error('offline')
      },
      storage,
    })
    const offlineAfterDisabled = new GamePresetService({
      cacheKey: disabledKey,
      loader: async () => {
        throw new Error('offline')
      },
      storage,
    })
    await expect(offlineAfterEmpty.loadGames()).resolves.toEqual([])
    await expect(offlineAfterDisabled.loadGames()).resolves.toEqual([])
  })

  it('surfaces an invalid enabled response when there is no cache', async () => {
    const service = new GamePresetService({
      cacheKey: cacheKey('invalid-no-cache'),
      loader: async () => response([
        game({ launch_url: 'data:text/html,unsafe' }),
      ]),
      storage: new MemoryStorage(),
    })

    await expect(service.loadGames()).rejects.toEqual(
      new GamePresetServiceError('invalid_games_response'),
    )
  })

  it('deduplicates concurrent loads', async () => {
    let resolveLoad: ((value: PublicGamesResponse) => void) | undefined
    const loader = vi.fn(() => new Promise<PublicGamesResponse>((resolve) => {
      resolveLoad = resolve
    }))
    const service = new GamePresetService({
      cacheKey: cacheKey('concurrent'),
      loader,
      storage: new MemoryStorage(),
    })

    const first = service.loadGames()
    const second = service.loadGames()
    expect(first).toBe(second)
    expect(loader).toHaveBeenCalledTimes(1)

    resolveLoad?.(response([game()]))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })
})
