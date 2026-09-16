import { describe, expect, it } from 'vitest'
import { AccountPerformanceManager } from './account-performance-manager.js'

describe('AccountPerformanceManager', () => {
  const input = {
    accountId: 'a', activeAccountId: 'a', accountCount: 4,
    appBackgrounded: false, desiredFrameRate: 0,
    ecoSecondaryFrameRate: 20, visible: true,
  }

  it('keeps Normal unlimited and classifies visibility', () => {
    const manager = new AccountPerformanceManager()
    expect(manager.budget(input)).toEqual({ frameRate: 0, state: 'ACTIVE' })
    expect(manager.budget({ ...input, visible: false })).toEqual({ frameRate: 0, state: 'ULTRA_BACKGROUND' })
  })

  it('caps visual work progressively without changing the desired user limit', () => {
    const manager = new AccountPerformanceManager()
    manager.setMode('eco')
    expect(manager.budget(input).frameRate).toBe(30)
    expect(manager.budget({ ...input, accountId: 'b' }).frameRate).toBe(10)
    expect(manager.budget({ ...input, accountId: 'b', accountCount: 8 }).frameRate).toBe(5)
    manager.setMode('ultra')
    expect(manager.budget(input).frameRate).toBe(30)
    expect(manager.budget({ ...input, accountId: 'b' }).frameRate).toBe(2)
    expect(manager.budget({ ...input, accountId: 'b', desiredFrameRate: 1 }).frameRate).toBe(1)
    expect(manager.budget({ ...input, appBackgrounded: true }).frameRate).toBe(2)
  })
})
