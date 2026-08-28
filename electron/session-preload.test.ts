import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcListener = (event: unknown, frameRate: unknown) => void

const electronMocks = vi.hoisted(() => ({
  executeInMainWorld: vi.fn(),
  listeners: new Map<string, IpcListener>(),
  on: vi.fn((channel: string, listener: IpcListener) => {
    electronMocks.listeners.set(channel, listener)
  }),
}))

vi.mock('electron', () => ({
  contextBridge: { executeInMainWorld: electronMocks.executeInMainWorld },
  ipcRenderer: { on: electronMocks.on },
}))

await import('./session-preload.js')

describe('session frame-budget preload', () => {
  beforeEach(() => {
    electronMocks.executeInMainWorld.mockClear()
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
})
