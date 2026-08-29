import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, extname, join, resolve } from 'node:path'

import { app, type BrowserWindow } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'

import { IPC_CHANNELS, type UpdateState } from './contracts.js'

const { autoUpdater } = electronUpdater

const STARTUP_CHECK_DELAY_MS = 5_000
const PERIODIC_CHECK_INTERVAL_MS = 30 * 60 * 1_000
const RETRY_DELAYS_MS = [1_000, 3_000] as const
const MAX_RELEASE_NOTES_LENGTH = 4_000
const GITHUB_SEGMENT_PATTERN = /^[a-zA-Z0-9_.-]{1,100}$/

function powershellString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function launchInstallerAfterApplicationExit(installerPath: string): boolean {
  if (process.platform !== 'win32') {
    return false
  }

  const systemRoot = process.env.SystemRoot?.trim()
  if (!systemRoot) {
    return false
  }

  const powershellPath = join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  if (!existsSync(powershellPath)) {
    return false
  }

  const executablePath = resolve(process.execPath)
  const executableName = basename(executablePath, extname(executablePath))
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$mainProcessId = ${process.pid}
$altGridExecutable = ${powershellString(executablePath)}
$installer = ${powershellString(installerPath)}
Wait-Process -Id $mainProcessId -Timeout 12 -ErrorAction SilentlyContinue
$remaining = Get-Process -Name ${powershellString(executableName)} -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $altGridExecutable }
if ($remaining) {
  $remaining | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 750
}
Start-Process -FilePath $installer -ArgumentList @('--updated', '/S', '--force-run') -WindowStyle Hidden
`.trim()
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64')

  try {
    const helper = spawn(powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-EncodedCommand',
      encodedCommand,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    helper.unref()
    return true
  } catch {
    return false
  }
}

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
  private operationInProgress = false
  private downloadedInstallerPath: string | null = null
  private readonly handleCheckingForUpdate = (): void => {
    this.setState({ status: 'checking', supported: this.supported })
  }
  private readonly handleUpdateAvailable = (info: UpdateInfo): void => {
    this.downloadedInstallerPath = null
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
    // electron-updater also emits `error` before rejecting the active promise.
    // Let the retry loop decide whether the operation actually failed instead
    // of briefly replacing progress with a misleading "try again" state.
    if (this.operationInProgress) {
      return
    }

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

    // Verification must never start a second, implicit download. The user starts
    // one controlled transfer from the UI and that transfer owns its retries.
    autoUpdater.autoDownload = false
    // Beta installations follow the prerelease channel until 1.0.0 is shipped.
    // Stable installations remain on stable releases only.
    autoUpdater.allowPrerelease = app.getVersion().includes('-')
    // Differential updates are more sensitive to stale blockmaps and HTTP range
    // failures. AltGrid deliberately downloads the complete, SHA-512-validated
    // NSIS installer for a predictable Windows update path.
    autoUpdater.disableDifferentialDownload = true
    // Installation is explicit; a normal close must never unexpectedly replace
    // the application or race the teardown of active game sessions.
    autoUpdater.autoInstallOnAppQuit = false
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

    this.operationInProgress = true
    try {
      await this.withRetries(() => autoUpdater.checkForUpdates())
    } catch {
      this.setState({
        message: 'Não foi possível verificar atualizações após tentativas automáticas. Confira a conexão e tente novamente mais tarde.',
        status: 'error',
        supported: true,
      })
    } finally {
      this.operationInProgress = false
    }

    return this.getState()
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (
      !this.supported
      || (
        this.state.status !== 'available'
        && !(this.state.status === 'error' && Boolean(this.state.version))
      )
    ) {
      return this.getState()
    }

    this.setState({
      status: 'downloading',
      supported: true,
      version: this.state.version,
    })

    this.operationInProgress = true
    try {
      const downloadedFiles = await this.withRetries(() => autoUpdater.downloadUpdate())
      const installerPath = downloadedFiles.find((filePath) => (
        extname(filePath).toLowerCase() === '.exe'
        && existsSync(filePath)
      ))
      if (!installerPath) {
        throw new Error('O instalador baixado não foi encontrado.')
      }
      this.downloadedInstallerPath = resolve(installerPath)
    } catch {
      this.setState({
        message: 'O instalador completo não pôde ser baixado após tentativas automáticas. O AltGrid preservou o download anterior; tente novamente quando a conexão estiver estável.',
        status: 'error',
        supported: true,
        version: this.state.version,
      })
    } finally {
      this.operationInProgress = false
    }

    return this.getState()
  }

  quitAndInstall(): boolean {
    if (!this.supported || this.state.status !== 'downloaded') {
      return false
    }

    try {
      // The helper is not an AltGrid.exe process. It waits for the complete
      // Electron process tree to exit, removes only residual processes from the
      // same executable path, then launches the SHA-512-validated installer.
      if (
        this.downloadedInstallerPath
        && launchInstallerAfterApplicationExit(this.downloadedInstallerPath)
      ) {
        app.quit()
        return true
      }

      // Locked-down Windows environments can disable PowerShell. Keep the
      // updater's native, verified installer path as a safe fallback.
      autoUpdater.quitAndInstall(true, true)
      return true
    } catch {
      this.setState({
        message: 'O instalador foi baixado, mas o Windows não permitiu iniciá-lo. Feche o AltGrid e tente novamente.',
        status: 'error',
        supported: true,
        version: this.state.version,
      })
      return false
    }
  }

  private async withRetries<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        const delay = RETRY_DELAYS_MS[attempt]
        if (delay !== undefined) {
          await new Promise<void>((resolveRetry) => setTimeout(resolveRetry, delay))
        }
      }
    }

    throw lastError
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
