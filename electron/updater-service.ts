import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { app, type BrowserWindow } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'

import { IPC_CHANNELS, type UpdateState } from './contracts.js'

const { autoUpdater } = electronUpdater

const STARTUP_CHECK_DELAY_MS = 5_000
const PERIODIC_CHECK_INTERVAL_MS = 30 * 60 * 1_000
const MAX_RELEASE_NOTES_LENGTH = 4_000
const GITHUB_SEGMENT_PATTERN = /^[a-zA-Z0-9_.-]{1,100}$/

function releaseNotesAsText(releaseNotes: UpdateInfo['releaseNotes']): string | undefined {
  if (!releaseNotes) {
    return undefined
  }

  const raw = typeof releaseNotes === 'string'
    ? releaseNotes
    : releaseNotes.map((entry) => entry.note ?? '').join('\n')
  // Windows and Android ship from the same tag/release; drop Android-only
  // lines so the desktop update dialog never mentions the mobile beta.
  const windowsRelevant = raw
    .split(/\r?\n/)
    .filter((line) => !/android/i.test(line))
    .join('\n')
  const plainText = windowsRelevant
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return plainText ? plainText.slice(0, MAX_RELEASE_NOTES_LENGTH) : undefined
}

export class UpdaterService {
  private disposed = false
  private readonly listeners = new Set<(state: UpdateState) => void>()
  private periodicTimer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private state: UpdateState
  private readonly supported: boolean
  private readonly portable: boolean
  private readonly handleCheckingForUpdate = (): void => {
    this.setState({ status: 'checking', supported: this.supported })
  }
  private readonly handleUpdateAvailable = (info: UpdateInfo): void => {
    this.setState({
      releaseNotes: releaseNotesAsText(info.releaseNotes),
      status: 'available',
      supported: this.supported,
      version: info.version,
    })
  }
  private readonly handleUpdateNotAvailable = (info: UpdateInfo): void => {
    this.setState({
      status: 'not_available',
      supported: this.supported,
      version: info.version,
    })
  }
  private readonly handleDownloadProgress = (progress: { percent: number }): void => {
    this.setState({
      percent: Math.max(0, Math.min(100, progress.percent)),
      status: 'downloading',
      supported: this.supported,
      version: this.state.version,
    })
  }
  private readonly handleUpdateDownloaded = (info: UpdateInfo): void => {
    this.setState({
      releaseNotes: releaseNotesAsText(info.releaseNotes),
      status: 'downloaded',
      supported: this.supported,
      version: info.version,
    })
  }
  private readonly handleError = (): void => {
    this.setState({
      message: 'Não foi possível verificar ou baixar a atualização.',
      status: 'error',
      supported: this.supported,
    })
  }

  constructor(private readonly browserWindow: BrowserWindow) {
    this.portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE?.trim())
    this.supported = this.configureProvider()
    this.state = { status: 'idle', supported: this.supported }

    autoUpdater.autoDownload = true
    // Beta installations follow the prerelease channel until 1.0.0 is shipped.
    // Stable installations remain on stable releases only.
    autoUpdater.allowPrerelease = app.getVersion().includes('-')
    // A downloaded NSIS update is applied on a normal app exit when the user
    // chooses "Instalar depois". Active game sessions are not interrupted early.
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', this.handleCheckingForUpdate)
    autoUpdater.on('update-available', this.handleUpdateAvailable)
    autoUpdater.on('update-not-available', this.handleUpdateNotAvailable)
    autoUpdater.on('download-progress', this.handleDownloadProgress)
    autoUpdater.on('update-downloaded', this.handleUpdateDownloaded)
    autoUpdater.on('error', this.handleError)
  }

  start(): void {
    if (!this.supported || this.startupTimer || this.periodicTimer) {
      return
    }

    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      void this.checkForUpdates()
    }, STARTUP_CHECK_DELAY_MS)
    this.startupTimer.unref()

    this.periodicTimer = setInterval(() => {
      void this.checkForUpdates()
    }, PERIODIC_CHECK_INTERVAL_MS)
    this.periodicTimer.unref()
  }

  stop(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }

    if (this.periodicTimer) {
      clearInterval(this.periodicTimer)
      this.periodicTimer = null
    }

    if (!this.disposed) {
      this.disposed = true
      autoUpdater.off('checking-for-update', this.handleCheckingForUpdate)
      autoUpdater.off('update-available', this.handleUpdateAvailable)
      autoUpdater.off('update-not-available', this.handleUpdateNotAvailable)
      autoUpdater.off('download-progress', this.handleDownloadProgress)
      autoUpdater.off('update-downloaded', this.handleUpdateDownloaded)
      autoUpdater.off('error', this.handleError)
      this.listeners.clear()
    }
  }

  subscribe(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  async checkForUpdates(): Promise<UpdateState> {
    if (!this.supported) {
      this.setState({
        message: this.unsupportedMessage(),
        status: 'not_available',
        supported: false,
      })
      return this.getState()
    }

    if (this.state.status === 'checking' || this.state.status === 'downloading') {
      return this.getState()
    }

    this.setState({ status: 'checking', supported: true })

    try {
      await autoUpdater.checkForUpdates()
    } catch {
      this.setState({
        message: 'Não foi possível verificar atualizações.',
        status: 'error',
        supported: true,
      })
    }

    return this.getState()
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (!this.supported || this.state.status !== 'available') {
      return this.getState()
    }

    this.setState({
      status: 'downloading',
      supported: true,
      version: this.state.version,
    })

    try {
      await autoUpdater.downloadUpdate()
    } catch {
      this.setState({
        message: 'Não foi possível baixar a atualização.',
        status: 'error',
        supported: true,
        version: this.state.version,
      })
    }

    return this.getState()
  }

  quitAndInstall(): boolean {
    if (!this.supported || this.state.status !== 'downloaded') {
      return false
    }

    autoUpdater.quitAndInstall(false, true)
    return true
  }

  private configureProvider(): boolean {
    if (!app.isPackaged || this.portable) {
      return false
    }

    const owner = process.env.ALTGRID_UPDATE_OWNER?.trim()
    const repo = process.env.ALTGRID_UPDATE_REPO?.trim()

    if (
      owner
      && repo
      && GITHUB_SEGMENT_PATTERN.test(owner)
      && GITHUB_SEGMENT_PATTERN.test(repo)
    ) {
      try {
        autoUpdater.setFeedURL({ owner, provider: 'github', repo })
        return true
      } catch {
        return false
      }
    }

    return existsSync(join(process.resourcesPath, 'app-update.yml'))
  }

  private unsupportedMessage(): string {
    if (!app.isPackaged) {
      return 'Atualizações são verificadas somente no aplicativo instalado.'
    }

    if (this.portable) {
      return 'A versão Portátil não pode se atualizar sozinha. Instale o AltGrid com o Setup para receber atualizações dentro do app.'
    }

    return 'O repositório de atualizações ainda não foi configurado.'
  }

  private setState(state: UpdateState): void {
    if (this.disposed) {
      return
    }

    this.state = { ...state }

    for (const listener of this.listeners) {
      listener(this.getState())
    }

    if (!this.browserWindow.isDestroyed()) {
      this.browserWindow.webContents.send(IPC_CHANNELS.updater.event, this.getState())
    }
  }
}
