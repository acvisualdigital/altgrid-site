import { app, type BrowserWindow } from 'electron'
import { UpdateManager, type UpdateInfo, type VelopackAsset } from 'velopack'

import { IPC_CHANNELS, type UpdateState } from './contracts.js'

const STARTUP_CHECK_DELAY_MS = 5_000
const PERIODIC_CHECK_INTERVAL_MS = 30 * 60 * 1_000
const RETRY_DELAYS_MS = [1_000, 3_000] as const
const MAX_RELEASE_NOTES_LENGTH = 4_000
const DEFAULT_UPDATE_URL = 'https://github.com/acvisualdigital/altgrid-releases/releases/latest/download/'

function releaseNotesAsText(releaseNotes: string | undefined): string | undefined {
  if (!releaseNotes) return undefined

  const windowsRelevant = releaseNotes
    .split(/\r?\n/)
    .filter((line) => !/android/i.test(line))
    .join('\n')
  const plainText = windowsRelevant
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`>[\]()~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return plainText ? plainText.slice(0, MAX_RELEASE_NOTES_LENGTH) : undefined
}

function validatedUpdateUrl(input: string): string | null {
  try {
    const url = new URL(input)
    const loopback = url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '[::1]'

    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      return null
    }

    url.username = ''
    url.password = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export class UpdaterService {
  private disposed = false
  private readonly listeners = new Set<(state: UpdateState) => void>()
  private periodicTimer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private state: UpdateState
  private readonly manager: UpdateManager | null
  private readonly portable: boolean
  private operationInProgress = false
  private pendingUpdate: UpdateInfo | VelopackAsset | null = null

  constructor(private readonly browserWindow: BrowserWindow) {
    const configured = this.configureManager()
    this.manager = configured.manager
    this.portable = configured.portable

    const pending = this.manager?.getUpdatePendingRestart() ?? null
    this.pendingUpdate = pending
    this.state = pending
      ? {
          releaseNotes: releaseNotesAsText(pending.NotesMarkdown),
          status: 'downloaded',
          supported: true,
          version: pending.Version,
        }
      : { status: 'idle', supported: Boolean(this.manager) }
  }

  start(): void {
    if (!this.manager || this.startupTimer || this.periodicTimer) return

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
    if (!this.manager) {
      this.setState({
        message: this.unsupportedMessage(),
        status: 'not_available',
        supported: false,
      })
      return this.getState()
    }
    if (this.operationInProgress) return this.getState()

    this.setState({ status: 'checking', supported: true })
    this.operationInProgress = true
    try {
      const update = await this.withRetries(() => (
        this.manager!.checkForUpdatesAsync()
      ))
      this.pendingUpdate = update
      if (!update) {
        this.setState({
          status: 'not_available',
          supported: true,
          version: app.getVersion(),
        })
      } else {
        this.setState({
          releaseNotes: releaseNotesAsText(update.TargetFullRelease.NotesMarkdown),
          status: 'available',
          supported: true,
          version: update.TargetFullRelease.Version,
        })
      }
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
      !this.manager
      || !this.pendingUpdate
      || this.operationInProgress
      || (this.state.status !== 'available' && this.state.status !== 'error')
    ) return this.getState()

    const update = this.pendingUpdate
    if (!('TargetFullRelease' in update)) return this.getState()
    const version = update.TargetFullRelease.Version
    this.setState({ status: 'downloading', supported: true, version })
    this.operationInProgress = true
    try {
      await this.withRetries(() => this.manager!.downloadUpdateAsync(
        update,
        (percent) => this.setState({
          percent: Math.max(0, Math.min(100, percent)),
          status: 'downloading',
          supported: true,
          version,
        }),
      ))
      this.setState({
        percent: 100,
        releaseNotes: releaseNotesAsText(update.TargetFullRelease.NotesMarkdown),
        status: 'downloaded',
        supported: true,
        version,
      })
    } catch {
      this.setState({
        message: 'A atualização não pôde ser baixada após tentativas automáticas. O AltGrid preservou o download parcial e tentará continuar na próxima vez.',
        status: 'error',
        supported: true,
        version,
      })
    } finally {
      this.operationInProgress = false
    }
    return this.getState()
  }

  quitAndInstall(): boolean {
    if (!this.manager || !this.pendingUpdate || this.state.status !== 'downloaded') {
      return false
    }

    try {
      // The updater lives outside the versioned app directory. It waits for
      // Electron's process tree, swaps versions and starts the new build.
      this.manager.waitExitThenApplyUpdate(this.pendingUpdate, false, true)
      app.quit()
      return true
    } catch {
      this.setState({
        message: 'A atualização foi baixada, mas o launcher não conseguiu iniciá-la. Reinicie o AltGrid e tente novamente.',
        status: 'error',
        supported: true,
        version: 'TargetFullRelease' in this.pendingUpdate
          ? this.pendingUpdate.TargetFullRelease.Version
          : this.pendingUpdate.Version,
      })
      return false
    }
  }

  private configureManager(): { manager: UpdateManager | null; portable: boolean } {
    if (!app.isPackaged || process.platform !== 'win32') {
      return { manager: null, portable: false }
    }
    if (process.env.PORTABLE_EXECUTABLE_FILE?.trim()) {
      return { manager: null, portable: true }
    }

    const updateUrl = validatedUpdateUrl(
      process.env.ALTGRID_UPDATE_URL?.trim() || DEFAULT_UPDATE_URL,
    )
    if (!updateUrl) return { manager: null, portable: false }

    try {
      const manager = new UpdateManager(updateUrl, {
        AllowVersionDowngrade: false,
        MaximumDeltasBeforeFallback: 5,
      })
      if (manager.isPortable()) return { manager: null, portable: true }
      return { manager, portable: false }
    } catch {
      // Legacy NSIS builds have no Velopack locator and require one migration
      // installation before the launcher can manage them.
      return { manager: null, portable: false }
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

  private unsupportedMessage(): string {
    if (!app.isPackaged) {
      return 'Atualizações são verificadas somente no aplicativo instalado.'
    }
    if (this.portable) {
      return 'A versão Portátil não pode se atualizar sozinha. Instale o AltGrid com o novo Setup para receber atualizações dentro do app.'
    }
    return 'Este AltGrid ainda usa o instalador antigo. Instale o novo AltGrid Setup uma vez para ativar o launcher automático.'
  }

  private setState(state: UpdateState): void {
    if (this.disposed) return
    this.state = { ...state }
    for (const listener of this.listeners) listener(this.getState())
    if (!this.browserWindow.isDestroyed()) {
      this.browserWindow.webContents.send(IPC_CHANNELS.updater.event, this.getState())
    }
  }
}
