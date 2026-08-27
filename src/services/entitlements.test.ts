import { describe, expect, it } from 'vitest'

import type { ResolvedEntitlements } from '../types/backend-api'
import {
  canUseFeature,
  EntitlementAccess,
  getAccountLimit,
  hasFeature,
} from './entitlements'

const entitlements: ResolvedEntitlements = {
  plan: 'FREE',
  lifetime: false,
  expires_at: null,
  founder_number: null,
  account_limit: 2,
  features: {
    basic_grids: true,
    advanced_grids: false,
  },
}

describe('client entitlement adapter', () => {
  it('answers feature and account-limit checks without plan conditionals', () => {
    expect(hasFeature(entitlements, 'basic_grids')).toBe(true)
    expect(canUseFeature(entitlements, 'advanced_grids')).toBe(false)
    expect(getAccountLimit(entitlements)).toBe(2)

    const access = new EntitlementAccess(entitlements)
    expect(access.hasFeature('basic_grids')).toBe(true)
    expect(access.getAccountLimit()).toBe(2)
  })
})
