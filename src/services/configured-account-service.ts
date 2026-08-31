export interface ConfiguredAccount {
  id: string
  displayName: string
  gameSlug: string
  customLaunchUrl?: string
  createdAt: string
}

export interface AddConfiguredAccountInput {
  displayName: string
  gameSlug: string
  customLaunchUrl?: string
}

export const CUSTOM_GAME_SLUG = '__custom_url__'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface ConfiguredAccountServiceOptions {
  createId?: () => string
  now?: () => Date
  storage?: StorageLike | null
}

const STORAGE_PREFIX = 'hunterafarm.configured-accounts.v1'

function defaultId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isConfiguredAccount(value: unknown): value is ConfiguredAccount {
  if (!value || typeof value !== 'object') {
    return false
  }

  const account = value as Partial<ConfiguredAccount>
  return (
    typeof account.id === 'string'
    && typeof account.displayName === 'string'
    && typeof account.gameSlug === 'string'
    && (
      account.customLaunchUrl === undefined
      || typeof account.customLaunchUrl === 'string'
    )
    && typeof account.createdAt === 'string'
  )
}

export class ConfiguredAccountService {
  private readonly memoryFallback = new Map<string, string>()
  private readonly storage: StorageLike | null
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(options: ConfiguredAccountServiceOptions = {}) {
    this.storage = options.storage === undefined
      ? browserStorage()
      : options.storage
    this.createId = options.createId ?? defaultId
    this.now = options.now ?? (() => new Date())
  }

  list(userId: string): ConfiguredAccount[] {
    const serialized = this.read(this.keyFor(userId))

    if (!serialized) {
      return []
    }

    try {
      const parsed = JSON.parse(serialized) as unknown
      return Array.isArray(parsed)
        ? parsed.filter(isConfiguredAccount).map((account) => ({
            createdAt: account.createdAt,
            customLaunchUrl: account.customLaunchUrl,
            displayName: account.displayName,
            gameSlug: account.gameSlug,
            id: account.id,
          }))
        : []
    } catch {
      return []
    }
  }

  add(
    userId: string,
    input: AddConfiguredAccountInput,
  ): ConfiguredAccount {
    const account: ConfiguredAccount = {
      createdAt: this.now().toISOString(),
      displayName: input.displayName.trim().slice(0, 80),
      gameSlug: input.gameSlug.trim().slice(0, 80),
      ...(input.customLaunchUrl?.trim()
        ? { customLaunchUrl: input.customLaunchUrl.trim().slice(0, 2_048) }
        : {}),
      id: this.createId(),
    }
    const accounts = [...this.list(userId), account]

    // Plan limits apply only to open sessions. Saved configurations are never
    // truncated or deleted here, including after a downgrade.
    this.write(this.keyFor(userId), JSON.stringify(accounts))
    return { ...account }
  }

  duplicate(userId: string, accountId: string): ConfiguredAccount | null {
    const source = this.list(userId).find((account) => account.id === accountId)
    if (!source) {
      return null
    }

    const copy = this.add(userId, {
      customLaunchUrl: source.customLaunchUrl,
      displayName: `${source.displayName} - cópia`.slice(0, 80),
      gameSlug: source.gameSlug,
    })

    return copy
  }

  rename(userId: string, accountId: string, displayName: string): ConfiguredAccount | null {
    const nextName = displayName.trim().slice(0, 80)

    if (!nextName) {
      return null
    }

    const accounts = this.list(userId)
    const index = accounts.findIndex((account) => account.id === accountId)

    if (index < 0) {
      return null
    }

    const updated = { ...accounts[index]!, displayName: nextName }
    accounts[index] = updated
    this.write(this.keyFor(userId), JSON.stringify(accounts))
    return { ...updated }
  }

  move(
    userId: string,
    accountId: string,
    direction: 'previous' | 'next',
  ): ConfiguredAccount[] {
    const accounts = this.list(userId)
    const index = accounts.findIndex((account) => account.id === accountId)
    const targetIndex = direction === 'previous' ? index - 1 : index + 1

    if (index < 0 || targetIndex < 0 || targetIndex >= accounts.length) {
      return accounts
    }

    const [account] = accounts.splice(index, 1)
    accounts.splice(targetIndex, 0, account!)
    this.write(this.keyFor(userId), JSON.stringify(accounts))
    return accounts.map((account) => ({ ...account }))
  }

  moveTo(userId: string, accountId: string, targetIndex: number): ConfiguredAccount[] {
    const accounts = this.list(userId)
    const currentIndex = accounts.findIndex((account) => account.id === accountId)

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= accounts.length) {
      return accounts
    }

    const [account] = accounts.splice(currentIndex, 1)
    accounts.splice(targetIndex, 0, account!)
    this.write(this.keyFor(userId), JSON.stringify(accounts))
    return accounts.map((account) => ({ ...account }))
  }

  remove(userId: string, accountId: string): boolean {
    const accounts = this.list(userId)
    const remaining = accounts.filter((account) => account.id !== accountId)

    if (remaining.length === accounts.length) {
      return false
    }

    // Removal is always an explicit user action. Plan changes never call this.
    this.write(this.keyFor(userId), JSON.stringify(remaining))
    return true
  }

  private keyFor(userId: string): string {
    // Keep the legacy key so the Altgrid rename does not discard saved accounts.
    return `${STORAGE_PREFIX}:${userId}`
  }

  private read(key: string): string | null {
    if (this.memoryFallback.has(key)) {
      return this.memoryFallback.get(key) ?? null
    }

    try {
      return this.storage?.getItem(key) ?? null
    } catch {
      return this.memoryFallback.get(key) ?? null
    }
  }

  private write(key: string, value: string): void {
    this.memoryFallback.set(key, value)

    try {
      this.storage?.setItem(key, value)
    } catch {
      // The in-memory copy keeps the current run usable when storage is denied.
    }
  }
}
