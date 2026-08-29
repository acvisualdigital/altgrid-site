import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type UpdaterListener = (...args: unknown[]) => void

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn<(path: string) => boolean>(() => false),
}))
const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))
const electronMocks = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false,
    quit: vi.fn(),
  },
}))
const updaterMocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<UpdaterListener>>()
  const autoUpdater = {
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => [] as string[]),
    disableDifferentialDownload: false,
    logger: {} as unknown,
    off: vi.fn((event: string, listener: UpdaterListener) => {
      listeners.get(event)?.delete(listener)
    }),
    on: vi.fn((event: string, listener: UpdaterListener) => {
      const registered = listeners.get(event) ?? new Set<UpdaterListener>()
      registered.add(listener)
      listeners.set(event, registered)
      return autoUpdater
    }),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  }

  return {
    autoUpdater,
    emit(event: string, ...args: unknown[]): void {
      listeners.get(event)?.forEach((listener) => listener(...args))
    },
    listeners,
  }
})

vi.mock('node:fs', () => ({
  existsSync: fsMocks.existsSync,
}))
vi.mock('node:child_process', () => ({
  spawn: childProcessMocks.spawn,
}))
vi.mock('electron', () => ({
  app: electronMocks.app,
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: updaterMocks.autoUpdater,
  },
}))

import { IPC_CHANNELS } from './contracts.js'
import { UpdaterService } from './updater-service.js'

const originalUpdateOwner = process.env.ALTGRID_UPDATE_OWNER
const originalUpdateRepo = process.env.ALTGRID_UPDATE_REPO
const originalPortableExecutable = process.env.PORTABLE_EXECUTABLE_FILE
const originalResourcesPath = Object.getOwnPropertyDescriptor(
  process,
  'resourcesPath',
)

function createWindow() {
  const send = vi.fn()
  const browserWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send },
  } as unknown as BrowserWindow

  return { browserWindow, send }
}

describe('UpdaterService', () => {
  beforeEach(() => {
    vi.useRealTimers()
    electronMocks.app.isPackaged = false
    electronMocks.app.getVersion.mockReset().mockReturnValue('1.0.0')
    electronMocks.app.quit.mockReset()
    delete process.env.ALTGRID_UPDATE_OWNER
    delete process.env.ALTGRID_UPDATE_REPO
    delete process.env.PORTABLE_EXECUTABLE_FILE
    fsMocks.existsSync.mockReset().mockReturnValue(false)
    childProcessMocks.spawn.mockClear()
    updaterMocks.listeners.clear()
    updaterMocks.autoUpdater.autoDownload = true
    updaterMocks.autoUpdater.allowPrerelease = false
    updaterMocks.autoUpdater.autoInstallOnAppQuit = true
    updaterMocks.autoUpdater.disableDifferentialDownload = false
    updaterMocks.autoUpdater.logger = {}
    updaterMocks.autoUpdater.checkForUpdates.mockReset().mockResolvedValue(null)
    updaterMocks.autoUpdater.downloadUpdate.mockReset().mockResolvedValue([])
    updaterMocks.autoUpdater.off.mockClear()
    updaterMocks.autoUpdater.on.mockClear()
    updaterMocks.autoUpdater.quitAndInstall.mockClear()
    updaterMocks.autoUpdater.setFeedURL.mockReset()
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: 'C:\\AltGrid\\resources',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalUpdateOwner === undefined) {
      delete process.env.ALTGRID_UPDATE_OWNER
    } else {
      process.env.ALTGRID_UPDATE_OWNER = originalUpdateOwner
    }
    if (originalUpdateRepo === undefined) {
      delete process.env.ALTGRID_UPDATE_REPO
    } else {
      process.env.ALTGRID_UPDATE_REPO = originalUpdateRepo
    }
    if (originalPortableExecutable === undefined) {
      delete process.env.PORTABLE_EXECUTABLE_FILE
    } else {
      process.env.PORTABLE_EXECUTABLE_FILE = originalPortableExecutable
    }
    if (originalResourcesPath) {
      Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
    } else {
      Reflect.deleteProperty(process, 'resourcesPath')
    }
  })

  it('stays unsupported in development and never calls the native updater', async () => {
    const { browserWindow } = createWindow()
    const service = new UpdaterService(browserWindow)

    expect(service.getState()).toEqual({ status: 'idle', supported: false })
    await expect(service.checkForUpdates()).resolves.toMatchObject({
      message: expect.stringContaining('somente no aplicativo instalado'),
      status: 'not_available',
      supported: false,
    })
    await expect(service.downloadUpdate()).resolves.toMatchObject({
      status: 'not_available',
      supported: false,
    })
    expect(service.quitAndInstall()).toBe(false)
    expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(updaterMocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(updaterMocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(updaterMocks.autoUpdater.autoDownload).toBe(false)
    expect(updaterMocks.autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(updaterMocks.autoUpdater.disableDifferentialDownload).toBe(true)

    service.stop()
  })

  it('keeps the portable build unsupported even when packaged metadata exists', async () => {
    electronMocks.app.isPackaged = true
    process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\AltGrid\\AltGrid-Portable.exe'
    fsMocks.existsSync.mockReturnValue(true)
    const service = new UpdaterService(createWindow().browserWindow)

    expect(service.getState()).toEqual({ status: 'idle', supported: false })
    await expect(service.checkForUpdates()).resolves.toMatchObject({
      message: expect.stringContaining('versão Portátil'),
      status: 'not_available',
      supported: false,
    })
    expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    service.stop()
  })

  it('follows prerelease updates only from beta installations', () => {
    electronMocks.app.getVersion.mockReturnValue('0.9.0-beta.1')
    const beta = new UpdaterService(createWindow().browserWindow)

    expect(updaterMocks.autoUpdater.allowPrerelease).toBe(true)
    beta.stop()

    updaterMocks.listeners.clear()
    electronMocks.app.getVersion.mockReturnValue('1.0.0')
    const stable = new UpdaterService(createWindow().browserWindow)

    expect(updaterMocks.autoUpdater.allowPrerelease).toBe(false)
    stable.stop()
  })

  it('validates the GitHub provider and falls back only to packaged metadata', () => {
    electronMocks.app.isPackaged = true
    process.env.ALTGRID_UPDATE_OWNER = '../unsafe'
    process.env.ALTGRID_UPDATE_REPO = 'altgrid'
    fsMocks.existsSync.mockReturnValue(true)

    const fallback = new UpdaterService(createWindow().browserWindow)
    expect(fallback.getState().supported).toBe(true)
    expect(updaterMocks.autoUpdater.setFeedURL).not.toHaveBeenCalled()
    fallback.stop()

    updaterMocks.listeners.clear()
    process.env.ALTGRID_UPDATE_OWNER = 'altgrid-org'
    process.env.ALTGRID_UPDATE_REPO = 'desktop_app'
    fsMocks.existsSync.mockReturnValue(false)
    const configured = new UpdaterService(createWindow().browserWindow)

    expect(configured.getState().supported).toBe(true)
    expect(updaterMocks.autoUpdater.setFeedURL).toHaveBeenCalledWith({
      owner: 'altgrid-org',
      provider: 'github',
      repo: 'desktop_app',
    })
    configured.stop()
  })

  it('serializes checks and downloads while publishing sanitized state', async () => {
    electronMocks.app.isPackaged = true
    process.env.ALTGRID_UPDATE_OWNER = 'altgrid'
    process.env.ALTGRID_UPDATE_REPO = 'desktop'
    const { browserWindow, send } = createWindow()
    const service = new UpdaterService(browserWindow)
    const installerPath = 'C:\\Updates\\AltGrid-Setup-2.1.0.exe'
    updaterMocks.autoUpdater.downloadUpdate.mockResolvedValue([installerPath])
    fsMocks.existsSync.mockImplementation((path) => path === installerPath)
    const listener = vi.fn()
    service.subscribe(listener)

    await service.checkForUpdates()
    await service.checkForUpdates()
    expect(updaterMocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()

    updaterMocks.emit('update-available', {
      releaseNotes: '<h1>Correções</h1>   <script>alert(1)</script>',
      version: '2.1.0',
    })
    expect(service.getState()).toEqual({
      releaseNotes: 'Correções alert(1)',
      status: 'available',
      supported: true,
      version: '2.1.0',
    })

    await service.downloadUpdate()
    await service.downloadUpdate()
    expect(updaterMocks.autoUpdater.downloadUpdate).toHaveBeenCalledOnce()
    updaterMocks.emit('download-progress', { percent: 120 })
    expect(service.getState()).toMatchObject({
      percent: 100,
      status: 'downloading',
      version: '2.1.0',
    })
    updaterMocks.emit('update-downloaded', {
      releaseNotes: [{ note: '<b>Pronta para instalar</b>' }],
      version: '2.1.0',
    })

    expect(service.getState()).toEqual({
      releaseNotes: 'Pronta para instalar',
      status: 'downloaded',
      supported: true,
      version: '2.1.0',
    })
    expect(service.quitAndInstall()).toBe(true)
    expect(electronMocks.app.quit).not.toHaveBeenCalled()
    expect(updaterMocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
    expect(listener).toHaveBeenCalled()
    expect(send).toHaveBeenLastCalledWith(
      IPC_CHANNELS.updater.event,
      service.getState(),
    )

    service.stop()
  })

  it('retries a full installer download without requiring repeated user clicks', async () => {
    vi.useFakeTimers()
    electronMocks.app.isPackaged = true
    process.env.ALTGRID_UPDATE_OWNER = 'altgrid'
    process.env.ALTGRID_UPDATE_REPO = 'desktop'
    updaterMocks.autoUpdater.downloadUpdate
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(['C:\\Updates\\AltGrid-Setup-2.1.0.exe'])
    fsMocks.existsSync.mockImplementation((path) => (
      path === 'C:\\Updates\\AltGrid-Setup-2.1.0.exe'
    ))
    const service = new UpdaterService(createWindow().browserWindow)

    updaterMocks.emit('update-available', { version: '2.1.0' })
    const download = service.downloadUpdate()
    await vi.runAllTimersAsync()
    await download

    expect(updaterMocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(3)
    expect(updaterMocks.autoUpdater.disableDifferentialDownload).toBe(true)
    expect(service.getState()).toMatchObject({
      status: 'downloading',
      version: '2.1.0',
    })

    service.stop()
  })

  it('uses a detached Windows helper to wait for remaining processes before installation', async () => {
    electronMocks.app.isPackaged = true
    process.env.ALTGRID_UPDATE_OWNER = 'altgrid'
    process.env.ALTGRID_UPDATE_REPO = 'desktop'
    const installerPath = 'C:\\Updates\\AltGrid-Setup-2.1.0.exe'
    updaterMocks.autoUpdater.downloadUpdate.mockResolvedValue([installerPath])
    fsMocks.existsSync.mockReturnValue(true)
    const service = new UpdaterService(createWindow().browserWindow)

    updaterMocks.emit('update-available', { version: '2.1.0' })
    await service.downloadUpdate()
    updaterMocks.emit('update-downloaded', { version: '2.1.0' })

    expect(service.quitAndInstall()).toBe(true)
    expect(childProcessMocks.spawn).toHaveBeenCalledOnce()
    expect(electronMocks.app.quit).toHaveBeenCalledOnce()
    expect(updaterMocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()

    service.stop()
  })

  it('strips Android-only lines from release notes shown on Windows', async () => {
    electronMocks.app.isPackaged = true
    process.env.ALTGRID_UPDATE_OWNER = 'altgrid'
    process.env.ALTGRID_UPDATE_REPO = 'desktop'
    const service = new UpdaterService(createWindow().browserWindow)

    updaterMocks.emit('update-available', {
      releaseNotes: 'Correções gerais.\nBeta do Android com novos recursos.\nMelhorias de desempenho.',
      version: '2.1.0',
    })

    expect(service.getState()).toMatchObject({
      releaseNotes: 'Correções gerais. Melhorias de desempenho.',
    })

    service.stop()
  })

  it('starts one delayed and one periodic check, then fully detaches on stop', async () => {
    vi.useFakeTimers()
    electronMocks.app.isPackaged = true
    process.env.ALTGRID_UPDATE_OWNER = 'altgrid'
    process.env.ALTGRID_UPDATE_REPO = 'desktop'
    const service = new UpdaterService(createWindow().browserWindow)

    service.start()
    service.start()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(updaterMocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()

    updaterMocks.emit('update-not-available', { version: '2.0.0' })
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000)
    expect(updaterMocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    updaterMocks.emit('update-not-available', { version: '2.0.1' })

    service.stop()
    updaterMocks.emit('update-available', { version: '9.9.9' })
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000)
    expect(updaterMocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(service.getState().version).toBe('2.0.1')
    expect(updaterMocks.autoUpdater.off).toHaveBeenCalledTimes(6)
  })
})
