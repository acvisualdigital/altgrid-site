import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AltgridDesktopApi } from './contracts.js'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => true),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}))

await import('./preload.js')

describe('desktop preload performance bridge', () => {
  beforeEach(() => {
    electronMocks.invoke.mockClear()
  })

  it('exposes Eco Mode and per-session FPS only over dedicated IPC channels', async () => {
    const api = electronMocks.exposeInMainWorld.mock.calls[0]?.[1] as
      | AltgridDesktopApi
      | undefined

    expect(api).toBeDefined()
    await expect(api!.sessions.setEcoMode(true)).resolves.toBe(true)
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'altgrid:sessions:set-eco-mode',
      true,
    )

    await api!.sessions.setEcoMode(true, 24)
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'altgrid:sessions:set-eco-mode',
      true,
      24,
    )

    await api!.sessions.setFrameRate('account-1', 60)
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'altgrid:sessions:set-frame-rate',
      'account-1',
      60,
    )
  })

  it('exposes proxy operations through dedicated IPC channels', async () => {
    const api = electronMocks.exposeInMainWorld.mock.calls[0]?.[1] as
      | AltgridDesktopApi
      | undefined

    await api!.sessions.createSession('account-1', 'https://game.example/', true)
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'altgrid:sessions:create',
      'account-1',
      'https://game.example/',
      true,
    )

    await api!.sessions.getProxy('account-1')
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'altgrid:sessions:get-proxy',
      'account-1',
    )

    await api!.sessions.getResourceUsage()
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'altgrid:sessions:get-resource-usage',
    )

    await api!.sessions.setProxy('account-1', {
      enabled: true,
      host: 'proxy.example',
      password: 'secret',
      port: 8080,
      protocol: 'http',
      username: 'founder',
    })
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'altgrid:sessions:set-proxy',
      'account-1',
      expect.objectContaining({ host: 'proxy.example' }),
    )

    await api!.sessions.testProxy('account-1')
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'altgrid:sessions:test-proxy',
      'account-1',
    )
  })
})
