export type AccountParkingStrategy = 'ATTACHED_OFFSCREEN' | 'DETACHED_VIEW'
export type BackgroundThrottlingCompatibility = 'keep-alive' | 'allow'
export type BackgroundImageAnimationPolicy = 'animate' | 'animateOnce' | 'noAnimation'

export interface GamePerformanceProfile {
  id: string
  parkingStrategy: AccountParkingStrategy
  backgroundVisualBudget: number
  imageAnimationPolicy: BackgroundImageAnimationPolicy
  audioBehavior: 'respect-user' | 'active-only'
  backgroundThrottlingCompatibility: BackgroundThrottlingCompatibility
}

const conservativeProfile: GamePerformanceProfile = Object.freeze({
  id: 'default', parkingStrategy: 'ATTACHED_OFFSCREEN', backgroundVisualBudget: 2,
  imageAnimationPolicy: 'noAnimation', audioBehavior: 'active-only',
  backgroundThrottlingCompatibility: 'keep-alive',
})

// Profiles intentionally remain conservative until a real-game benchmark
// proves a safe difference. This table is infrastructure, not a DOM hack.
const profiles: Record<string, GamePerformanceProfile> = {
  default: conservativeProfile,
  huntera: { ...conservativeProfile, id: 'huntera' },
  tibidle: { ...conservativeProfile, id: 'tibidle' },
  pokeIdle: { ...conservativeProfile, id: 'pokeIdle' },
  baiakIdle: { ...conservativeProfile, id: 'baiakIdle' },
}

export function resolveGamePerformanceProfile(url: string): GamePerformanceProfile {
  let hostname = ''
  try { hostname = new URL(url).hostname.toLowerCase() } catch { return profiles.default! }
  if (hostname.includes('huntera')) return profiles.huntera!
  if (hostname.includes('tibidle')) return profiles.tibidle!
  if (hostname.includes('baiak')) return profiles.baiakIdle!
  if (hostname.includes('poke')) return profiles.pokeIdle!
  return profiles.default!
}

export function experimentalParkingEnabled(): boolean {
  return process.env.ALTGRID_EXPERIMENTAL_DETACHED_PARKING === 'true'
}

export function backgroundThrottlingExperiment(): 'current' | 'allow' | 'profile' {
  const value = process.env.ALTGRID_BACKGROUND_THROTTLING_MODE
  return value === 'allow' || value === 'profile' ? value : 'current'
}
