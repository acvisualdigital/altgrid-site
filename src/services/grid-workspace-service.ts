import type { ConfiguredAccount } from './configured-account-service'

export interface SavedGridWorkspace {
  accountIds: string[]
  createdAt: string
  id: string
  name: string
  updatedAt: string
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface GridWorkspaceServiceOptions {
  createId?: () => string
  now?: () => Date
  storage?: StorageLike | null
}

const STORAGE_PREFIX = 'altgrid.saved-grids.v1'

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `grid-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function cleanName(value: string): string { return value.trim().replace(/\s+/g, ' ').slice(0, 40) }

function isSavedGrid(value: unknown): value is SavedGridWorkspace {
  if (!value || typeof value !== 'object') return false
  const grid = value as Partial<SavedGridWorkspace>
  return typeof grid.id === 'string'
    && typeof grid.name === 'string'
    && Array.isArray(grid.accountIds)
    && grid.accountIds.every((id) => typeof id === 'string')
    && typeof grid.createdAt === 'string'
    && typeof grid.updatedAt === 'string'
}

export class GridWorkspaceService {
  private readonly memoryFallback = new Map<string, string>()
  private readonly storage: StorageLike | null
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(options: GridWorkspaceServiceOptions = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage
    this.createId = options.createId ?? defaultId
    this.now = options.now ?? (() => new Date())
  }

  list(userId: string, validAccountIds?: readonly string[]): SavedGridWorkspace[] {
    const serialized = this.read(this.keyFor(userId))
    if (!serialized) return []
    try {
      const parsed = JSON.parse(serialized) as unknown
      if (!Array.isArray(parsed)) return []
      const valid = validAccountIds ? new Set(validAccountIds) : null
      return parsed.filter(isSavedGrid).map((grid) => ({
        ...grid,
        accountIds: [...new Set(grid.accountIds)].filter((id) => !valid || valid.has(id)),
        name: cleanName(grid.name) || 'Grade sem nome',
      }))
    } catch { return [] }
  }

  save(
    userId: string,
    input: { accountIds: readonly string[]; id?: string | null; name: string },
  ): SavedGridWorkspace | null {
    const name = cleanName(input.name)
    const accountIds = [...new Set(input.accountIds.filter(Boolean))]
    if (!name || accountIds.length === 0) return null
    const grids = this.list(userId)
    const timestamp = this.now().toISOString()
    const index = input.id ? grids.findIndex((grid) => grid.id === input.id) : -1
    const saved: SavedGridWorkspace = index >= 0
      ? { ...grids[index]!, name, accountIds, updatedAt: timestamp }
      : { id: this.createId(), name, accountIds, createdAt: timestamp, updatedAt: timestamp }
    if (index >= 0) grids[index] = saved
    else grids.push(saved)
    this.write(this.keyFor(userId), JSON.stringify(grids))
    return { ...saved, accountIds: [...saved.accountIds] }
  }

  remove(userId: string, gridId: string): boolean {
    const grids = this.list(userId)
    const remaining = grids.filter((grid) => grid.id !== gridId)
    if (remaining.length === grids.length) return false
    this.write(this.keyFor(userId), JSON.stringify(remaining))
    return true
  }

  createForGames(
    userId: string,
    accounts: readonly ConfiguredAccount[],
    gameNameFor: (account: ConfiguredAccount) => string = (account) => account.gameSlug,
  ): SavedGridWorkspace[] {
    const grouped = new Map<string, ConfiguredAccount[]>()
    accounts.forEach((account) => grouped.set(account.gameSlug, [...(grouped.get(account.gameSlug) ?? []), account]))
    const existing = this.list(userId)
    grouped.forEach((group, gameSlug) => {
      if (!group.length) return
      const name = cleanName(gameNameFor(group[0]!)) || gameSlug
      const matching = existing.find((grid) => grid.name.toLocaleLowerCase() === name.toLocaleLowerCase())
      const timestamp = this.now().toISOString()
      const accountIds = group.map((account) => account.id)
      if (matching) { matching.accountIds = accountIds; matching.updatedAt = timestamp }
      else existing.push({ id: this.createId(), name, accountIds, createdAt: timestamp, updatedAt: timestamp })
    })
    this.write(this.keyFor(userId), JSON.stringify(existing))
    return this.list(userId)
  }

  private keyFor(userId: string): string { return `${STORAGE_PREFIX}:${userId}` }
  private read(key: string): string | null {
    if (this.memoryFallback.has(key)) return this.memoryFallback.get(key) ?? null
    try { return this.storage?.getItem(key) ?? null } catch { return this.memoryFallback.get(key) ?? null }
  }
  private write(key: string, value: string): void {
    this.memoryFallback.set(key, value)
    try { this.storage?.setItem(key, value) } catch { /* current run keeps the copy */ }
  }
}
