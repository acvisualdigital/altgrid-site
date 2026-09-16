import { afterEach, describe, expect, it } from 'vitest'
import {
  backgroundThrottlingExperiment,
  experimentalParkingEnabled,
  resolveGamePerformanceProfile,
} from './game-performance-profile.js'

describe('game performance profiles', () => {
  afterEach(() => {
    delete process.env.ALTGRID_EXPERIMENTAL_DETACHED_PARKING
    delete process.env.ALTGRID_BACKGROUND_THROTTLING_MODE
  })

  it('uses conservative defaults and recognizes supported game origins', () => {
    expect(resolveGamePerformanceProfile('https://huntera.com.br/play')).toMatchObject({
      id: 'huntera', parkingStrategy: 'ATTACHED_OFFSCREEN',
      backgroundThrottlingCompatibility: 'keep-alive',
    })
    expect(resolveGamePerformanceProfile('not a url').id).toBe('default')
  })

  it('never enables experiments from invalid environment values', () => {
    process.env.ALTGRID_EXPERIMENTAL_DETACHED_PARKING = 'yes'
    process.env.ALTGRID_BACKGROUND_THROTTLING_MODE = 'false'
    expect(experimentalParkingEnabled()).toBe(false)
    expect(backgroundThrottlingExperiment()).toBe('current')
    process.env.ALTGRID_EXPERIMENTAL_DETACHED_PARKING = 'true'
    process.env.ALTGRID_BACKGROUND_THROTTLING_MODE = 'profile'
    expect(experimentalParkingEnabled()).toBe(true)
    expect(backgroundThrottlingExperiment()).toBe('profile')
  })
})
