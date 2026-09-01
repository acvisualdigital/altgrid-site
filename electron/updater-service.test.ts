import type { BrowserWindow } from 'electron'
import type { UpdateInfo, VelopackAsset } from 'velopack'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => '1.5.0'),
    isPackaged: false,
    quit: vi.fn(),
  },
}))

const velopackMocks = vi.hoisted(() => {
  const manager = {
    checkForUpdatesAsync: vi.fn<() => Promise<UpdateInfo | null>>(async () => null),
    downloadUpdateAsync: vi.fn<(
      update: UpdateInfo,
      progress?: (percent: number) => void,
    ) => Promise<void>>(async () => undefined),
    getUpdatePendingRestart: vi.fn<() => VelopackAsset | null>(() => null),
    isPortable: vi.fn(() => false),
    waitExitThenApplyUpdate: vi.fn(),
  }
  const UpdateManager = vi.fn(function MockUpdateManager() {
    return manager
  })
  return { manager, UpdateManager }
})

vi.mock('electron', () => ({ app: electronMocks.app }))
vi.mock('velopack', () => ({ UpdateManager: velopackMocks.UpdateManager }))

import { IPC_CHANNELS } from './contracts.js'
import { UpdaterService } from './updater-service.js'

const originalUpdateUrl = process.env.ALTGRID_UPDATE_URL
const originalPortableExecutable = process.env.PORTABLE_EXECUTABLE_FILE

function asset(version: string, notes = ''): VelopackAsset {
  return {
    FileName: `AltGrid-${version}-full.nupkg`,
    NotesHtml: '',
    NotesMarkdown: notes,
    PackageId: 'io.altgrid.desktop',
    SHA1: 'sha1',
    SHA256: 'sha256',
    Size: 123,
    Type: 'Full',
    Version: version,
  }
}

function update(version: string, notes = ''): UpdateInfo {
  return {
    DeltasToTarget: [],
    IsDowngrade: false,
    TargetFullRelease: asset(version, notes),
  }
}

function createWindow() {
  const send = vi.fn()
  const browserWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send },
  } as unknown as BrowserWindow
  return { browserWindow, send }
}

describe('UpdaterService with Velopack launcher', () => {
  beforeEach(() => {
    vi.useRealTimers()
    electronMocks.app.isPackaged = false
    electronMocks.app.getVersion.mockReset().mockReturnValue('1.5.0')
    electronMocks.app.quit.mockReset()
    delete process.env.ALTGRID_UPDATE_URL
    delete process.env.PORTABLE_EXECUTABLE_FILE
    velopackMocks.UpdateManager.mockClear()
    velopackMocks.manager.checkForUpdatesAsync.mockReset().mockResolvedValue(null)
    velopackMocks.manager.downloadUpdateAsync.mockReset().mockResolvedValue(undefined)
    velopackMocks.manager.getUpdatePendingRestart.mockReset().mockReturnValue(null)
    velopackMocks.manager.isPortable.mockReset().mockReturnValue(false)
    velopackMocks.manager.waitExitThenApplyUpdate.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalUpdateUrl === undefined) delete process.env.ALTGRID_UPDATE_URL
    else process.env.ALTGRID_UPDATE_URL = originalUpdateUrl
    if (originalPortableExecutable === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE
    else process.env.PORTABLE_EXECUTABLE_FILE = originalPortableExecutable
  })

  it('stays unsupported in development without touching the native launcher', async () => {
    const service = new UpdaterService(createWindow().browserWindow, 'win32')

    expect(service.getState()).toEqual({ status: 'idle', supported: false })
    await expect(service.checkForUpdates()).resolves.toMatchObject({
      message: expect.stringContaining('aplicativo instalado'),
      status: 'not_available',
      supported: false,
    })
    expect(velopackMocks.UpdateManager).not.toHaveBeenCalled()
    expect(service.quitAndInstall()).toBe(false)
  })

  it('keeps the Windows launcher disabled on packaged macOS builds', () => {
    electronMocks.app.isPackaged = true
    const service = new UpdaterService(createWindow().browserWindow, 'darwin')

    expect(service.getState()).toEqual({ status: 'idle', supported: false })
    expect(velopackMocks.UpdateManager).not.toHaveBeenCalled()
  })

  it('accepts HTTPS and loopback HTTP feeds but rejects unsafe URLs', () => {
    electronMocks.app.isPackaged = true
    process.env.ALTGRID_UPDATE_URL = 'http://127.0.0.1:4567/windows/'
    const local = new UpdaterService(createWindow().browserWindow, 'win32')
    expect(local.getState().supported).toBe(true)
    expect(velopackMocks.UpdateManager).toHaveBeenLastCalledWith(
      'http://127.0.0.1:4567/windows/',
      { AllowVersionDowngrade: false, MaximumDeltasBeforeFallback: 5 },
    )

    process.env.ALTGRID_UPDATE_URL = 'http://updates.example.com/'
    const unsafe = new UpdaterService(createWindow().browserWindow, 'win32')
    expect(unsafe.getState().supported).toBe(false)
  })

  it('uses the stable AltGrid update endpoint by default', () => {
    electronMocks.app.isPackaged = true
    new UpdaterService(createWindow().browserWindow, 'win32')

    expect(velopackMocks.UpdateManager).toHaveBeenLastCalledWith(
      'https://altgrid-api.altgrid.workers.dev/v1/updates/',
      { AllowVersionDowngrade: false, MaximumDeltasBeforeFallback: 5 },
    )
  })

  it('keeps portable and legacy NSIS installations out of the launcher path', async () => {
    electronMocks.app.isPackaged = true
    process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\AltGrid\\AltGrid-Portable.exe'
    const portable = new UpdaterService(createWindow().browserWindow, 'win32')
    await expect(portable.checkForUpdates()).resolves.toMatchObject({
      message: expect.stringContaining('Portátil'),
      supported: false,
    })

    delete process.env.PORTABLE_EXECUTABLE_FILE
    velopackMocks.UpdateManager.mockImplementationOnce(() => {
      throw new Error('not installed by Velopack')
    })
    const legacy = new UpdaterService(createWindow().browserWindow, 'win32')
    await expect(legacy.checkForUpdates()).resolves.toMatchObject({
      message: expect.stringContaining('instalador antigo'),
      supported: false,
    })
  })

  it('checks, sanitizes notes, downloads with progress and hands off atomically', async () => {
    electronMocks.app.isPackaged = true
    const available = update(
      '1.5.1',
      '# Correções gerais\nAndroid: beta separado\n**Launcher mais estável**',
    )
    velopackMocks.manager.checkForUpdatesAsync.mockResolvedValue(available)
    velopackMocks.manager.downloadUpdateAsync.mockImplementation(async (_info, progress) => {
      progress?.(42)
      progress?.(120)
    })
    const { browserWindow, send } = createWindow()
    const service = new UpdaterService(browserWindow, 'win32')
    const listener = vi.fn()
    service.subscribe(listener)

    await expect(service.checkForUpdates()).resolves.toEqual({
      releaseNotes: 'Correções gerais Launcher mais estável',
      status: 'available',
      supported: true,
      version: '1.5.1',
    })
    await expect(service.downloadUpdate()).resolves.toMatchObject({
      percent: 100,
      status: 'downloaded',
      version: '1.5.1',
    })
    expect(service.quitAndInstall()).toBe(true)
    expect(velopackMocks.manager.waitExitThenApplyUpdate).toHaveBeenCalledWith(
      available,
      false,
      true,
    )
    expect(electronMocks.app.quit).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalled()
    expect(send).toHaveBeenLastCalledWith(
      IPC_CHANNELS.updater.event,
      service.getState(),
    )
  })

  it('retries interrupted downloads without another user click', async () => {
    vi.useFakeTimers()
    electronMocks.app.isPackaged = true
    const available = update('1.5.1')
    velopackMocks.manager.checkForUpdatesAsync.mockResolvedValue(available)
    velopackMocks.manager.downloadUpdateAsync
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(undefined)
    const service = new UpdaterService(createWindow().browserWindow, 'win32')

    await service.checkForUpdates()
    const downloading = service.downloadUpdate()
    await vi.runAllTimersAsync()
    await downloading

    expect(velopackMocks.manager.downloadUpdateAsync).toHaveBeenCalledTimes(3)
    expect(service.getState()).toMatchObject({ status: 'downloaded' })
  })

  it('recovers and applies a downloaded update pending restart', () => {
    electronMocks.app.isPackaged = true
    velopackMocks.manager.getUpdatePendingRestart.mockReturnValue(
      asset('1.5.1', 'Pronta para reiniciar'),
    )
    const service = new UpdaterService(createWindow().browserWindow, 'win32')

    expect(service.getState()).toEqual({
      releaseNotes: 'Pronta para reiniciar',
      status: 'downloaded',
      supported: true,
      version: '1.5.1',
    })
    expect(service.quitAndInstall()).toBe(true)
    expect(velopackMocks.manager.waitExitThenApplyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ Version: '1.5.1' }),
      false,
      true,
    )
  })

  it('starts one delayed and one periodic check and stops both timers', async () => {
    vi.useFakeTimers()
    electronMocks.app.isPackaged = true
    const service = new UpdaterService(createWindow().browserWindow, 'win32')

    service.start()
    service.start()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(velopackMocks.manager.checkForUpdatesAsync).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000)
    expect(velopackMocks.manager.checkForUpdatesAsync).toHaveBeenCalledTimes(2)
    service.stop()
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000)
    expect(velopackMocks.manager.checkForUpdatesAsync).toHaveBeenCalledTimes(2)
  })
})
