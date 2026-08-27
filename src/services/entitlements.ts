import type { ResolvedEntitlements } from '../types/backend-api'

export function hasFeature(
  entitlements: ResolvedEntitlements,
  featureKey: string,
): boolean {
  return entitlements.features[featureKey] === true
}

export function canUseFeature(
  entitlements: ResolvedEntitlements,
  featureKey: string,
): boolean {
  return hasFeature(entitlements, featureKey)
}

export function getAccountLimit(entitlements: ResolvedEntitlements): number {
  return entitlements.account_limit
}

export class EntitlementAccess {
  constructor(private resolved: ResolvedEntitlements) {}

  update(resolved: ResolvedEntitlements): void {
    this.resolved = resolved
  }

  hasFeature(featureKey: string): boolean {
    return hasFeature(this.resolved, featureKey)
  }

  canUseFeature(featureKey: string): boolean {
    return canUseFeature(this.resolved, featureKey)
  }

  getAccountLimit(): number {
    return getAccountLimit(this.resolved)
  }
}
