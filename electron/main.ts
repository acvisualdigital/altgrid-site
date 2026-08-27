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
  shell,
  type IpcMainInvokeEvent,
} from 'electron'

import { IPC_CHANNELS, type SessionBounds } from './contracts.js'
import {
  clearNativeSessionPartition,
  createNativeSessionViewFactory,
} from './native-session-view.js'
import { SessionManager } from './session-manager.js'
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
app.enableSandbox()
const singleInstanceLock = app.requestSingleInstanceLock()

let mainWindow: BrowserWindow | null = null
let sessionManager: SessionManager | null = null
let updaterService: UpdaterService | null = null
let shellEntryUrl: string | null = null
let pendingRecoveryDeepLink = findTrustedRecoveryDeepLink(process.argv)

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

  ipcMain.handle(IPC_CHANNELS.sessions.create, (event, accountId, url) => (
    requireSessionManager(event).createSession(accountId, url)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.clearData, (event, accountId) => (
    requireSessionManager(event).clearSessionData(accountId)
  ))
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
  ipcMain.handle(IPC_CHANNELS.sessions.setEcoMode, (event, enabled) => (
    requireSessionManager(event).setEcoMode(enabled)
  ))
  ipcMain.handle(IPC_CHANNELS.sessions.getAll, (event) => (
    requireSessionManager(event).getSessions()
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
  ipcMain.handle(IPC_CHANNELS.updater.install, (event) => (
    requireUpdater(event).quitAndInstall()
  ))
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
  sessionManager = new SessionManager({
    allowInsecureLoopback: !app.isPackaged,
    clearPartitionData: clearNativeSessionPartition,
    createView: createNativeSessionViewFactory(browserWindow, !app.isPackaged),
  })
  updaterService = new UpdaterService(browserWindow)

  sessionManager.subscribe((event) => {
    if (!browserWindow.isDestroyed()) {
      browserWindow.webContents.send(IPC_CHANNELS.sessions.event, event)
    }
  })

  browserWindow.once('ready-to-show', () => browserWindow.show())
  browserWindow.on('closed', () => {
    updaterService?.stop()
    sessionManager?.destroyAll()
    updaterService = null
    sessionManager = null
    mainWindow = null
    shellEntryUrl = null
  })
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
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
  })
  browserWindow.webContents.on(
    'did-start-navigation',
    (_event, _url, isInPlace, isMainFrame) => {
      if (shellDocumentLoaded && isMainFrame && !isInPlace) {
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
