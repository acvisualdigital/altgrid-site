import type { Json } from '../types/database'
import type { PublicGame, PublicGamesResponse } from '../types/backend-api'

const DEFAULT_CACHE_KEY = 'altgrid.game-presets.v1'
const CACHE_VERSION = 1

// Shared by service instances so a denied localStorage does not make a refresh
// erase presets that were already loaded during the current app run.
const memoryCache = new Map<string, string>()

export type SafeGameUrlErrorCode =
  | 'required'
  | 'invalid_url'
  | 'credentials_not_allowed'
  | 'unsupported_protocol'
  | 'insecure_http'

export type SafeGameUrlResult =
  | { ok: true; url: string }
  | { ok: false; code: SafeGameUrlErrorCode; message: string }

export interface GamePresetStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type GamePresetLoader = () => Promise<PublicGamesResponse>

export interface GamePresetServiceOptions {
  loader: GamePresetLoader
  storage?: GamePresetStorage | null
  cacheKey?: string
}

interface CachedGames {
  found: boolean
  games: PublicGame[]
}

interface NormalizedCatalog {
  enabledCandidateCount: number
  games: PublicGame[]
}

interface CacheEnvelope {
  version: typeof CACHE_VERSION
  games: PublicGame[]
}

export class GamePresetServiceError extends Error {
  constructor(
    public readonly code: 'invalid_games_response',
    message = 'A lista de jogos recebida é inválida.',
  ) {
    super(message)
    this.name = 'GamePresetServiceError'
  }
}

function urlError(
  code: SafeGameUrlErrorCode,
  message: string,
): SafeGameUrlResult {
  return { code, message, ok: false }
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')

  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
  ) {
    return true
  }

  const parts = hostname.split('.')
  return (
    parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part))
  )
}

/**
 * Central URL policy for launch, referral, icon, and custom game URLs.
 * HTTP is intentionally limited to loopback development endpoints.
 */
export function validateSafeGameUrl(value: unknown): SafeGameUrlResult {
  if (typeof value !== 'string' || !value.trim()) {
    return urlError('required', 'Informe uma URL.')
  }

  const trimmed = value.trim()

  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return urlError('invalid_url', 'A URL informada é inválida.')
  }

  let url: URL

  try {
    url = new URL(trimmed)
  } catch {
    return urlError('invalid_url', 'A URL informada é inválida.')
  }

  if (url.username || url.password) {
    return urlError(
      'credentials_not_allowed',
      'A URL não pode conter usuário ou senha.',
    )
  }

  if (url.protocol === 'https:') {
    return { ok: true, url: url.toString() }
  }

  if (url.protocol === 'http:') {
    if (isLoopbackHostname(url.hostname)) {
      return { ok: true, url: url.toString() }
    }

    return urlError(
      'insecure_http',
      'Use HTTPS. HTTP é permitido apenas para localhost.',
    )
  }

  return urlError(
    'unsupported_protocol',
    'Este tipo de URL não é permitido.',
  )
}

export function normalizeSafeGameUrl(value: unknown): string | null {
  const result = validateSafeGameUrl(value)
  return result.ok ? result.url : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is Json {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return true
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (!value || typeof value !== 'object') {
    return false
  }

  if (ancestors.has(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  if (
    !Array.isArray(value)
    && prototype !== Object.prototype
    && prototype !== null
  ) {
    return false
  }

  ancestors.add(value)
  const entries = Array.isArray(value) ? value : Object.values(value)
  const valid = entries.every(
    (entry) => entry !== undefined && isJsonValue(entry, ancestors),
  )
  ancestors.delete(value)
  return valid
}

function cloneJson(value: Json): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

function normalizeMetadata(value: unknown): Json {
  return isJsonValue(value) ? cloneJson(value) : null
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized || null
}

function normalizeOptionalUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  return normalizeSafeGameUrl(value)
}

function normalizeGame(value: unknown): PublicGame | null {
  if (!isRecord(value) || value.enabled === false) {
    return null
  }

  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    return null
  }

  const id = normalizeText(value.id)
  const slug = normalizeText(value.slug)
  const name = normalizeText(value.name)
  const launchUrl = normalizeSafeGameUrl(value.launch_url)
  const sortOrder = value.sort_order

  if (
    !id
    || !slug
    || !name
    || !launchUrl
    || typeof sortOrder !== 'number'
    || !Number.isFinite(sortOrder)
  ) {
    return null
  }

  const game: PublicGame = {
    developer_referral_url: normalizeOptionalUrl(
      value.developer_referral_url,
    ),
    icon_url: normalizeOptionalUrl(value.icon_url),
    id,
    launch_url: launchUrl,
    metadata: normalizeMetadata(value.metadata),
    name,
    slug,
    sort_order: sortOrder,
  }

  if (value.enabled === true) {
    game.enabled = true
  }

  return game
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1
  }

  return left > right ? 1 : 0
}

function compareGames(left: PublicGame, right: PublicGame): number {
  return (
    left.sort_order - right.sort_order
    || compareText(left.name.toLocaleLowerCase(), right.name.toLocaleLowerCase())
    || compareText(left.slug.toLocaleLowerCase(), right.slug.toLocaleLowerCase())
    || compareText(left.id.toLocaleLowerCase(), right.id.toLocaleLowerCase())
  )
}

function normalizeCatalog(value: unknown): NormalizedCatalog | null {
  if (!isRecord(value) || !Array.isArray(value.games)) {
    return null
  }

  let enabledCandidateCount = 0
  const normalized: PublicGame[] = []

  for (const candidate of value.games) {
    if (isRecord(candidate) && candidate.enabled === false) {
      continue
    }

    enabledCandidateCount += 1
    const game = normalizeGame(candidate)

    if (game) {
      normalized.push(game)
    }
  }

  normalized.sort(compareGames)
  const seenIds = new Set<string>()
  const seenSlugs = new Set<string>()
  const games = normalized.filter((game) => {
    const id = game.id.toLocaleLowerCase()
    const slug = game.slug.toLocaleLowerCase()

    if (seenIds.has(id) || seenSlugs.has(slug)) {
      return false
    }

    seenIds.add(id)
    seenSlugs.add(slug)
    return true
  })

  return { enabledCandidateCount, games }
}

function browserStorage(): GamePresetStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function cloneGames(games: PublicGame[]): PublicGame[] {
  return games.map((game) => ({
    ...game,
    metadata: cloneJson(game.metadata),
  }))
}

export class GamePresetService {
  private readonly cacheKey: string
  private readonly loader: GamePresetLoader
  private readonly storage: GamePresetStorage | null
  private inFlight: Promise<PublicGame[]> | null = null

  constructor(options: GamePresetServiceOptions) {
    this.cacheKey = options.cacheKey ?? DEFAULT_CACHE_KEY
    this.loader = options.loader
    this.storage = options.storage === undefined
      ? browserStorage()
      : options.storage
  }

  loadGames(): Promise<PublicGame[]> {
    if (this.inFlight) {
      return this.inFlight
    }

    const request = this.loadFreshGames()
    this.inFlight = request

    void request.finally(() => {
      if (this.inFlight === request) {
        this.inFlight = null
      }
    }).catch(() => undefined)

    return request
  }

  getCachedGames(): PublicGame[] {
    return this.readCache().games
  }

  private async loadFreshGames(): Promise<PublicGame[]> {
    let response: PublicGamesResponse

    try {
      response = await this.loader()
    } catch (error) {
      return this.useCacheOrThrow(error)
    }

    const normalized = normalizeCatalog(response)
    const invalidResponse = (
      normalized === null
      || (
        normalized.enabledCandidateCount > 0
        && normalized.games.length === 0
      )
    )

    if (invalidResponse) {
      return this.useCacheOrThrow(new GamePresetServiceError(
        'invalid_games_response',
      ))
    }

    // A genuinely empty catalog, or one containing only explicitly disabled
    // games, is authoritative and intentionally replaces the previous cache.
    this.writeCache(normalized.games)
    return cloneGames(normalized.games)
  }

  private useCacheOrThrow(error: unknown): PublicGame[] {
    const cached = this.readCache()

    if (cached.found) {
      return cached.games
    }

    throw error
  }

  private readCache(): CachedGames {
    const inMemory = memoryCache.get(this.cacheKey)

    if (inMemory !== undefined) {
      const parsed = this.parseCache(inMemory)

      if (parsed) {
        return { found: true, games: cloneGames(parsed) }
      }

      memoryCache.delete(this.cacheKey)
    }

    let serialized: string | null = null

    try {
      serialized = this.storage?.getItem(this.cacheKey) ?? null
    } catch {
      serialized = null
    }

    if (serialized === null) {
      return { found: false, games: [] }
    }

    const parsed = this.parseCache(serialized)

    if (!parsed) {
      return { found: false, games: [] }
    }

    memoryCache.set(this.cacheKey, serialized)
    return { found: true, games: cloneGames(parsed) }
  }

  private parseCache(serialized: string): PublicGame[] | null {
    let payload: unknown

    try {
      payload = JSON.parse(serialized) as unknown
    } catch {
      return null
    }

    if (
      !isRecord(payload)
      || payload.version !== CACHE_VERSION
      || !Array.isArray(payload.games)
    ) {
      return null
    }

    const normalized = normalizeCatalog({ games: payload.games })

    if (
      !normalized
      || (
        normalized.enabledCandidateCount > 0
        && normalized.games.length === 0
      )
    ) {
      return null
    }

    return normalized.games
  }

  private writeCache(games: PublicGame[]): void {
    const envelope: CacheEnvelope = {
      games: cloneGames(games),
      version: CACHE_VERSION,
    }
    const serialized = JSON.stringify(envelope)
    memoryCache.set(this.cacheKey, serialized)

    try {
      this.storage?.setItem(this.cacheKey, serialized)
    } catch {
      // The process-wide memory cache keeps the current run operational.
    }
  }
}
