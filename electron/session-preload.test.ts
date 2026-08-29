import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcListener = (event: unknown, frameRate: unknown) => void

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

  it('exposes the STONER webhook bridge only in its isolated world', async () => {
    expect(electronMocks.exposeInIsolatedWorld).toHaveBeenCalledWith(
      10_007,
      'altgridStoner',
      expect.objectContaining({ sendDiscordWebhook: expect.any(Function) }),
    )
    const bridge = electronMocks.exposeInIsolatedWorld.mock.calls[0]?.[2] as {
      sendDiscordWebhook(webhook: string, payload: unknown): Promise<unknown>
    }
    await bridge.sendDiscordWebhook('https://discord.com/api/webhooks/1/token', { ok: true })
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'altgrid:session-preload:stoner-discord-webhook',
      'https://discord.com/api/webhooks/1/token',
      { ok: true },
    )
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
