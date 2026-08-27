import { beforeEach, describe, expect, it } from 'vitest'

import type { FeatureMap } from '../../src/types/backend-api'
import type {
  EntitlementRecord,
  LicenseRecord,
  PlanRecord,
} from '../types'
import { EntitlementService } from './entitlement-service'
import { FakeRepository } from '../test/fake-repository'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const USER_ID = '00000000-0000-4000-8000-000000000001'

const freeFeatures: FeatureMap = {
  basic_grids: true,
  fullscreen_sessions: true,
  game_presets: true,
  advanced_grids: false,
  eco_mode: false,
  session_restore: false,
  founder_badge: false,
  beta_features: false,
}

function plan(
  code: 'FREE' | 'PRO' | 'FOUNDER',
  rank: number,
  maxAccounts: number,
  features: Partial<FeatureMap> = {},
): PlanRecord {
  return {
    id: `${code.toLowerCase()}-plan`,
    code,
    name: code,
    max_accounts: maxAccounts,
    enabled: true,
    entitlement_rank: rank,
    features: Object.assign({}, freeFeatures, features) as FeatureMap,
  }
}

function license(
  id: string,
  planId: string,
  options: Partial<LicenseRecord> = {},
): LicenseRecord {
  return {
    id,
    user_id: USER_ID,
    plan_id: planId,
    status: 'active',
    starts_at: '2026-08-20T00:00:00.000Z',
    expires_at: '2026-09-25T00:00:00.000Z',
    lifetime: false,
    founder_number: null,
    created_at: '2026-08-20T00:00:00.000Z',
    ...options,
  }
}

function override(
  id: string,
  key: string,
  value: boolean,
  options: Partial<EntitlementRecord> = {},
): EntitlementRecord {
  return {
    id,
    user_id: USER_ID,
    feature_key: key,
    feature_value: value,
    priority: 0,
    starts_at: '2026-08-20T00:00:00.000Z',
    expires_at: null,
    created_at: '2026-08-20T00:00:00.000Z',
    ...options,
  }
}

describe('EntitlementService', () => {
  let repository: FakeRepository
  let service: EntitlementService

  beforeEach(() => {
    repository = new FakeRepository()
    repository.plans = [
      plan('FREE', 0, 2),
      plan('PRO', 100, 10, {
        advanced_grids: true,
        eco_mode: true,
        session_restore: true,
      }),
      plan('FOUNDER', 200, 20, {
        advanced_grids: true,
        eco_mode: true,
        session_restore: true,
        founder_badge: true,
        beta_features: true,
      }),
    ]
    service = new EntitlementService(repository, () => NOW)
  })

  it('resolves FREE from the database when no valid license exists', async () => {
    const result = await service.resolveForUser(USER_ID)

    expect(result.entitlements).toMatchObject({
      plan: 'FREE',
      lifetime: false,
      expires_at: null,
      account_limit: 2,
    })
    expect(result.entitlements.features.advanced_grids).toBe(false)
    expect(result.license).toBeNull()
  })

  it('resolves an active temporary PRO license', async () => {
    repository.licenses = [license('pro-active', 'pro-plan')]

    const result = await service.resolveForUser(USER_ID)

    expect(result.entitlements.plan).toBe('PRO')
    expect(result.entitlements.account_limit).toBe(10)
    expect(result.entitlements.features.eco_mode).toBe(true)
    expect(result.entitlements.lifetime).toBe(false)
  })

  it('falls back to FREE for an expired PRO license', async () => {
    repository.licenses = [
      license('pro-expired', 'pro-plan', {
        expires_at: NOW.toISOString(),
      }),
    ]

    const result = await service.resolveForUser(USER_ID)

    expect(result.entitlements.plan).toBe('FREE')
    expect(result.entitlements.account_limit).toBe(2)
  })

  it('uses FREE only as fallback and ignores a legacy FREE lifetime license', async () => {
    repository.licenses = [
      license('legacy-free-lifetime', 'free-plan', {
        lifetime: true,
        expires_at: null,
      }),
      license('founder-temporary', 'founder-plan', { founder_number: 42 }),
    ]

    const result = await service.resolveForUser(USER_ID)

    expect(result.entitlements.plan).toBe('FOUNDER')
    expect(result.entitlements.lifetime).toBe(false)
    expect(result.entitlements.founder_number).toBe(42)
  })

  it('resolves PRO lifetime and lets it outrank temporary FOUNDER', async () => {
    repository.licenses = [
      license('founder-temporary', 'founder-plan', { founder_number: 42 }),
      license('pro-lifetime', 'pro-plan', {
        lifetime: true,
        expires_at: null,
      }),
    ]

    const result = await service.resolveForUser(USER_ID)

    expect(result.entitlements).toMatchObject({
      plan: 'PRO',
      lifetime: true,
      expires_at: null,
      founder_number: null,
    })
  })

  it('resolves FOUNDER lifetime with its number and features', async () => {
    repository.licenses = [
      license('founder-lifetime', 'founder-plan', {
        lifetime: true,
        expires_at: null,
        founder_number: 7,
      }),
    ]

    const result = await service.resolveForUser(USER_ID)

    expect(result.entitlements).toMatchObject({
      plan: 'FOUNDER',
      lifetime: true,
      founder_number: 7,
      account_limit: 20,
    })
    expect(result.entitlements.features.founder_badge).toBe(true)
    expect(result.entitlements.features.beta_features).toBe(true)
  })

  it('applies the highest-priority active individual boolean override', async () => {
    repository.licenses = [license('pro-active', 'pro-plan')]
    repository.entitlements = [
      override('lower', 'eco_mode', true, { priority: 1 }),
      override('higher', 'eco_mode', false, { priority: 10 }),
      override('future', 'beta_feature_x', true, {
        priority: 100,
        starts_at: '2026-08-26T00:00:00.000Z',
      }),
    ]

    const result = await service.resolveForUser(USER_ID)

    expect(result.entitlements.features.eco_mode).toBe(false)
    expect(result.entitlements.features.beta_feature_x).toBeUndefined()
  })
})
