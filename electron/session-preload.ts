import { contextBridge, ipcRenderer } from 'electron'

import { SESSION_PRELOAD_CHANNELS } from './contracts.js'

interface FrameBudgetState {
  callbacks: Map<number, (timestamp: number) => void>
  frameRate: number
  lastDispatch: number
  nativeCancel: (id: number) => void
  nativeRequest: (callback: (timestamp: number) => void) => number
  nextId: number
  scheduledFrame: number | null
}

type FrameBudgetGlobal = typeof globalThis & {
  __altgridFrameBudget?: FrameBudgetState
  cancelAnimationFrame?: (id: number) => void
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number
}

function applyFrameRateLimit(frameRate: number): void {
  contextBridge.executeInMainWorld({
    args: [frameRate],
    func: (nextFrameRate: number) => {
      const page = globalThis as FrameBudgetGlobal
      const nativeRequest = page.requestAnimationFrame?.bind(page)
      const nativeCancel = page.cancelAnimationFrame?.bind(page)

      if (!nativeRequest || !nativeCancel) {
        return
      }

      let state = page.__altgridFrameBudget
      if (!state) {
        state = {
          callbacks: new Map(),
          frameRate: 0,
          lastDispatch: 0,
          nativeCancel,
          nativeRequest,
          nextId: 1,
          scheduledFrame: null,
        }
        page.__altgridFrameBudget = state

        const schedule = (): void => {
          if (!state || state.scheduledFrame !== null || state.callbacks.size === 0) {
            return
          }

          const dispatch = (timestamp: number): void => {
            if (!state) {
              return
            }

            state.scheduledFrame = null
            const interval = state.frameRate > 0 ? 1_000 / state.frameRate : 0
            if (
              interval > 0
              && state.lastDispatch > 0
              && timestamp - state.lastDispatch < interval - 0.5
            ) {
              state.scheduledFrame = state.nativeRequest(dispatch)
              return
            }

            state.lastDispatch = timestamp
            const callbacks = [...state.callbacks.entries()]
            state.callbacks.clear()
            for (const [, callback] of callbacks) {
              try {
                callback(timestamp)
              } catch (error) {
                queueMicrotask(() => { throw error })
              }
            }
            schedule()
          }

          state.scheduledFrame = state.nativeRequest(dispatch)
        }

        page.requestAnimationFrame = (callback) => {
          if (typeof callback !== 'function') {
            throw new TypeError('requestAnimationFrame requer uma função.')
          }

          const id = state!.nextId++
          state!.callbacks.set(id, callback)
          schedule()
          return id
        }
        page.cancelAnimationFrame = (id) => {
          if (!state) {
            return
          }
          state.callbacks.delete(id)
          if (state.callbacks.size === 0 && state.scheduledFrame !== null) {
            state.nativeCancel(state.scheduledFrame)
            state.scheduledFrame = null
          }
        }
      }

      state.frameRate = Number.isInteger(nextFrameRate)
        && nextFrameRate >= 0
        && nextFrameRate <= 240
        ? nextFrameRate
        : 0
      state.lastDispatch = 0
    },
  })
}

// Install the scheduler before the remote page's scripts start. The initial
// Auto budget preserves native cadence until the manager sends this account's
// persisted or Eco Mode target.
applyFrameRateLimit(0)

ipcRenderer.on(
  SESSION_PRELOAD_CHANNELS.setFrameRateLimit,
  (_event, frameRate: unknown) => {
    if (
      typeof frameRate === 'number'
      && Number.isInteger(frameRate)
      && frameRate >= 0
      && frameRate <= 240
    ) {
      applyFrameRateLimit(frameRate)
    }
  },
)
