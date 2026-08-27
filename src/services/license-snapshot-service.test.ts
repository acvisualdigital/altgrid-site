import { beforeAll, describe, expect, it, vi } from 'vitest'

import type {
  LicenseSnapshotPayload,
  LicenseSnapshotResponse,
  SignedLicenseSnapshot,
} from '../types/backend-api'
import {
  OfflineLicenseService,
  type LicenseSnapshotStorage,
} from './license-snapshot-service'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002'
const KEY_ID = 'test-license-v1'
const NOW = new Date('2026-08-25T12:00:00.000Z')

class MemoryStorage implements LicenseSnapshotStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

let privateKey: CryptoKey
let publicKeySpki: string
let cacheSequence = 0

function standardBase64(buffer: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function cacheKey(label: string): string {
  cacheSequence += 1
  return `test.license.${label}.${cacheSequence}`
}

function payload(
  overrides: Partial<LicenseSnapshotPayload> = {},
): LicenseSnapshotPayload {
  return {
    account_limit: 10,
    expires_at: '2026-08-30T12:00:00.000Z',
    features: { advanced_grids: true, basic_grids: true },
    founder_number: null,
    issued_at: NOW.toISOString(),
    lifetime: false,
    plan: 'PRO',
    user_id: USER_ID,
    ...overrides,
  }
}

async function sign(
  claims: LicenseSnapshotPayload,
  overrides: Partial<SignedLicenseSnapshot> = {},
): Promise<LicenseSnapshotResponse> {
  const bytes = new TextEncoder().encode(JSON.stringify(claims))
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    bytes.buffer as ArrayBuffer,
  )
  return {
    snapshot: {
      alg: 'EdDSA',
      key_id: KEY_ID,
      payload: base64Url(bytes),
      signature: base64Url(new Uint8Array(signature)),
      ...overrides,
    },
  }
}

function service(options: {
  cacheKey?: string
  loader: () => Promise<LicenseSnapshotResponse>
  now?: () => Date
  storage?: LicenseSnapshotStorage | null
  publicKey?: string
  keyId?: string
}): OfflineLicenseService {
  return new OfflineLicenseService({
    cacheKey: options.cacheKey ?? cacheKey('default'),
    loader: options.loader,
    now: options.now ?? (() => NOW),
    publicKeys: [{
      keyId: options.keyId ?? KEY_ID,
      spki: options.publicKey ?? publicKeySpki,
    }],
    storage: options.storage ?? new MemoryStorage(),
  })
}

beforeAll(async () => {
  const keys = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  privateKey = keys.privateKey
  publicKeySpki = standardBase64(
    await crypto.subtle.exportKey('spki', keys.publicKey),
  )
})

describe('OfflineLicenseService', () => {
  it('verifies a fresh Ed25519 snapshot before exposing entitlements', async () => {
    const response = await sign(payload())
    const loader = vi.fn(async () => response)
    const licenses = service({ loader })

    await expect(licenses.loadEntitlements(USER_ID)).resolves.toEqual({
      entitlements: {
        account_limit: 10,
        expires_at: '2026-08-30T12:00:00.000Z',
        features: { advanced_grids: true, basic_grids: true },
        founder_number: null,
        lifetime: false,
        plan: 'PRO',
      },
      source: 'network',
    })
    expect(loader).toHaveBeenCalledOnce()
  })

  it('reverifies and restores the signed cache when the API is offline', async () => {
    const storage = new MemoryStorage()
    const key = cacheKey('offline')
    const initial = service({
      cacheKey: key,
      loader: async () => sign(payload()),
      storage,
    })
    await initial.loadEntitlements(USER_ID)

    const offline = service({
      cacheKey: key,
      loader: async () => {
        throw new Error('offline')
      },
      storage,
    })

    await expect(offline.loadEntitlements(USER_ID)).resolves.toMatchObject({
      entitlements: { account_limit: 10, plan: 'PRO' },
      source: 'cache',
    })
  })

  it('accepts signed offline snapshots for the PLUS plan', async () => {
    const response = await sign(payload({
      account_limit: 10,
      plan: 'PRO_PLUS',
    }))

    await expect(service({ loader: async () => response }).loadEntitlements(USER_ID))
      .resolves.toMatchObject({
        entitlements: { account_limit: 10, plan: 'PRO_PLUS' },
        source: 'network',
      })
  })

  it('removes a cached snapshot after its signed expiration', async () => {
    const storage = new MemoryStorage()
    const key = cacheKey('expired-cache')
    let now = NOW
    const initial = service({
      cacheKey: key,
      loader: async () => sign(payload({
        expires_at: '2026-08-26T12:00:00.000Z',
      })),
      now: () => now,
      storage,
    })
    await initial.loadEntitlements(USER_ID)
    now = new Date('2026-08-26T12:00:00.001Z')

    const offline = service({
      cacheKey: key,
      loader: async () => {
        throw new Error('offline')
      },
      now: () => now,
      storage,
    })
    await expect(offline.loadEntitlements(USER_ID)).resolves.toMatchObject({
      entitlements: { account_limit: 2, plan: 'FREE' },
      source: 'safe_free',
    })
    expect(storage.values.size).toBe(0)
  })

  it('falls back to the minimal FREE policy for tampering or an unknown key', async () => {
    const response = await sign(payload())
    response.snapshot.payload = response.snapshot.payload.slice(0, -1)
      + (response.snapshot.payload.endsWith('A') ? 'B' : 'A')
    const tampered = service({ loader: async () => response })

    await expect(tampered.loadEntitlements(USER_ID)).resolves.toEqual({
      entitlements: {
        account_limit: 2,
        expires_at: null,
        features: {},
        founder_number: null,
        lifetime: false,
        plan: 'FREE',
      },
      source: 'safe_free',
    })

    const validButUnknown = await sign(payload(), { key_id: 'unknown-key' })
    const unknownKey = service({ loader: async () => validButUnknown })
    await expect(unknownKey.loadEntitlements(USER_ID)).resolves.toMatchObject({
      entitlements: { account_limit: 2, plan: 'FREE' },
      source: 'safe_free',
    })
  })

  it('rejects valid signatures bound to another user', async () => {
    const response = await sign(payload({ user_id: OTHER_USER_ID }))
    const licenses = service({ loader: async () => response })

    await expect(licenses.loadEntitlements(USER_ID)).resolves.toMatchObject({
      entitlements: { account_limit: 2, plan: 'FREE' },
      source: 'safe_free',
    })
  })

  it('rejects expired, future-issued, and overlong snapshots', async () => {
    const expired = service({
      loader: async () => sign(payload({
        expires_at: '2026-08-25T11:59:59.999Z',
        issued_at: '2026-08-24T12:00:00.000Z',
      })),
    })
    const future = service({
      loader: async () => sign(payload({
        expires_at: '2026-08-31T13:00:00.000Z',
        issued_at: '2026-08-25T13:00:00.000Z',
      })),
    })
    const overlong = service({
      loader: async () => sign(payload({
        expires_at: '2026-09-01T12:00:00.001Z',
      })),
    })

    for (const licenses of [expired, future, overlong]) {
      await expect(licenses.loadEntitlements(USER_ID)).resolves.toMatchObject({
        entitlements: { plan: 'FREE' },
        source: 'safe_free',
      })
    }
  })

  it('replaces a cached paid snapshot with an authoritative signed downgrade', async () => {
    const storage = new MemoryStorage()
    const key = cacheKey('downgrade')
    let response = await sign(payload())
    const licenses = service({
      cacheKey: key,
      loader: async () => response,
      storage,
    })
    await expect(licenses.loadEntitlements(USER_ID)).resolves.toMatchObject({
      entitlements: { plan: 'PRO' },
    })

    response = await sign(payload({
      account_limit: 2,
      expires_at: '2026-08-26T12:00:00.000Z',
      features: { basic_grids: true },
      plan: 'FREE',
    }))
    await expect(licenses.loadEntitlements(USER_ID)).resolves.toMatchObject({
      entitlements: { account_limit: 2, plan: 'FREE' },
      source: 'network',
    })

    const offline = service({
      cacheKey: key,
      loader: async () => {
        throw new Error('offline')
      },
      storage,
    })
    await expect(offline.loadEntitlements(USER_ID)).resolves.toMatchObject({
      entitlements: { account_limit: 2, plan: 'FREE' },
      source: 'cache',
    })
  })

  it('does not trust a manually injected decoded entitlement cache', async () => {
    const storage = new MemoryStorage()
    const key = cacheKey('forged-cache')
    storage.setItem(`${key}:${encodeURIComponent(USER_ID)}`, JSON.stringify({
      entitlements: { account_limit: 999, plan: 'FOUNDER' },
      version: 1,
    }))
    const licenses = service({
      cacheKey: key,
      loader: async () => {
        throw new Error('offline')
      },
      storage,
    })

    await expect(licenses.loadEntitlements(USER_ID)).resolves.toMatchObject({
      entitlements: { account_limit: 2, plan: 'FREE' },
      source: 'safe_free',
    })
    expect(storage.values.size).toBe(0)
  })

  it('deduplicates concurrent snapshot loads for the same user', async () => {
    let resolveLoad!: (value: LicenseSnapshotResponse) => void
    const loader = vi.fn(() => new Promise<LicenseSnapshotResponse>((resolve) => {
      resolveLoad = resolve
    }))
    const licenses = service({ loader })
    const first = licenses.loadEntitlements(USER_ID)
    const second = licenses.loadEntitlements(USER_ID)

    expect(first).toBe(second)
    expect(loader).toHaveBeenCalledOnce()
    resolveLoad(await sign(payload()))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it('can propagate terminal authentication failures instead of masking them', async () => {
    const unauthorized = { code: 'authentication_required', status: 401 }
    const licenses = new OfflineLicenseService({
      cacheKey: cacheKey('unauthorized'),
      loader: async () => {
        throw unauthorized
      },
      now: () => NOW,
      publicKeys: [{ keyId: KEY_ID, spki: publicKeySpki }],
      shouldUseCacheOnLoadError: (error) => (
        (error as { status?: number }).status !== 401
      ),
      storage: new MemoryStorage(),
    })

    await expect(licenses.loadEntitlements(USER_ID)).rejects.toBe(unauthorized)
  })
})
