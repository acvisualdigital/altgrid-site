import type { AdminSessionResponse } from '../types/admin-api'
import { UNLIMITED_ACCOUNT_LIMIT, type ResolvedEntitlements } from '../types/backend-api'

const OWNER_EMAIL = 'yacaciio@gmail.com'
const OWNER_TOOLS = ['creator-tag', 'founder-benefits'] as const
export type OwnerTool = typeof OWNER_TOOLS[number]
type Identity = { id: string; email?: string | null }
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}

function browserStorage(): PreferenceStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Local test preferences never authorize themselves or modify a real license. */
export class OwnerToolsService {
  private verifiedOwnerId: string | null = null

  constructor(private readonly storage: PreferenceStorage | null = browserStorage()) {
    this.removeNonOwnerPreferences()
  }

  authorize(
    currentUser: Identity | null | undefined,
    serverUser: Identity | null | undefined,
    adminSession: AdminSessionResponse | null | undefined,
  ): void {
    this.verifiedOwnerId = currentUser?.id
      && serverUser?.id === currentUser.id
      && adminSession?.admin?.user_id === currentUser.id
      && adminSession.admin.role === 'admin'
      && normalizeEmail(currentUser.email) === OWNER_EMAIL
      && normalizeEmail(serverUser.email) === OWNER_EMAIL
      ? currentUser.id
      : null
    this.removeNonOwnerPreferences()
  }

  revoke(): void {
    this.verifiedOwnerId = null
  }

  isAuthorized(user: Identity | null | undefined): boolean {
    return Boolean(this.verifiedOwnerId
      && user?.id === this.verifiedOwnerId
      && normalizeEmail(user.email) === OWNER_EMAIL)
  }

  isEnabled(user: Identity | null | undefined, tool: OwnerTool): boolean {
    if (!this.isAuthorized(user)) return false
    try {
      return this.storage?.getItem(`altgrid.${tool}.enabled`) === 'true'
        && normalizeEmail(this.storage.getItem(`altgrid.${tool}.email`)) === OWNER_EMAIL
    } catch {
      return false
    }
  }

  setEnabled(user: Identity | null | undefined, tool: OwnerTool, enabled: boolean): boolean {
    if (!this.isAuthorized(user) || !this.storage) return false
    try {
      this.storage.setItem(`altgrid.${tool}.email`, OWNER_EMAIL)
      this.storage.setItem(`altgrid.${tool}.enabled`, String(enabled))
      return true
    } catch {
      return false
    }
  }

  resolveEntitlements(
    user: Identity | null | undefined,
    base: ResolvedEntitlements,
  ): ResolvedEntitlements {
    if (!this.isEnabled(user, 'founder-benefits')) return base
    return {
      ...base,
      account_limit: UNLIMITED_ACCOUNT_LIMIT,
      expires_at: null,
      features: {
        ...base.features,
        account_proxy: true,
        advanced_grids: true,
        eco_mode: true,
        extended_screens: true,
      },
      founder_number: base.founder_number,
      lifetime: true,
      plan: 'FOUNDER',
    }
  }

  private removeNonOwnerPreferences(): void {
    for (const tool of OWNER_TOOLS) {
      try {
        if (normalizeEmail(this.storage?.getItem(`altgrid.${tool}.email`)) !== OWNER_EMAIL) {
          this.storage?.removeItem(`altgrid.${tool}.enabled`)
          this.storage?.removeItem(`altgrid.${tool}.email`)
        }
      } catch {
        // Unavailable storage never grants a test feature.
      }
    }
  }
}
