import { contextBridge, ipcRenderer } from 'electron'

import { SESSION_PRELOAD_CHANNELS } from './contracts.js'

type NativeTimerHandle = ReturnType<typeof globalThis.setTimeout>

interface FrameBudgetState {
  callbacks: Map<number, (timestamp: number) => void>
  frameRate: number
  lastDispatch: number
  nativeCancel: (id: number) => void
  nativeClearTimeout: (id: NativeTimerHandle) => void
  nativeRequest: (callback: (timestamp: number) => void) => number
  nativeSetTimeout: (callback: () => void, delay: number) => NativeTimerHandle
  nextId: number
  schedule: () => void
  scheduledFrame: number | null
  scheduledTimer: NativeTimerHandle | null
}

type FrameBudgetGlobal = typeof globalThis & {
  document?: { hidden: boolean; addEventListener(type: string, callback: () => void): void }
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
      const nativeSetTimeout = page.setTimeout?.bind(page)
      const nativeClearTimeout = page.clearTimeout?.bind(page)

      if (!nativeRequest || !nativeCancel || !nativeSetTimeout || !nativeClearTimeout) {
        return
      }

      let state = page.__altgridFrameBudget
      if (!state) {
        state = {
          callbacks: new Map(),
          frameRate: 0,
          lastDispatch: 0,
          nativeCancel,
          nativeClearTimeout,
          nativeRequest,
          nativeSetTimeout,
          nextId: 1,
          schedule: () => undefined,
          scheduledFrame: null,
          scheduledTimer: null,
        }
        page.__altgridFrameBudget = state

        const schedule = (): void => {
          if (
            !state
            || state.scheduledFrame !== null
            || state.scheduledTimer !== null
            || state.callbacks.size === 0
          ) {
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
              schedule()
              return
            }

            // Preserve the target clock across vsync rounding. Anchoring every
            // budget to the actual (late) frame turns 30 FPS into ~20 FPS on a
            // 60 Hz display, especially when the game also has its own limiter.
            const elapsed = timestamp - state.lastDispatch
            state.lastDispatch = interval > 0 && state.lastDispatch > 0
              && elapsed < interval * 3
              ? state.lastDispatch + Math.max(1, Math.floor((elapsed + 0.5) / interval)) * interval
              : timestamp
            // Match browser rAF semantics: a callback may cancel another one
            // in this same frame. Clearing the map before dispatch made those
            // cancellations ineffective and could leave duplicate game loops.
            const callbackIds = [...state.callbacks.keys()]
            for (const id of callbackIds) {
              const callback = state.callbacks.get(id)
              if (!callback) continue
              state.callbacks.delete(id)
              try {
                callback(timestamp)
              } catch (error) {
                queueMicrotask(() => { throw error })
              }
            }
            schedule()
          }

          const interval = state.frameRate > 0 ? 1_000 / state.frameRate : 0
          const now = page.performance?.now?.() ?? Date.now()
          const remaining = interval > 0 && state.lastDispatch > 0
            ? Math.max(0, interval - (now - state.lastDispatch))
            : 0
          const requestFrame = (): void => {
            if (!state) return
            state.scheduledTimer = null
            if (state.callbacks.size === 0) return
            // Chromium suspends native rAF in hidden WebContentsViews even
            // with background timer throttling disabled. Timer-driven games
            // can keep queuing closures/assets forever while waiting for rAF.
            // Drain that work at the same low budget, without changing sockets
            // or the game's timers.
            if (page.document?.hidden) {
              const hiddenNow = page.performance?.now?.() ?? Date.now()
              const hiddenDelay = interval > 0 && state.lastDispatch > 0
                ? Math.max(1, interval - (hiddenNow - state.lastDispatch))
                : interval > 0 ? 1 : 500
              state.scheduledTimer = state.nativeSetTimeout(() => {
                state!.scheduledTimer = null
                dispatch(page.performance?.now?.() ?? Date.now())
              }, hiddenDelay)
              return
            }
            state.scheduledFrame = state.nativeRequest(dispatch)
          }

          // Waiting outside rAF is the important part: a 1 FPS parked account
          // no longer wakes Chromium roughly 60 times per second just to skip
          // 59 frames. Network requests, timers and the authenticated session
          // remain alive; only visual work follows the configured budget.
          if (remaining > 4) {
            state.scheduledTimer = state.nativeSetTimeout(
              requestFrame,
              Math.max(0, remaining - 1),
            )
          } else {
            requestFrame()
          }
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
          if (state.callbacks.size === 0) {
            if (state.scheduledFrame !== null) {
              state.nativeCancel(state.scheduledFrame)
              state.scheduledFrame = null
            }
            if (state.scheduledTimer !== null) {
              state.nativeClearTimeout(state.scheduledTimer)
              state.scheduledTimer = null
            }
          }
        }
        state.schedule = schedule
        if (page.document) {
          page.document.addEventListener('visibilitychange', () => {
            if (state!.scheduledFrame !== null) {
              state!.nativeCancel(state!.scheduledFrame)
              state!.scheduledFrame = null
            }
            if (state!.scheduledTimer !== null) {
              state!.nativeClearTimeout(state!.scheduledTimer)
              state!.scheduledTimer = null
            }
            state!.schedule()
          })
        }
      }

      const normalizedFrameRate = Number.isInteger(nextFrameRate)
        && nextFrameRate >= 0
        && nextFrameRate <= 240
        ? nextFrameRate
        : 0
      // Layout/focus refreshes can resend the same budget. Resetting its clock
      // gives each duplicate an immediate frame and defeats a low FPS limit.
      if (state.frameRate === normalizedFrameRate) return
      state.frameRate = normalizedFrameRate
      state.lastDispatch = 0
      if (state.scheduledFrame !== null) {
        state.nativeCancel(state.scheduledFrame)
        state.scheduledFrame = null
      }
      if (state.scheduledTimer !== null) {
        state.nativeClearTimeout(state.scheduledTimer)
        state.scheduledTimer = null
      }
      state.schedule()
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
