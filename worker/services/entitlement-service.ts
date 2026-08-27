import type {
  FeatureMap,
  ResolvedEntitlements,
  SafeLicense,
} from '../../src/types/backend-api'
import type { PlanCode } from '../../src/types/database'
import { ApiError } from '../lib/api-error'
import type {
  BackendRepository,
  EntitlementRecord,
  LicenseRecord,
  PlanRecord,
} from '../types'

const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const PLAN_CODES = new Set<PlanCode>(['FREE', 'PRO', 'FOUNDER'])

interface LicenseWithPlan {
  license: LicenseRecord
  plan: PlanRecord & { code: PlanCode }
}

export interface InternalEntitlementResolution {
  entitlements: ResolvedEntitlements
  license: SafeLicense | null
}

function timestamp(value: string | null): number {
  if (!value) {
    return 0
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isKnownPlan(plan: PlanRecord): plan is PlanRecord & { code: PlanCode } {
  return PLAN_CODES.has(plan.code as PlanCode)
}

function isValidLicense(license: LicenseRecord, now: number): boolean {
  return license.status === 'active'
    && timestamp(license.starts_at) <= now
    && (
      license.lifetime
      || (license.expires_at !== null && timestamp(license.expires_at) > now)
    )
}

function compareLicenses(left: LicenseWithPlan, right: LicenseWithPlan): number {
  return Number(right.license.lifetime) - Number(left.license.lifetime)
    || right.plan.entitlement_rank - left.plan.entitlement_rank
    || timestamp(right.license.expires_at) - timestamp(left.license.expires_at)
    || timestamp(right.license.starts_at) - timestamp(left.license.starts_at)
    || timestamp(right.license.created_at) - timestamp(left.license.created_at)
    || right.license.id.localeCompare(left.license.id)
}

function compareEntitlements(
  left: EntitlementRecord,
  right: EntitlementRecord,
): number {
  return left.priority - right.priority
    || timestamp(left.starts_at) - timestamp(right.starts_at)
    || timestamp(left.created_at) - timestamp(right.created_at)
    || left.id.localeCompare(right.id)
}

function copyPlanFeatures(plan: PlanRecord): FeatureMap {
  if (!plan.features || typeof plan.features !== 'object' || Array.isArray(plan.features)) {
    throw new ApiError(500, 'invalid_plan_config', 'Configuração de plano inválida.')
  }

  const features = Object.create(null) as FeatureMap

  for (const [key, value] of Object.entries(plan.features)) {
    if (!FEATURE_KEY_PATTERN.test(key) || typeof value !== 'boolean') {
      throw new ApiError(500, 'invalid_plan_config', 'Configuração de plano inválida.')
    }

    features[key] = value
  }

  return features
}

export class EntitlementService {
  constructor(
    private readonly repository: BackendRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolveForUser(userId: string): Promise<InternalEntitlementResolution> {
    const [plans, licenses, individualEntitlements] = await Promise.all([
      this.repository.getPlans(),
      this.repository.getActiveLicenseCandidates(userId),
      this.repository.getEntitlementCandidates(userId),
    ])
    const knownPlans = plans.filter(isKnownPlan)
    const planById = new Map(knownPlans.map((plan) => [plan.id, plan]))
    const freePlan = knownPlans.find((plan) => plan.code === 'FREE')

    if (!freePlan || freePlan.max_accounts <= 0) {
      throw new ApiError(500, 'missing_free_plan', 'Configuração de plano indisponível.')
    }

    const now = this.now().getTime()
    const candidates = licenses
      .filter((license) => isValidLicense(license, now))
      .flatMap((license): LicenseWithPlan[] => {
        const plan = planById.get(license.plan_id)
        return plan && plan.code !== 'FREE' ? [{ license, plan }] : []
      })
      .sort(compareLicenses)
    const selected = candidates[0] ?? null
    const selectedPlan = selected?.plan ?? freePlan

    if (selectedPlan.max_accounts <= 0) {
      throw new ApiError(500, 'invalid_plan_config', 'Configuração de plano inválida.')
    }

    const features = copyPlanFeatures(selectedPlan)
    const activeOverrides = individualEntitlements
      .filter((entitlement) => (
        timestamp(entitlement.starts_at) <= now
        && (
          entitlement.expires_at === null
          || timestamp(entitlement.expires_at) > now
        )
        && FEATURE_KEY_PATTERN.test(entitlement.feature_key)
        && typeof entitlement.feature_value === 'boolean'
      ))
      .sort(compareEntitlements)

    for (const entitlement of activeOverrides) {
      features[entitlement.feature_key] = entitlement.feature_value as boolean
    }

    const selectedLicense = selected?.license ?? null

    return {
      entitlements: {
        plan: selectedPlan.code,
        lifetime: selectedLicense?.lifetime ?? false,
        expires_at: selectedLicense?.expires_at ?? null,
        founder_number: selectedLicense?.founder_number ?? null,
        account_limit: selectedPlan.max_accounts,
        features,
      },
      license: selectedLicense
        ? {
            id: selectedLicense.id,
            status: 'active',
            starts_at: selectedLicense.starts_at,
            expires_at: selectedLicense.expires_at,
            lifetime: selectedLicense.lifetime,
          }
        : null,
    }
  }
}
