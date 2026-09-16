export type AccountPerformanceMode = 'normal' | 'eco' | 'ultra'
export type AccountVisualState = 'ACTIVE' | 'BACKGROUND' | 'ULTRA_BACKGROUND'

export interface AccountVisualBudget {
  frameRate: number
  state: AccountVisualState
}

/** Visual priorities only. This never pauses JavaScript, network or sockets. */
export class AccountPerformanceManager {
  private mode: AccountPerformanceMode = 'normal'

  setMode(mode: AccountPerformanceMode): boolean {
    if (mode === this.mode) return false
    this.mode = mode
    return true
  }

  getMode(): AccountPerformanceMode { return this.mode }

  budget(input: {
    accountId: string
    activeAccountId: string | null
    accountCount: number
    appBackgrounded: boolean
    desiredFrameRate: number
    ecoSecondaryFrameRate: number
    visible: boolean
  }, mode: AccountPerformanceMode = this.mode): AccountVisualBudget {
    const state: AccountVisualState = !input.visible
      ? 'ULTRA_BACKGROUND'
      : input.accountId === input.activeAccountId
        ? 'ACTIVE'
        : 'BACKGROUND'
    const cap = (ceiling: number): number => input.desiredFrameRate === 0
      ? ceiling : Math.min(input.desiredFrameRate, ceiling)

    if (input.appBackgrounded) return { frameRate: cap(2), state }
    if (mode === 'normal') return { frameRate: input.desiredFrameRate, state }
    if (mode === 'ultra') {
      // Other visible games still receive visual frames; hidden ones are
      // further capped by the native view. Neither path touches heartbeats.
      return { frameRate: cap(state === 'ACTIVE' ? 30 : 2), state }
    }
    const secondary = input.accountCount >= 8
      ? Math.min(input.ecoSecondaryFrameRate, 5)
      : input.accountCount >= 4
        ? Math.min(input.ecoSecondaryFrameRate, 10)
        : input.ecoSecondaryFrameRate
    return { frameRate: cap(state === 'ACTIVE' ? 30 : secondary), state }
  }
}
