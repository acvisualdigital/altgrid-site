import { describe, expect, it, vi } from 'vitest'

import type {
  AltgridDesktopApi,
  SessionEvent,
  SessionSnapshot,
} from '../../electron/contracts'
import type { GridLayout } from './grid-layout-service'
import {
  ElectronSessionLauncher,
  createElectronDesktopIntegration,
} from './electron-desktop-adapter'

function snapshot(
  accountId: string,
  visible: boolean,
  bounds: SessionSnapshot['bounds'] = { height: 1, width: 1, x: 0, y: 0 },
): SessionSnapshot {
  return {
    accountId,
    bounds,
    frameRate: 0,
    muted: false,
    partition: `persist:${accountId}`,
    status: 'ready',
    url: 'https://game.example/',
    visible,
  }
}

function createSessionApi() {
  let eventListener: ((event: SessionEvent) => void) | null = null
  const api = {
    clearData: vi.fn(async () => true),
    closeSession: vi.fn(async () => true),
    createSession: vi.fn(async (accountId: string) => snapshot(accountId, false)),
    destroySession: vi.fn(async () => true),
    focusSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    getSessions: vi.fn(async () => [snapshot('account-1', true), snapshot('account-2', true)]),
    hideSession: vi.fn(async (accountId: string) => snapshot(accountId, false)),
    muteSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    navigateSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    onEvent: vi.fn((listener: (event: SessionEvent) => void) => {
      eventListener = listener
      return () => {
        eventListener = null
      }
    }),
    reloadSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    resizeSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    setEcoMode: vi.fn(async (enabled: boolean) => enabled),
    setFrameRate: vi.fn(async (accountId: string, fps: number) => ({
      ...snapshot(accountId, true),
      frameRate: fps,
    })),
    showSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
  } satisfies AltgridDesktopApi['sessions']

  return {
    api,
    emit: (event: SessionEvent) => eventListener?.(event),
    hasListener: () => eventListener !== null,
  }
}

describe('ElectronSessionLauncher', () => {
  it('repositions existing native views without recreating or navigating them', async () => {
    const harness = createSessionApi()
    const launcher = new ElectronSessionLauncher(harness.api)
    harness.api.getSessions.mockResolvedValue([
      snapshot('account-1', false),
      snapshot('account-2', true),
    ])
    const layout = {
      capacity: 1,
      columns: 1,
      overflowSessionIds: ['account-2'],
      pageCount: 2,
      pageIndex: 0,
      requestedMode: '1x1',
      resolvedMode: '1x1',
      rows: 1,
      slots: [{
        bounds: { height: 499.6, width: 799.7, x: -0.4, y: 20.2 },
        column: 0,
        index: 0,
        row: 0,
        sessionId: 'account-1',
      }],
    } satisfies GridLayout

    await launcher.applyLayout(layout)

    expect(harness.api.hideSession).toHaveBeenCalledWith('account-2')
    expect(harness.api.resizeSession).toHaveBeenCalledWith('account-1', {
      height: 500,
      width: 799,
      x: 0,
      y: 20,
    })
    expect(harness.api.showSession).toHaveBeenCalledWith('account-1')
    expect(harness.api.createSession).not.toHaveBeenCalled()
    expect(harness.api.navigateSession).not.toHaveBeenCalled()
  })

  it('skips redundant resize and show IPC when layout already matches the native view', async () => {
    const harness = createSessionApi()
    const launcher = new ElectronSessionLauncher(harness.api)
    const bounds = { height: 500, width: 799, x: 0, y: 20 }
    harness.api.getSessions.mockResolvedValue([
      snapshot('account-1', true, bounds),
    ])
    const layout = {
      capacity: 1,
      columns: 1,
      overflowSessionIds: [],
      pageCount: 1,
      pageIndex: 0,
      requestedMode: '1x1',
      resolvedMode: '1x1',
      rows: 1,
      slots: [{
        bounds: { height: 499.6, width: 799.7, x: -0.4, y: 20.2 },
        column: 0,
        index: 0,
        row: 0,
        sessionId: 'account-1',
      }],
    } satisfies GridLayout

    await launcher.applyLayout(layout)
    await launcher.applyLayout(layout)

    expect(harness.api.getSessions).toHaveBeenCalledTimes(2)
    expect(harness.api.resizeSession).not.toHaveBeenCalled()
    expect(harness.api.showSession).not.toHaveBeenCalled()
    expect(harness.api.hideSession).not.toHaveBeenCalled()
  })

  it('opens only a validated target through main-process IPC and delegates controls', async () => {
    const harness = createSessionApi()
    const launcher = new ElectronSessionLauncher(harness.api)

    await launcher.open({ id: 'account-1' }, { launchUrl: 'https://game.example/' })
    await launcher.focus({ id: 'account-1' })
    await launcher.reload({ id: 'account-1' })
    await launcher.setMuted({ id: 'account-1' }, true)
    await expect(launcher.setEcoMode(true, 20)).resolves.toBe(true)
    await launcher.setFrameRate({ id: 'account-1' }, 45)
    await launcher.clearData({ id: 'account-1' })
    await launcher.close({ id: 'account-1' })

    expect(harness.api.createSession).toHaveBeenCalledWith(
      'account-1',
      'https://game.example/',
    )
    expect(harness.api.focusSession).toHaveBeenCalledWith('account-1')
    expect(harness.api.reloadSession).toHaveBeenCalledWith('account-1')
    expect(harness.api.muteSession).toHaveBeenCalledWith('account-1', true)
    expect(harness.api.setEcoMode).toHaveBeenCalledWith(true, 20)
    expect(harness.api.setFrameRate).toHaveBeenCalledWith('account-1', 45)
    expect(harness.api.clearData).toHaveBeenCalledWith('account-1')
    expect(harness.api.closeSession).toHaveBeenCalledWith('account-1')
    await expect(launcher.open({ id: 'account-2' }, null)).rejects.toThrow(
      'determinar o endereço',
    )
  })

  it('forwards Escape from a focused game view and removes listeners on dispose', () => {
    const harness = createSessionApi()
    const launcher = new ElectronSessionLauncher(harness.api)
    const escapeHandler = vi.fn()
    launcher.registerEscapeHandler(escapeHandler)

    harness.emit({ accountId: 'account-1', type: 'escape' })
    expect(escapeHandler).toHaveBeenCalledOnce()

    launcher.dispose()
    expect(harness.hasListener()).toBe(false)
  })

  it('hides an interrupted native view and makes it visible again after reload', async () => {
    const harness = createSessionApi()
    const launcher = new ElectronSessionLauncher(harness.api)
    const statusHandler = vi.fn()
    launcher.registerStatusHandler(statusHandler)

    harness.emit({
      accountId: 'account-1',
      detail: 'Sessão interrompida.',
      type: 'crashed',
    })
    await vi.waitFor(() => {
      expect(harness.api.hideSession).toHaveBeenCalledWith('account-1')
    })
    expect(statusHandler).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      type: 'crashed',
    }))

    await launcher.reload({ id: 'account-1' })
    harness.api.getSessions.mockResolvedValue([
      snapshot('account-1', false),
    ])
    await launcher.applyLayout({
      capacity: 1,
      columns: 1,
      overflowSessionIds: [],
      pageCount: 1,
      pageIndex: 0,
      requestedMode: '1x1',
      resolvedMode: '1x1',
      rows: 1,
      slots: [{
        bounds: { height: 500, width: 800, x: 0, y: 0 },
        column: 0,
        index: 0,
        row: 0,
        sessionId: 'account-1',
      }],
    })

    expect(harness.api.showSession).toHaveBeenCalledWith('account-1')
    launcher.dispose()
  })
})

describe('createElectronDesktopIntegration', () => {
  it('uses main-process external opening and rejects denied schemes', async () => {
    const sessions = createSessionApi().api
    const openExternal = vi.fn(async (url: string) => url.startsWith('https://'))
    const updater = {
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      getState: vi.fn(),
      onStateChange: vi.fn(() => () => undefined),
      quitAndInstall: vi.fn(),
    } as unknown as AltgridDesktopApi['updater']
    const integration = createElectronDesktopIntegration({
      app: {
        getPlatform: vi.fn(),
        getVersion: vi.fn(),
        openExternal,
      },
      sessions,
      updater,
    })!

    await expect(integration.openExternalUrl('https://altgrid.example/')).resolves.toBeUndefined()
    await expect(integration.openExternalUrl('file:///secret')).rejects.toThrow(
      'não é permitido',
    )
    integration.dispose()
  })

  it('stays inert in the regular browser build', () => {
    expect(createElectronDesktopIntegration(null)).toBeNull()
  })
})
