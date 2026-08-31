import './velopack-bootstrap.js'

import { existsSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'

import {
  IPC_CHANNELS,
  SESSION_PRELOAD_CHANNELS,
  type SessionBounds,
  type SessionProxyInput,
} from './contracts.js'
import { hasMaintenanceShutdownArgument } from './lifecycle-policy.js'
import {
  clearNativeSessionPartition,
  createNativeSessionViewFactory,
} from './native-session-view.js'
import { SessionManager } from './session-manager.js'
import { ProxyConfigStore } from './proxy-config-store.js'
import { ExtensionConfigStore } from './extension-config-store.js'
import { configureShellSecurity } from './shell-security.js'
import { UpdaterService } from './updater-service.js'
import {
  findTrustedRecoveryDeepLink,
  isSafeExternalUrl,
  isTrustedShellUrl,
  parseTrustedRecoveryDeepLink,
  recoveryDeepLinkToShellUrl,
} from './url-policy.js'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const LOCAL_SHELL_SCHEME = 'altgrid'
const LOCAL_SHELL_HOST = 'app'
const LOCAL_SHELL_ENTRY_URL = `${LOCAL_SHELL_SCHEME}://${LOCAL_SHELL_HOST}/`

protocol.registerSchemesAsPrivileged([{
  privileges: {
    allowServiceWorkers: false,
    bypassCSP: false,
    corsEnabled: true,
    secure: true,
    standard: true,
    stream: true,
    supportFetchAPI: true,
  },
  scheme: LOCAL_SHELL_SCHEME,
}])

// Each account owns an isolated Chromium renderer. Keep those renderers lean
// without disabling GPU acceleration or suspending the game/network loop.
// A bounded V8 heap encourages earlier collection on idle games, while the
// back/forward cache is unnecessary for the single-page game sessions and can
// otherwise retain complete, hidden page trees after navigation.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=320 --expose-gc')
app.commandLine.appendSwitch('disable-features', 'BackForwardCache')
// Chromium still keeps WebGL accelerated, but evicts discardable textures and
// raster resources before the shared GPU process grows without a useful bound
// across large grids. One GiB leaves ample room for smooth idle-game rendering.
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '1024')
// The development shell is rebuilt in place by Vite. Chromium's persistent
// cache can otherwise keep a stale asset response under a TypeScript module
// URL, leaving the local app on a black screen until its profile is cleared.
// Packaged builds keep the normal HTTP cache.
if (process.env.ALTGRID_DEV_SERVER_URL) {
  app.commandLine.appendSwitch('disable-http-cache')
  // Keep local validation independent from an installed AltGrid instance.
  // This prevents the production single-instance lock and saved sessions from
  // closing or redirecting the development window during catalog/update tests.
  app.setPath('userData', resolve(process.cwd(), '.altgrid-dev-profile'))
}
app.enableSandbox()
const singleInstanceLock = app.requestSingleInstanceLock()

let mainWindow: BrowserWindow | null = null
let sessionManager: SessionManager | null = null
let proxyConfigStore: ProxyConfigStore | null = null
let extensionConfigStore: ExtensionConfigStore | null = null
let updaterService: UpdaterService | null = null
let shellEntryUrl: string | null = null
let pendingRecoveryDeepLink = findTrustedRecoveryDeepLink(process.argv)
let forcedExitTimer: NodeJS.Timeout | null = null

function armForcedExitFallback(): void {
  if (forcedExitTimer) {
    return
  }

  // If a renderer, GPU or network child refuses to leave, do not keep an
  // invisible AltGrid process tree alive indefinitely. Normal exits complete
  // before this watchdog fires.
  forcedExitTimer = setTimeout(() => app.exit(0), 5_000)
}

function prepareForApplicationExit(): void {
  armForcedExitFallback()
  updaterService?.stop()
  sessionManager?.destroyAll()
}

function shutdownForMaintenance(): void {
  prepareForApplicationExit()
  app.quit()
}

function registerDeepLinkProtocol(): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(
      LOCAL_SHELL_SCHEME,
      process.execPath,
      [resolve(process.argv[1])],
    )
    return
  }

  app.setAsDefaultProtocolClient(LOCAL_SHELL_SCHEME)
}

async function presentRecoveryDeepLink(candidate: unknown): Promise<void> {
  const deepLink = parseTrustedRecoveryDeepLink(candidate)

  if (!deepLink) {
    return
  }

  pendingRecoveryDeepLink = deepLink

  if (!app.isReady()) {
    return
  }

  if (!mainWindow || mainWindow.isDestroyed() || !shellEntryUrl) {
    await createMainWindow()
    return
  }

  const targetUrl = recoveryDeepLinkToShellUrl(deepLink, shellEntryUrl)
  if (!targetUrl) {
    return
  }

  pendingRecoveryDeepLink = null
  sessionManager?.destroyAll()
  await mainWindow.loadURL(targetUrl)

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

function requireShellSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || !shellEntryUrl
    || event.sender.id !== mainWindow.webContents.id
    || event.senderFrame !== mainWindow.webContents.mainFrame
    || !isTrustedShellUrl(event.senderFrame.url, shellEntryUrl)
  ) {
    throw new Error('IPC rejeitado: origem não confiável.')
  }
}

function requireSessionManager(event: IpcMainInvokeEvent): SessionManager {
  requireShellSender(event)

  if (!sessionManager) {
    throw new Error('O gerenciador de sessões ainda não está disponível.')
  }

  return sessionManager
}

function requireUpdater(event: IpcMainInvokeEvent): UpdaterService {
  requireShellSender(event)

  if (!updaterService) {
    throw new Error('O serviço de atualização ainda não está disponível.')
  }

  return updaterService
}

function requireProxyStore(event: IpcMainInvokeEvent): ProxyConfigStore {
  requireShellSender(event)

  if (!proxyConfigStore) {
    throw new Error('O cofre de proxies ainda não está disponível.')
  }

  return proxyConfigStore
}

function requireExtensionStore(event: IpcMainInvokeEvent): ExtensionConfigStore {
  requireShellSender(event)
  if (!extensionConfigStore) throw new Error('As extensões ainda não estão disponíveis.')
  return extensionConfigStore
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.app.getPlatform, (event) => {
    requireShellSender(event)
    return process.platform
  })
  ipcMain.handle(IPC_CHANNELS.app.getVersion, (event) => {
    requireShellSender(event)
    return app.getVersion()
  })
  ipcMain.handle(IPC_CHANNELS.app.openExternal, async (event, url) => {
    requireShellSender(event)

    if (!isSafeExternalUrl(url)) {
      return false
    }

    await shell.openExternal(url)
    return true
  })

  ipcMain.handle(
    IPC_CHANNELS.sessions.create,
    (event, accountId, url, useStoredProxy = false, useStoredExtension = false) => {
      const manager = requireSessionManager(event)
      const proxy = useStoredProxy
        ? requireProxyStore(event).get(accountId)
        : null
      const extension = useStoredExtension
        ? requireExtensionStore(event).get(accountId)
        : null
      return manager.createSession(
        accountId,
        url,
        proxy?.enabled ? proxy : null,
        extension?.enabled ? extension.path : null,
      )
    },
  )
  ipcMain.handle(IPC_CHANNELS.sessions.getExtension, (event, accountId) => (
    requireExtensionStore(event).getSummary(accountId)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.copyExtension, (event, sourceAccountId, targetAccountId) => (
    requireExtensionStore(event).copy(sourceAccountId, targetAccountId)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.chooseExtension, async (event, accountId) => {
    const manager = requireSessionManager(event)
    const store = requireExtensionStore(event)
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const selection = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: 'Usar nesta conta',
      message: 'Selecione a pasta descompactada da extensão (com manifest.json).',
      properties: ['openDirectory'],
      title: 'Selecionar extensão do navegador',
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    const previous = store.get(accountId)
    const chosen = store.setFromDirectory(accountId, selection.filePaths[0])
    try {
      if (manager.getSessions().some((candidate) => candidate.accountId === accountId)) {
        const current = store.get(accountId)
        await manager.setSessionExtension(accountId, current?.enabled ? current.path : null)
      }
      return chosen
    } catch (error) {
      if (previous) {
        store.setFromDirectory(accountId, previous.path)
        store.setEnabled(accountId, previous.enabled)
      } else {
        store.remove(accountId)
      }
      throw error
    }
  })
  ipcMain.handle(IPC_CHANNELS.sessions.setExtensionEnabled, async (event, accountId, enabled) => {
    const manager = requireSessionManager(event)
    const store = requireExtensionStore(event)
    const previous = store.get(accountId)
    const updated = store.setEnabled(accountId, enabled)
    try {
      if (manager.getSessions().some((candidate) => candidate.accountId === accountId)) {
        const current = store.get(accountId)
        await manager.setSessionExtension(accountId, current?.enabled ? current.path : null)
      }
      return updated
    } catch (error) {
      if (previous) store.setEnabled(accountId, previous.enabled)
      throw error
    }
  })
  ipcMain.handle(IPC_CHANNELS.sessions.removeExtension, async (event, accountId) => {
    const manager = requireSessionManager(event)
    const store = requireExtensionStore(event)
    if (manager.getSessions().some((candidate) => candidate.accountId === accountId)) {
      await manager.setSessionExtension(accountId, null)
    }
    return store.remove(accountId)
  })
  ipcMain.handle(IPC_CHANNELS.sessions.clearData, (event, accountId) => (
    requireSessionManager(event).clearSessionData(accountId)
  ))
  ipcMain.handle(
    IPC_CHANNELS.sessions.copyProxy,
    async (event, sourceAccountId, targetAccountId) => {
      const manager = requireSessionManager(event)
      const store = requireProxyStore(event)
      const previous = store.get(targetAccountId)
      const summary = store.copy(sourceAccountId, targetAccountId)
      if (!summary) return null

      try {
        if (manager.getSessions().some((candidate) => candidate.accountId === targetAccountId)) {
          await manager.setSessionProxy(targetAccountId, store.get(targetAccountId))
        }
        return summary
      } catch (error) {
        if (previous) store.set(targetAccountId, previous)
        else store.remove(targetAccountId)
        throw error
      }
    },
  )
  ipcMain.handle(IPC_CHANNELS.sessions.show, (event, accountId) => (
    requireSessionManager(event).showSession(accountId)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.hide, (event, accountId) => (
    requireSessionManager(event).hideSession(accountId)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.focus, (event, accountId) => (
    requireSessionManager(event).focusSession(accountId)
  ))
  ipcMain.handle(
    IPC_CHANNELS.sessions.resize,
    (event, accountId, bounds: SessionBounds) => (
      requireSessionManager(event).resizeSession(accountId, bounds)
    ),
  )
  ipcMain.handle(IPC_CHANNELS.sessions.reload, (event, accountId) => (
    requireSessionManager(event).reloadSession(accountId)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.navigate, (event, accountId, url) => (
    requireSessionManager(event).navigateSession(accountId, url)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.close, (event, accountId) => (
    requireSessionManager(event).closeSession(accountId)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.destroy, (event, accountId) => (
    requireSessionManager(event).destroySession(accountId)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.mute, (event, accountId, muted) => (
    requireSessionManager(event).muteSession(accountId, muted)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.setEcoMode, (event, enabled, secondaryFps) => (
    requireSessionManager(event).setEcoMode(enabled, secondaryFps)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.setFrameRate, (event, accountId, fps) => (
    requireSessionManager(event).setFrameRate(accountId, fps)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.setInterfaceZoom, (event, accountId, zoom) => (
    requireSessionManager(event).setInterfaceZoom(accountId, zoom)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.getAll, (event) => (
    requireSessionManager(event).getSessions()
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.getResourceUsage, (event) => (
    requireSessionManager(event).getResourceUsage()
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.getProxy, (event, accountId) => {
    const config = requireProxyStore(event).get(accountId)
    return config
      ? {
          enabled: config.enabled,
          hasPassword: Boolean(config.password),
          host: config.host,
          port: config.port,
          protocol: config.protocol,
          username: config.username,
        }
      : null
  })
  ipcMain.handle(
    IPC_CHANNELS.sessions.setProxy,
    async (event, accountId, input: SessionProxyInput) => {
      const manager = requireSessionManager(event)
      const store = requireProxyStore(event)
      const previous = store.get(accountId)
      const summary = store.set(accountId, input)
      const config = store.get(accountId)

      try {
        if (manager.getSessions().some((candidate) => candidate.accountId === accountId)) {
          await manager.setSessionProxy(accountId, config)
        }
      } catch (error) {
        if (previous) {
          store.set(accountId, previous)
        } else {
          store.remove(accountId)
        }
        throw error
      }

      return summary
    },
  )
  ipcMain.handle(IPC_CHANNELS.sessions.removeProxy, async (event, accountId) => {
    const manager = requireSessionManager(event)
    const store = requireProxyStore(event)
    const previous = store.get(accountId)
    const removed = store.remove(accountId)

    try {
      if (manager.getSessions().some((candidate) => candidate.accountId === accountId)) {
        await manager.setSessionProxy(accountId, null)
      }
    } catch (error) {
      if (previous) {
        store.set(accountId, previous)
      }
      throw error
    }

    return removed
  })
  ipcMain.handle(IPC_CHANNELS.sessions.testProxy, (event, accountId) => (
    requireSessionManager(event).testSessionProxy(
      accountId,
      'https://altgrid-api.altgrid.workers.dev/health',
    )
  ))

  ipcMain.handle(IPC_CHANNELS.updater.getState, (event) => (
    requireUpdater(event).getState()
  ))
  ipcMain.handle(IPC_CHANNELS.updater.check, (event) => (
    requireUpdater(event).checkForUpdates()
  ))
  ipcMain.handle(IPC_CHANNELS.updater.download, (event) => (
    requireUpdater(event).downloadUpdate()
  ))
  ipcMain.handle(IPC_CHANNELS.updater.install, (event) => {
    const updater = requireUpdater(event)
    // Release native game views before Velopack closes the shell and swaps the
    // active package. This prevents lingering session processes from holding files.
    sessionManager?.destroyAll()
    return updater.quitAndInstall()
  })
}

function resolveDevelopmentUrl(): string | null {
  const input = process.env.ALTGRID_DEV_SERVER_URL?.trim()

  if (!input) {
    return null
  }

  try {
    const url = new URL(input)
    const loopback = url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '[::1]'

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !loopback) {
      throw new Error('O servidor de desenvolvimento deve ser loopback.')
    }

    return url.toString()
  } catch {
    throw new Error('ALTGRID_DEV_SERVER_URL inválida.')
  }
}

async function loadShell(
  browserWindow: BrowserWindow,
  recoveryDeepLink: string | null = null,
): Promise<void> {
  const developmentUrl = resolveDevelopmentUrl()

  if (developmentUrl) {
    shellEntryUrl = developmentUrl
    configureShellSecurity(browserWindow, developmentUrl)
    await browserWindow.loadURL(
      recoveryDeepLinkToShellUrl(recoveryDeepLink ?? '', developmentUrl)
        ?? developmentUrl,
    )
    return
  }

  shellEntryUrl = LOCAL_SHELL_ENTRY_URL
  configureShellSecurity(browserWindow, shellEntryUrl)
  await browserWindow.loadURL(
    recoveryDeepLinkToShellUrl(recoveryDeepLink ?? '', shellEntryUrl)
      ?? shellEntryUrl,
  )
}

async function registerLocalShellProtocol(): Promise<void> {
  const rendererRoot = resolve(app.getAppPath(), 'dist')

  await protocol.handle(LOCAL_SHELL_SCHEME, (request) => {
    let url: URL

    try {
      url = new URL(request.url)
    } catch {
      return new Response('Not found', { status: 404 })
    }

    if (url.host !== LOCAL_SHELL_HOST) {
      return new Response('Not found', { status: 404 })
    }

    let relativePath: string
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch {
      return new Response('Not found', { status: 404 })
    }

    // Extensionless paths are renderer routes, including /admin.
    if (!relativePath || !extname(relativePath)) {
      relativePath = 'index.html'
    }

    const targetPath = resolve(rendererRoot, relativePath)
    const pathInsideRenderer = relative(rendererRoot, targetPath)

    if (
      pathInsideRenderer.startsWith('..')
      || isAbsolute(pathInsideRenderer)
      || !existsSync(targetPath)
    ) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(targetPath).toString())
  })
}

async function createMainWindow(): Promise<void> {
  const preloadPath = join(moduleDirectory, 'preload.cjs')
  const iconPath = join(app.getAppPath(), 'electron', 'assets', 'icon.png')
  const browserWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#080c11',
    height: 900,
    icon: existsSync(iconPath) ? iconPath : undefined,
    minHeight: 680,
    minWidth: 1_080,
    show: false,
    title: 'AltGrid',
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      navigateOnDragDrop: false,
      preload: preloadPath,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      webviewTag: false,
    },
    width: 1_440,
  })

  mainWindow = browserWindow
  proxyConfigStore = new ProxyConfigStore(
    join(app.getPath('userData'), 'proxy-config.v1.json'),
    safeStorage,
  )
  extensionConfigStore = new ExtensionConfigStore(
    join(app.getPath('userData'), 'extension-config.v1.json'),
  )
  sessionManager = new SessionManager({
    allowInsecureLoopback: !app.isPackaged,
    clearPartitionData: clearNativeSessionPartition,
    createView: createNativeSessionViewFactory(browserWindow, !app.isPackaged),
  })
  updaterService = new UpdaterService(browserWindow)

  let shellCanReceiveSessionEvents = false
  const unsubscribeSessionEvents = sessionManager.subscribe((event) => {
    if (
      shellCanReceiveSessionEvents
      && !browserWindow.isDestroyed()
      && !browserWindow.webContents.isDestroyed()
      && !browserWindow.webContents.isCrashed()
    ) {
      browserWindow.webContents.send(IPC_CHANNELS.sessions.event, event)
    }
  })

  browserWindow.once('ready-to-show', () => browserWindow.show())
  browserWindow.on('close', prepareForApplicationExit)
  browserWindow.on('closed', () => {
    shellCanReceiveSessionEvents = false
    unsubscribeSessionEvents()
    updaterService?.stop()
    sessionManager?.destroyAll()
    updaterService = null
    sessionManager = null
    proxyConfigStore = null
    extensionConfigStore = null
    mainWindow = null
    shellEntryUrl = null
  })
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    shellCanReceiveSessionEvents = false
    if (details.reason !== 'clean-exit' && !browserWindow.isDestroyed()) {
      // The renderer owns the entitlement/session registry. Drop native views
      // before a shell restart so orphaned sessions cannot bypass that registry.
      sessionManager?.destroyAll()
      void dialog.showMessageBox(browserWindow, {
        buttons: ['Recarregar interface', 'Fechar'],
        defaultId: 0,
        message: 'A interface do AltGrid foi interrompida.',
        title: 'AltGrid',
        type: 'warning',
      }).then(({ response }) => {
        if (response === 0 && !browserWindow.isDestroyed()) {
          browserWindow.webContents.reload()
        }
      })
    }
  })
  let shellDocumentLoaded = false
  browserWindow.webContents.on('did-finish-load', () => {
    shellDocumentLoaded = true
    shellCanReceiveSessionEvents = true
  })
  browserWindow.webContents.on(
    'did-start-navigation',
    (_event, _url, isInPlace, isMainFrame) => {
      if (shellDocumentLoaded && isMainFrame && !isInPlace) {
        shellCanReceiveSessionEvents = false
        shellDocumentLoaded = false
        // Full shell reloads reset in-memory permissions; close native views but
        // preserve their persistent partitions so game login survives reopening.
        sessionManager?.destroyAll()
      }
    },
  )

  try {
    const recoveryDeepLink = pendingRecoveryDeepLink
    pendingRecoveryDeepLink = null
    await loadShell(browserWindow, recoveryDeepLink)
    updaterService.start()
  } catch {
    dialog.showErrorBox(
      'AltGrid não iniciou',
      'Não foi possível carregar a interface local do AltGrid.',
    )
    browserWindow.destroy()
  }
}

if (!singleInstanceLock) {
  app.quit()
} else {
  app.setAppUserModelId('io.altgrid.desktop')
  registerDeepLinkProtocol()

  app.on('open-url', (event, url) => {
    event.preventDefault()
    void presentRecoveryDeepLink(url)
  })

  app.on('second-instance', (_event, commandLine) => {
    if (hasMaintenanceShutdownArgument(commandLine)) {
      shutdownForMaintenance()
      return
    }

    const recoveryDeepLink = findTrustedRecoveryDeepLink(commandLine)
    if (recoveryDeepLink) {
      void presentRecoveryDeepLink(recoveryDeepLink)
      return
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      void createMainWindow()
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.show()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', prepareForApplicationExit)
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  void app.whenReady().then(async () => {
    await registerLocalShellProtocol()
    registerIpcHandlers()
    await createMainWindow()

    app.on('activate', () => {
      if (!mainWindow) {
        void createMainWindow()
      }
    })
  })
}
