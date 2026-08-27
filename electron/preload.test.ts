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

describe('desktop preload Eco Mode bridge', () => {
  beforeEach(() => {
    electronMocks.invoke.mockClear()
  })

  it('exposes only the boolean Eco Mode command over its dedicated IPC channel', async () => {
    const api = electronMocks.exposeInMainWorld.mock.calls[0]?.[1] as
      | AltgridDesktopApi
      | undefined

    expect(api).toBeDefined()
    await expect(api!.sessions.setEcoMode(true)).resolves.toBe(true)
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'altgrid:sessions:set-eco-mode',
      true,
    )
  })
})
