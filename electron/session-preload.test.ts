import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcListener = (event: unknown, frameRate: unknown) => void
declare function requestAnimationFrame(callback: (timestamp: number) => void): number
declare function cancelAnimationFrame(handle: number): void

const electronMocks = vi.hoisted(() => ({
  exposeInIsolatedWorld: vi.fn(),
  executeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => ({ ok: true, status: 204 })),
  listeners: new Map<string, IpcListener>(),
  on: vi.fn((channel: string, listener: IpcListener) => {
    electronMocks.listeners.set(channel, listener)
  }),
}))

vi.mock('electron', () => ({
  contextBridge: {
    executeInMainWorld: electronMocks.executeInMainWorld,
    exposeInIsolatedWorld: electronMocks.exposeInIsolatedWorld,
  },
  ipcRenderer: { invoke: electronMocks.invoke, on: electronMocks.on },
}))

await import('./session-preload.js')

describe('session frame-budget preload', () => {
  beforeEach(() => {
    electronMocks.executeInMainWorld.mockClear()
    electronMocks.invoke.mockClear()
  })

  it('accepts only a validated FPS budget from its private channel', () => {
    const listener = electronMocks.listeners.get(
      'altgrid:session-preload:set-frame-rate-limit',
    )

    expect(listener).toBeDefined()
    listener?.(null, -1)
    listener?.(null, 241)
    listener?.(null, '20')
    expect(electronMocks.executeInMainWorld).not.toHaveBeenCalled()

    listener?.(null, 20)
    expect(electronMocks.executeInMainWorld).toHaveBeenCalledOnce()
    expect(electronMocks.executeInMainWorld.mock.calls[0]?.[0]).toMatchObject({
      args: [20],
      func: expect.any(Function),
    })
  })

  it('waits between limited frames instead of polling native rAF continuously', async () => {
    vi.useFakeTimers()
    const nativeFrames: Array<(timestamp: number) => void> = []
    const nativeRequest = vi.fn((callback: (timestamp: number) => void) => {
      nativeFrames.push(callback)
      return nativeFrames.length
    })
    const nativeCancel = vi.fn()
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    vi.stubGlobal('requestAnimationFrame', nativeRequest)
    vi.stubGlobal('cancelAnimationFrame', nativeCancel)

    try {
      const listener = electronMocks.listeners.get(
        'altgrid:session-preload:set-frame-rate-limit',
      )
      listener?.(null, 1)
      const installer = electronMocks.executeInMainWorld.mock.calls[0]?.[0]
        ?.func as ((frameRate: number) => void) | undefined
      expect(installer).toBeDefined()
      installer?.(1)

      const page = globalThis as typeof globalThis & {
        requestAnimationFrame(callback: (timestamp: number) => void): number
      }
      let renderedFrames = 0
      const animationLoop = () => {
        renderedFrames += 1
        page.requestAnimationFrame(animationLoop)
      }
      page.requestAnimationFrame(animationLoop)
      expect(nativeRequest).toHaveBeenCalledOnce()

      nativeFrames.shift()?.(1_000)
      expect(renderedFrames).toBe(1)
      // The old implementation requested another native frame immediately
      // and then polled at monitor cadence. A 1 FPS budget now sleeps instead.
      expect(nativeRequest).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(998)
      expect(nativeRequest).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      expect(nativeRequest).toHaveBeenCalledTimes(2)
    } finally {
      performanceNow.mockRestore()
      delete (globalThis as typeof globalThis & { __altgridFrameBudget?: unknown })
        .__altgridFrameBudget
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('honors cancellation inside a frame and keeps new callbacks for the next frame', () => {
    const frames: Array<(time: number) => void> = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => frames.push(callback)))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    try {
      electronMocks.listeners.get('altgrid:session-preload:set-frame-rate-limit')?.(null, 0)
      const install = electronMocks.executeInMainWorld.mock.calls[0]![0].func
      install(0)
      const canceled = vi.fn()
      const next = vi.fn()
      let canceledId = 0
      requestAnimationFrame(() => {
        cancelAnimationFrame(canceledId)
        requestAnimationFrame(next)
      })
      canceledId = requestAnimationFrame(canceled)
      frames.shift()?.(1_000)
      expect(canceled).not.toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
      frames.shift()?.(1_017)
      expect(next).toHaveBeenCalledOnce()
    } finally {
      delete (globalThis as typeof globalThis & { __altgridFrameBudget?: unknown }).__altgridFrameBudget
      vi.unstubAllGlobals()
    }
  })

  it('does not reset the frame deadline when the same FPS arrives repeatedly', async () => {
    vi.useFakeTimers()
    const frames: Array<(time: number) => void> = []
    const request = vi.fn((callback) => frames.push(callback))
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    try {
      electronMocks.listeners.get('altgrid:session-preload:set-frame-rate-limit')?.(null, 2)
      const install = electronMocks.executeInMainWorld.mock.calls[0]![0].func
      install(2)
      const loop = () => requestAnimationFrame(loop)
      requestAnimationFrame(loop)
      frames.shift()?.(1_000)
      for (let i = 0; i < 4; i += 1) {
        now.mockReturnValue(1_000 + i * 100)
        install(2)
        await vi.advanceTimersByTimeAsync(100)
      }
      expect(request).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(99)
      expect(request).toHaveBeenCalledTimes(2)
      expect(cancel).not.toHaveBeenCalled()
    } finally {
      now.mockRestore()
      delete (globalThis as typeof globalThis & { __altgridFrameBudget?: unknown }).__altgridFrameBudget
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
