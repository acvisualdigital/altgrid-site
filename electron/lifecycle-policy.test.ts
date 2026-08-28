import { describe, expect, it } from 'vitest'

import {
  MAINTENANCE_SHUTDOWN_ARGUMENT,
  hasMaintenanceShutdownArgument,
} from './lifecycle-policy.js'

describe('maintenance shutdown policy', () => {
  it('accepts only the exact maintenance argument', () => {
    expect(hasMaintenanceShutdownArgument([
      'AltGrid.exe',
      MAINTENANCE_SHUTDOWN_ARGUMENT,
    ])).toBe(true)

    expect(hasMaintenanceShutdownArgument([
      'AltGrid.exe',
      `${MAINTENANCE_SHUTDOWN_ARGUMENT}=true`,
    ])).toBe(false)
  })

  it('does not activate during a normal launch', () => {
    expect(hasMaintenanceShutdownArgument(['AltGrid.exe'])).toBe(false)
  })
})
