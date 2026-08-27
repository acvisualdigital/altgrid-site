import type {
  LicenseSnapshotPayload,
  LicenseSnapshotResponse,
  ResolvedEntitlements,
  SignedLicenseSnapshot,
} from '../types/backend-api'
import { UNLIMITED_ACCOUNT_LIMIT } from '../types/backend-api'
import type { PlanCode } from '../types/database'
import type { BackendApi } from './backend-api'

const CACHE_VERSION = 1
const DEFAULT_CACHE_KEY = 'altgrid.license-snapshot.v1'
const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1_000
const DEFAULT_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_ACCOUNT_LIMIT = UNLIMITED_ACCOUNT_LIMIT
const MAX_FEATURE_COUNT = 256
const MAX_PAYLOAD_BYTES = 16 * 1_024
const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const PLAN_CODES = new Set<PlanCode>(['FREE', 'PRO', 'PRO_PLUS', 'FOUNDER'])

// Shared only inside the renderer process. Persistent values and memory values
// are both reverified before they can grant an entitlement.
const memoryCache = new Map<string, string>()

export interface LicenseSnapshotStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface EmbeddedLicensePublicKey {
  keyId: string
  /** X.509 SubjectPublicKeyInfo (SPKI), encoded as base64 or PEM. */
  spki: string
}

export interface OfflineLicenseServiceOptions {
  loader: () => Promise<LicenseSnapshotResponse>
  publicKeys: readonly EmbeddedLicensePublicKey[]
  storage?: LicenseSnapshotStorage | null
  cacheKey?: string
  crypto?: Pick<Crypto, 'subtle'> | null
  now?: () => Date
  clockSkewMs?: number
  maxLifetimeMs?: number
  /** Return false for terminal errors (for example, an authoritative 401). */
  shouldUseCacheOnLoadError?: (error: unknown) => boolean
}

export type OfflineLicenseSource = 'network' | 'cache' | 'safe_free'

export interface OfflineLicenseResolution {
  entitlements: ResolvedEntitlements
  source: OfflineLicenseSource
}

interface CacheEnvelope {
  version: typeof CACHE_VERSION
  snapshot: SignedLicenseSnapshot
}

const SAFE_FREE_ENTITLEMENTS: ResolvedEntitlements = {
  account_limit: 2,
  expires_at: null,
  features: {},
  founder_number: null,
  lifetime: false,
  plan: 'FREE',
}

function safeFreeResolution(): OfflineLicenseResolution {
  return {
    entitlements: cloneEntitlements(SAFE_FREE_ENTITLEMENTS),
    source: 'safe_free',
  }
}

function cloneEntitlements(value: ResolvedEntitlements): ResolvedEntitlements {
  return { ...value, features: { ...value.features } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: unknown, maximumBytes: number): Uint8Array | null {
  if (
    typeof value !== 'string'
    || !value
    || value.length > Math.ceil(maximumBytes * 4 / 3)
    || !/^[A-Za-z0-9_-]+$/.test(value)
    || value.length % 4 === 1
  ) {
    return null
  }

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = atob(normalized)
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    )
    return bytes.length <= maximumBytes && base64Url(bytes) === value
      ? bytes
      : null
  } catch {
    return null
  }
}

function decodeSpki(value: string): Uint8Array | null {
  let normalized = value.trim()
  const hasBegin = normalized.includes('-----BEGIN PUBLIC KEY-----')
  const hasEnd = normalized.includes('-----END PUBLIC KEY-----')

  if (hasBegin !== hasEnd) {
    return null
  }

  if (hasBegin) {
    if (
      !normalized.startsWith('-----BEGIN PUBLIC KEY-----')
      || !normalized.endsWith('-----END PUBLIC KEY-----')
    ) {
      return null
    }
    normalized = normalized
      .slice('-----BEGIN PUBLIC KEY-----'.length)
      .slice(0, -'-----END PUBLIC KEY-----'.length)
  }

  normalized = normalized.replace(/\s+/g, '')
  if (
    !normalized
    || normalized.length > 8_192
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
    || normalized.length % 4 === 1
  ) {
    return null
  }

  try {
    const binary = atob(normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      '=',
    ))
    return Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    )
  } catch {
    return null
  }
}

function canonicalTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null
}

function normalizePayload(
  value: unknown,
  expectedUserId: string,
  now: number,
  clockSkewMs: number,
  maxLifetimeMs: number,
): LicenseSnapshotPayload | null {
  if (!isRecord(value)) {
    return null
  }

  const issuedAt = canonicalTimestamp(value.issued_at)
  const expiresAt = canonicalTimestamp(value.expires_at)

  if (
    value.user_id !== expectedUserId
    || typeof value.plan !== 'string'
    || !PLAN_CODES.has(value.plan as PlanCode)
    || !Number.isSafeInteger(value.account_limit)
    || (value.account_limit as number) < 1
    || (value.account_limit as number) > MAX_ACCOUNT_LIMIT
    || typeof value.lifetime !== 'boolean'
    || !(
      value.founder_number === null
      || (
        Number.isSafeInteger(value.founder_number)
        && (value.founder_number as number) > 0
      )
    )
    || issuedAt === null
    || expiresAt === null
    || issuedAt > now + clockSkewMs
    || expiresAt <= now
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > maxLifetimeMs
    || !isRecord(value.features)
  ) {
    return null
  }

  const featureEntries = Object.entries(value.features)
  if (
    featureEntries.length > MAX_FEATURE_COUNT
    || featureEntries.some(([key, enabled]) => (
      !FEATURE_KEY_PATTERN.test(key) || typeof enabled !== 'boolean'
    ))
  ) {
    return null
  }

  const features: Record<string, boolean> = {}
  for (const [key, enabled] of featureEntries) {
    features[key] = enabled as boolean
  }

  return {
    account_limit: value.account_limit as number,
    expires_at: value.expires_at as string,
    features,
    founder_number: value.founder_number as number | null,
    issued_at: value.issued_at as string,
    lifetime: value.lifetime,
    plan: value.plan as PlanCode,
    user_id: expectedUserId,
  }
}

function payloadToEntitlements(
  payload: LicenseSnapshotPayload,
): ResolvedEntitlements {
  return {
    account_limit: payload.account_limit,
    expires_at: payload.expires_at,
    features: { ...payload.features },
    founder_number: payload.founder_number,
    lifetime: payload.lifetime,
    plan: payload.plan,
  }
}

function browserStorage(): LicenseSnapshotStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function snapshotFromResponse(value: unknown): SignedLicenseSnapshot | null {
  if (!isRecord(value) || !isRecord(value.snapshot)) {
    return null
  }

  const snapshot = value.snapshot
  return (
    typeof snapshot.payload === 'string'
    && typeof snapshot.signature === 'string'
    && snapshot.alg === 'EdDSA'
    && typeof snapshot.key_id === 'string'
  )
    ? {
        alg: 'EdDSA',
        key_id: snapshot.key_id,
        payload: snapshot.payload,
        signature: snapshot.signature,
      }
    : null
}

/**
 * Verifies, caches, and resolves bounded offline entitlements. No decoded
 * entitlement is trusted from storage; the signed bytes are checked every time.
 */
export class OfflineLicenseService {
  private readonly cacheKey: string
  private readonly clockSkewMs: number
  private readonly crypto: Pick<Crypto, 'subtle'> | null
  private readonly loader: () => Promise<LicenseSnapshotResponse>
  private readonly maxLifetimeMs: number
  private readonly now: () => Date
  private readonly publicKeys = new Map<string, string>()
  private readonly shouldUseCacheOnLoadError: (error: unknown) => boolean
  private readonly storage: LicenseSnapshotStorage | null
  private readonly importedKeys = new Map<string, Promise<CryptoKey>>()
  private readonly inFlight = new Map<string, Promise<OfflineLicenseResolution>>()

  constructor(options: OfflineLicenseServiceOptions) {
    this.cacheKey = options.cacheKey ?? DEFAULT_CACHE_KEY
    this.clockSkewMs = Math.max(0, options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS)
    this.crypto = options.crypto === undefined
      ? globalThis.crypto ?? null
      : options.crypto
    this.loader = options.loader
    this.maxLifetimeMs = Math.max(
      1,
      options.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS,
    )
    this.now = options.now ?? (() => new Date())
    this.shouldUseCacheOnLoadError = options.shouldUseCacheOnLoadError
      ?? (() => true)
    this.storage = options.storage === undefined
      ? browserStorage()
      : options.storage

    for (const key of options.publicKeys) {
      const keyId = key.keyId.trim()
      const spki = key.spki.trim()
      if (keyId && spki) {
        this.publicKeys.set(keyId, spki)
      }
    }
  }

  loadEntitlements(userId: string): Promise<OfflineLicenseResolution> {
    const normalizedUserId = userId.trim()
    if (!normalizedUserId || normalizedUserId.length > 128) {
      return Promise.resolve(safeFreeResolution())
    }

    const existing = this.inFlight.get(normalizedUserId)
    if (existing) {
      return existing
    }

    const operation = this.loadFreshOrCached(normalizedUserId)
    this.inFlight.set(normalizedUserId, operation)
    void operation.finally(() => {
      if (this.inFlight.get(normalizedUserId) === operation) {
        this.inFlight.delete(normalizedUserId)
      }
    }).catch(() => undefined)
    return operation
  }

  async getCachedEntitlements(userId: string): Promise<OfflineLicenseResolution> {
    const normalizedUserId = userId.trim()
    if (!normalizedUserId || normalizedUserId.length > 128) {
      return safeFreeResolution()
    }

    return await this.readVerifiedCache(normalizedUserId)
      ?? safeFreeResolution()
  }

  clearCachedSnapshot(userId: string): void {
    const key = this.keyFor(userId.trim())
    memoryCache.delete(key)
    try {
      this.storage?.removeItem?.(key)
    } catch {
      // An inaccessible persistent cache cannot grant anything without a valid
      // signature and matching user when it becomes readable again.
    }
  }

  async verifySnapshot(
    snapshot: SignedLicenseSnapshot,
    expectedUserId: string,
  ): Promise<LicenseSnapshotPayload | null> {
    if (
      !isRecord(snapshot)
      || snapshot.alg !== 'EdDSA'
      || typeof snapshot.key_id !== 'string'
      || !this.publicKeys.has(snapshot.key_id)
    ) {
      return null
    }

    const payloadBytes = decodeBase64Url(snapshot.payload, MAX_PAYLOAD_BYTES)
    const signatureBytes = decodeBase64Url(snapshot.signature, 64)
    if (!payloadBytes || !signatureBytes || signatureBytes.length !== 64) {
      return null
    }

    let verified = false
    try {
      verified = await this.crypto?.subtle.verify(
        { name: 'Ed25519' },
        await this.getVerificationKey(snapshot.key_id),
        signatureBytes.buffer as ArrayBuffer,
        payloadBytes.buffer as ArrayBuffer,
      ) ?? false
    } catch {
      return null
    }

    if (!verified) {
      return null
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes),
      ) as unknown
    } catch {
      return null
    }

    return normalizePayload(
      parsed,
      expectedUserId,
      this.now().getTime(),
      this.clockSkewMs,
      this.maxLifetimeMs,
    )
  }

  private async loadFreshOrCached(
    userId: string,
  ): Promise<OfflineLicenseResolution> {
    try {
      const response = await this.loader()
      const snapshot = snapshotFromResponse(response)
      const payload = snapshot
        ? await this.verifySnapshot(snapshot, userId)
        : null

      if (snapshot && payload) {
        this.writeCache(userId, snapshot)
        return {
          entitlements: payloadToEntitlements(payload),
          source: 'network',
        }
      }
    } catch (error) {
      if (!this.shouldUseCacheOnLoadError(error)) {
        throw error
      }
      // A network/auth/format failure may use a still-valid signed snapshot.
    }

    return await this.readVerifiedCache(userId) ?? safeFreeResolution()
  }

  private async readVerifiedCache(
    userId: string,
  ): Promise<OfflineLicenseResolution | null> {
    const key = this.keyFor(userId)
    let serialized = memoryCache.get(key) ?? null

    if (serialized === null) {
      try {
        serialized = this.storage?.getItem(key) ?? null
      } catch {
        serialized = null
      }
    }

    if (serialized === null) {
      return null
    }

    let cached: unknown
    try {
      cached = JSON.parse(serialized) as unknown
    } catch {
      this.removeCache(key)
      return null
    }

    if (
      !isRecord(cached)
      || cached.version !== CACHE_VERSION
    ) {
      this.removeCache(key)
      return null
    }

    const snapshot = snapshotFromResponse({ snapshot: cached.snapshot })
    const payload = snapshot
      ? await this.verifySnapshot(snapshot, userId)
      : null

    if (!snapshot || !payload) {
      this.removeCache(key)
      return null
    }

    memoryCache.set(key, serialized)
    return {
      entitlements: payloadToEntitlements(payload),
      source: 'cache',
    }
  }

  private getVerificationKey(keyId: string): Promise<CryptoKey> {
    const existing = this.importedKeys.get(keyId)
    if (existing) {
      return existing
    }

    const spki = decodeSpki(this.publicKeys.get(keyId) ?? '')
    if (!this.crypto || !spki) {
      return Promise.reject(new Error('License verification key is unavailable'))
    }

    const operation = this.crypto.subtle.importKey(
      'spki',
      spki.buffer as ArrayBuffer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    this.importedKeys.set(keyId, operation)
    void operation.catch(() => {
      if (this.importedKeys.get(keyId) === operation) {
        this.importedKeys.delete(keyId)
      }
    })
    return operation
  }

  private keyFor(userId: string): string {
    return `${this.cacheKey}:${encodeURIComponent(userId)}`
  }

  private writeCache(userId: string, snapshot: SignedLicenseSnapshot): void {
    const envelope: CacheEnvelope = {
      snapshot: { ...snapshot },
      version: CACHE_VERSION,
    }
    const key = this.keyFor(userId)
    const serialized = JSON.stringify(envelope)
    memoryCache.set(key, serialized)
    try {
      this.storage?.setItem(key, serialized)
    } catch {
      // The verified in-memory envelope keeps this app run operational.
    }
  }

  private removeCache(key: string): void {
    memoryCache.delete(key)
    try {
      this.storage?.removeItem?.(key)
    } catch {
      // Ignore inaccessible storage; it will still be reverified before use.
    }
  }
}

/** Uses only build-time embedded public material; no signing secret is bundled. */
export function createEmbeddedOfflineLicenseService(
  api: Pick<BackendApi, 'getLicenseSnapshot'>,
): OfflineLicenseService {
  return new OfflineLicenseService({
    loader: () => api.getLicenseSnapshot(),
    publicKeys: [{
      keyId: __LICENSE_KEY_ID__,
      spki: __LICENSE_PUBLIC_KEY__,
    }],
    shouldUseCacheOnLoadError: (error) => !(
      isRecord(error)
      && error.status === 401
    ),
  })
}
