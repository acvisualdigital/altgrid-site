import { describe, expect, it, vi } from 'vitest'

import type {
  AltgridDesktopApi,
  SessionEvent,
  SessionExtensionSummary,
  SessionProxySummary,
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
    chooseExtension: vi.fn(async (): Promise<SessionExtensionSummary | null> => null),
    clearData: vi.fn(async () => true),
    closeSession: vi.fn(async () => true),
    copyProxy: vi.fn(async (): Promise<SessionProxySummary | null> => null),
    copyExtension: vi.fn(async (): Promise<SessionExtensionSummary | null> => null),
    createSession: vi.fn(async (accountId: string) => snapshot(accountId, false)),
    destroySession: vi.fn(async () => true),
    focusSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    getSessions: vi.fn(async () => [snapshot('account-1', true), snapshot('account-2', true)]),
    getProxy: vi.fn(async (): Promise<SessionProxySummary | null> => null),
    getExtension: vi.fn(async (): Promise<SessionExtensionSummary | null> => null),
    getResourceUsage: vi.fn(async () => []),
    hideSession: vi.fn(async (accountId: string) => snapshot(accountId, false)),
    installHunteraDps: vi.fn(async (): Promise<SessionExtensionSummary> => ({
      enabled: true,
      folderName: 'huntera-dps-altgrid',
      manifestVersion: 3,
      name: 'AltGrid DPS Meter para Huntera',
      permissions: [],
      version: '1.0.0',
    })),
    muteSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    navigateSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    onEvent: vi.fn((listener: (event: SessionEvent) => void) => {
      eventListener = listener
      return () => {
        eventListener = null
      }
    }),
    reloadSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    removeProxy: vi.fn(async () => true),
    removeExtension: vi.fn(async () => true),
    resizeSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    setEcoMode: vi.fn(async (enabled: boolean) => enabled),
    setFrameRate: vi.fn(async (accountId: string, fps: number) => ({
      ...snapshot(accountId, true),
      frameRate: fps,
    })),
    setInterfaceZoom: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    setExtensionEnabled: vi.fn(async (_accountId: string, enabled: boolean): Promise<SessionExtensionSummary> => ({
      enabled,
      folderName: 'test-extension',
      manifestVersion: 3,
      name: 'Test Extension',
      permissions: [],
      version: '1.0.0',
    })),
    setProxy: vi.fn(async (_accountId, input) => ({
      enabled: input.enabled,
      hasPassword: Boolean(input.password),
      host: input.host,
      port: input.port,
      protocol: input.protocol,
      username: input.username ?? '',
    })),
    showSession: vi.fn(async (accountId: string) => snapshot(accountId, true)),
    testProxy: vi.fn(async () => ({
      latencyMs: 1,
      message: 'Rota configurada.',
      ok: true,
      route: 'PROXY proxy.example:8080',
    })),
  } satisfies AltgridDesktopApi['sessions']

  return {
    api,
    emit: (event: SessionEvent) => eventListener?.(event),
    hasListener: () => eventListener !== null,
  }
}

describe('ElectronSessionLauncher', () => {
  it('installs the bundled Huntera DPS Meter for the selected account', async () => {
    const harness = createSessionApi()
    const launcher = new ElectronSessionLauncher(harness.api)

    await launcher.installHunteraDps!({ id: 'huntera-account' })

    expect(harness.api.installHunteraDps).toHaveBeenCalledWith('huntera-account')
  })

  it('copies a stored proxy between isolated account ids', async () => {
    const harness = createSessionApi()
    const summary: SessionProxySummary = {
      enabled: true,
      hasPassword: true,
      host: 'proxy.example.com',
      port: 1080,
      protocol: 'socks5',
      username: 'player',
    }
    harness.api.copyProxy.mockResolvedValue(summary)
    const launcher = new ElectronSessionLauncher(harness.api)

    await expect(launcher.copyProxy({ id: 'source' }, { id: 'copy' }))
      .resolves.toEqual(summary)
    expect(harness.api.copyProxy).toHaveBeenCalledWith('source', 'copy')
  })

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

    await launcher.open({ id: 'account-1' }, {
      allowExtension: false,
      allowProxy: false,
      launchUrl: 'https://game.example/',
    })
    await launcher.focus({ id: 'account-1' })
    await launcher.reload({ id: 'account-1' })
    await launcher.setMuted({ id: 'account-1' }, true)
    await expect(launcher.setEcoMode(true, 20)).resolves.toBe(true)
    await launcher.setFrameRate({ id: 'account-1' }, 45)
    await launcher.setInterfaceScale({ id: 'account-1' }, 0.55)
    await launcher.clearData({ id: 'account-1' })
    await launcher.close({ id: 'account-1' })

    expect(harness.api.createSession).toHaveBeenCalledWith(
      'account-1',
      'https://game.example/',
      false,
      false,
    )
    expect(harness.api.focusSession).toHaveBeenCalledWith('account-1')
    expect(harness.api.reloadSession).toHaveBeenCalledWith('account-1')
    expect(harness.api.muteSession).toHaveBeenCalledWith('account-1', true)
    expect(harness.api.setEcoMode).toHaveBeenCalledWith(true, 20)
    expect(harness.api.setFrameRate).toHaveBeenCalledWith('account-1', 45)
    expect(harness.api.setInterfaceZoom).toHaveBeenCalledWith('account-1', 0.55)
    expect(harness.api.clearData).toHaveBeenCalledWith('account-1')
    expect(harness.api.closeSession).toHaveBeenCalledWith('account-1')
    await expect(launcher.open({ id: 'account-2' }, null)).rejects.toThrow(
      'determinar o endereço',
    )
  })

  it('uses a stored proxy only when the trusted launch target allows it', async () => {
    const harness = createSessionApi()
    const launcher = new ElectronSessionLauncher(harness.api)
    harness.api.getProxy.mockResolvedValue({
      enabled: true,
      hasPassword: true,
      host: 'proxy.example',
      port: 8080,
      protocol: 'http',
      username: 'founder',
    })

    await launcher.open({ id: 'account-1' }, {
      allowExtension: false,
      allowProxy: true,
      launchUrl: 'https://game.example/',
    })

    expect(harness.api.getProxy).toHaveBeenCalledWith('account-1')
    expect(harness.api.createSession).toHaveBeenCalledWith(
      'account-1',
      'https://game.example/',
      true,
      false,
    )
  })

  it('loads a stored extension only when the trusted launch target allows it', async () => {
    const harness = createSessionApi()
    const launcher = new ElectronSessionLauncher(harness.api)

    await launcher.open({ id: 'account-1' }, {
      allowExtension: true,
      allowProxy: false,
      launchUrl: 'https://game.example/',
    })

    expect(harness.api.createSession).toHaveBeenCalledWith(
      'account-1',
      'https://game.example/',
      false,
      true,
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

  it('forwards the switch-account shortcut digit even while a game holds native focus', () => {
    const harness = createSessionApi()
    const launcher = new ElectronSessionLauncher(harness.api)
    const shortcutHandler = vi.fn()
    launcher.registerAccountShortcutHandler(shortcutHandler)

    harness.emit({ accountId: 'account-1', detail: '3', type: 'switch-account' })
    expect(shortcutHandler).toHaveBeenCalledWith('3')

    launcher.dispose()
    harness.emit({ accountId: 'account-1', detail: '4', type: 'switch-account' })
    expect(shortcutHandler).toHaveBeenCalledOnce()
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
