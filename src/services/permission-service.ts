import type { PlanCode } from '../types/database'
import type { ResolvedEntitlements } from '../types/backend-api'
import {
  canUseFeature,
  getAccountLimit,
} from './entitlements'

export const SAFE_FREE_ENTITLEMENTS: ResolvedEntitlements = {
  account_limit: 2,
  expires_at: null,
  features: {},
  founder_number: null,
  lifetime: false,
  plan: 'FREE',
}

export const FREE_HUNTERA_ACCOUNT_LIMIT = 3
export const FREE_OTHER_ACCOUNT_LIMIT = 2

function isHunteraGame(gameSlug: string | undefined): boolean {
  return gameSlug?.trim().toLocaleLowerCase() === 'huntera'
}

export type OpenSessionResult =
  | 'already_open'
  | 'already_closing'
  | 'already_opening'
  | 'cancelled'
  | 'limit_reached'
  | 'opened'

export class SessionCancellationCleanupError extends Error {
  constructor(public readonly cause: unknown) {
    super('A sessão cancelada não pôde ser encerrada.')
    this.name = 'SessionCancellationCleanupError'
  }
}

export class PermissionService {
  private entitlements: ResolvedEntitlements
  private readonly activeSessionIds = new Set<string>()
  private readonly pendingSessionIds = new Map<string, number>()
  private readonly closingSessionIds = new Map<
    string,
    { generation: number; operation: Promise<void> }
  >()
  private generation = 0

  constructor(entitlements: ResolvedEntitlements = SAFE_FREE_ENTITLEMENTS) {
    this.entitlements = this.copyEntitlements(entitlements)
  }

  getCurrentPlan(): PlanCode {
    return this.entitlements.plan
  }

  getAccountLimit(gameSlug?: string): number {
    if (this.entitlements.plan === 'FREE' && gameSlug) {
      return isHunteraGame(gameSlug)
        ? FREE_HUNTERA_ACCOUNT_LIMIT
        : FREE_OTHER_ACCOUNT_LIMIT
    }

    return getAccountLimit(this.entitlements)
  }

  getActiveSessionCount(): number {
    return this.activeSessionIds.size
  }

  getActiveSessionIds(): readonly string[] {
    return [...this.activeSessionIds]
  }

  getClosingSessionOperation(accountId: string): Promise<void> | null {
    return this.closingSessionIds.get(accountId)?.operation ?? null
  }

  canOpenAnotherSession(gameSlug?: string): boolean {
    return (
      this.activeSessionIds.size + this.pendingSessionIds.size
      < this.getAccountLimit(gameSlug)
    )
  }

  canUseFeature(featureKey: string): boolean {
    return canUseFeature(this.entitlements, featureKey)
  }

  isSessionActive(accountId: string): boolean {
    return this.activeSessionIds.has(accountId)
  }

  updateEntitlements(entitlements: ResolvedEntitlements): void {
    this.entitlements = this.copyEntitlements(entitlements)

    // A downgrade never terminates sessions already open. The lower limit is
    // applied only to future openings and naturally takes effect after restart.
  }

  resetForRestart(): string[] {
    const sessionsNeedingClose = [...this.activeSessionIds]

    this.generation += 1
    this.activeSessionIds.clear()
    this.pendingSessionIds.clear()
    // Existing close operations remain observable until they settle so a
    // logout/recovery cleanup can await them instead of starting a duplicate.
    return sessionsNeedingClose
  }

  async openSession(
    accountId: string,
    open: () => Promise<void> | void,
    focus?: () => Promise<void> | void,
    closeIfCancelled?: () => Promise<void> | void,
    gameSlug?: string,
  ): Promise<OpenSessionResult> {
    if (this.closingSessionIds.has(accountId)) {
      return 'already_closing'
    }

    if (this.activeSessionIds.has(accountId)) {
      await focus?.()
      return 'already_open'
    }

    if (this.pendingSessionIds.has(accountId)) {
      return 'already_opening'
    }

    if (!this.canOpenAnotherSession(gameSlug)) {
      return 'limit_reached'
    }

    const generation = this.generation
    this.pendingSessionIds.set(accountId, generation)

    try {
      try {
        await open()
      } catch (error) {
        if (generation !== this.generation) {
          try {
            await closeIfCancelled?.()
          } catch (cleanupError) {
            throw new SessionCancellationCleanupError(cleanupError)
          }
          return 'cancelled'
        }

        throw error
      }

      if (generation !== this.generation) {
        try {
          await closeIfCancelled?.()
        } catch (error) {
          throw new SessionCancellationCleanupError(error)
        }
        return 'cancelled'
      }

      this.activeSessionIds.add(accountId)
      return 'opened'
    } finally {
      if (this.pendingSessionIds.get(accountId) === generation) {
        this.pendingSessionIds.delete(accountId)
      }
    }
  }

  async closeSession(
    accountId: string,
    close: () => Promise<void> | void = () => undefined,
  ): Promise<void> {
    const existing = this.closingSessionIds.get(accountId)

    if (existing) {
      await existing.operation
      return
    }

    if (!this.activeSessionIds.has(accountId)) {
      return
    }

    const generation = this.generation
    let operation: Promise<void>

    operation = (async () => {
      await close()

      if (generation === this.generation) {
        this.activeSessionIds.delete(accountId)
      }
    })()
    this.closingSessionIds.set(accountId, { generation, operation })

    try {
      await operation
    } finally {
      if (this.closingSessionIds.get(accountId)?.operation === operation) {
        this.closingSessionIds.delete(accountId)
      }
    }
  }

  private copyEntitlements(
    entitlements: ResolvedEntitlements,
  ): ResolvedEntitlements {
    return {
      ...entitlements,
      features: { ...entitlements.features },
    }
  }
}
