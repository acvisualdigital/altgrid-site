import type {
  AltgridDesktopApi,
  SessionBounds,
  SessionEvent,
  SessionSnapshot,
  UpdateState,
} from '../../electron/contracts'
import type { GridLayout } from './grid-layout-service'

export interface DesktopAccountReference {
  id: string
}

export interface DesktopSessionLaunchTarget {
  launchUrl: string
}

export interface DesktopSessionStatusEvent {
  accountId: string
  detail?: string
  type: 'crashed' | 'focused' | 'load-failed' | 'loading' | 'ready'
}

export interface ElectronDesktopIntegration {
  dispose(): void
  getPlatform(): Promise<string>
  openExternalUrl(url: string): Promise<void>
  sessionLauncher: ElectronSessionLauncher
  updater: {
    checkForUpdates(): Promise<UpdateState>
    downloadUpdate(): Promise<UpdateState>
    getState(): Promise<UpdateState>
    onStateChange(listener: (state: UpdateState) => void): () => void
    quitAndInstall(): Promise<boolean>
  }
}

function integerBounds(bounds: GridLayout['slots'][number]['bounds']): SessionBounds {
  const x = Math.max(0, Math.round(bounds.x))
  const y = Math.max(0, Math.round(bounds.y))
  const right = Math.max(x + 1, Math.round(bounds.x + bounds.width))
  const bottom = Math.max(y + 1, Math.round(bounds.y + bounds.height))

  return {
    height: bottom - y,
    width: right - x,
    x,
    y,
  }
}

/**
 * Moves stable native WebContentsViews; it never recreates a game when only the
 * grid changes. Each account remains backed by its own persistent partition.
 */
export class ElectronSessionLauncher {
  private readonly escapeHandlers = new Set<() => void>()
  private readonly statusHandlers = new Set<(event: DesktopSessionStatusEvent) => void>()
  private readonly unavailableSessionIds = new Set<string>()
  private readonly unsubscribeFromEvents: () => void

  constructor(private readonly api: AltgridDesktopApi['sessions']) {
    this.unsubscribeFromEvents = api.onEvent((event) => {
      if (event.type === 'escape') {
        for (const handler of this.escapeHandlers) {
          handler()
        }
        return
      }

      if (isStatusEvent(event)) {
        if (event.type === 'crashed' || event.type === 'load-failed') {
          this.unavailableSessionIds.add(event.accountId)
          void this.api.hideSession(event.accountId).catch(() => undefined)
        } else {
          this.unavailableSessionIds.delete(event.accountId)
        }

        for (const handler of this.statusHandlers) {
          handler({
            accountId: event.accountId,
            detail: event.detail,
            type: event.type,
          })
        }
      }
    })
  }

  async applyLayout(layout: GridLayout): Promise<void> {
    const sessions = await this.api.getSessions()
    const sessionsById = new Map(sessions.map((session) => [session.accountId, session]))
    const visibleIds = new Set(layout.slots
      .map((slot) => slot.sessionId)
      .filter((accountId) => !this.unavailableSessionIds.has(accountId)))

    await Promise.all(sessions
      .filter((session) => session.visible && !visibleIds.has(session.accountId))
      .map((session) => this.api.hideSession(session.accountId)))

    await Promise.all(layout.slots.flatMap((slot) => {
      if (
        !sessionsById.has(slot.sessionId)
        || this.unavailableSessionIds.has(slot.sessionId)
      ) {
        return []
      }

      return [this.positionAndShow(
        sessionsById.get(slot.sessionId)!,
        integerBounds(slot.bounds),
      )]
    }))
  }

  async close(account: DesktopAccountReference): Promise<void> {
    this.unavailableSessionIds.delete(account.id)
    await this.api.closeSession(account.id)
  }

  async clearData(account: DesktopAccountReference): Promise<void> {
    this.unavailableSessionIds.delete(account.id)
    await this.api.clearData(account.id)
  }

  async focus(account: DesktopAccountReference): Promise<void> {
    await this.api.focusSession(account.id)
  }

  async open(
    account: DesktopAccountReference,
    target: DesktopSessionLaunchTarget | null,
  ): Promise<void> {
    if (!target) {
      throw new Error('Não foi possível determinar o endereço deste jogo.')
    }

    await this.api.createSession(account.id, target.launchUrl)
  }

  registerEscapeHandler(handler: () => void): () => void {
    this.escapeHandlers.add(handler)
    return () => this.escapeHandlers.delete(handler)
  }

  registerStatusHandler(
    handler: (event: DesktopSessionStatusEvent) => void,
  ): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  async reload(account: DesktopAccountReference): Promise<void> {
    this.unavailableSessionIds.delete(account.id)
    await this.api.reloadSession(account.id)
  }

  async setMuted(account: DesktopAccountReference, muted: boolean): Promise<void> {
    await this.api.muteSession(account.id, muted)
  }

  setEcoMode(enabled: boolean, secondaryFps?: number): Promise<boolean> {
    return secondaryFps === undefined
      ? this.api.setEcoMode(enabled)
      : this.api.setEcoMode(enabled, secondaryFps)
  }

  async setFrameRate(account: DesktopAccountReference, fps: number): Promise<void> {
    await this.api.setFrameRate(account.id, fps)
  }

  dispose(): void {
    this.escapeHandlers.clear()
    this.statusHandlers.clear()
    this.unavailableSessionIds.clear()
    this.unsubscribeFromEvents()
  }

  private async positionAndShow(
    session: SessionSnapshot,
    bounds: SessionBounds,
  ): Promise<void> {
    if (
      session.bounds.x !== bounds.x
      || session.bounds.y !== bounds.y
      || session.bounds.width !== bounds.width
      || session.bounds.height !== bounds.height
    ) {
      await this.api.resizeSession(session.accountId, bounds)
    }
    if (!session.visible) {
      await this.api.showSession(session.accountId)
    }
  }
}

function isStatusEvent(event: SessionEvent): event is SessionEvent & {
  type: DesktopSessionStatusEvent['type']
} {
  return ['crashed', 'focused', 'load-failed', 'loading', 'ready'].includes(event.type)
}

function desktopApiFromWindow(): AltgridDesktopApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return (window as Window & { altgrid?: AltgridDesktopApi }).altgrid ?? null
}

export function createElectronDesktopIntegration(
  api: AltgridDesktopApi | null = desktopApiFromWindow(),
): ElectronDesktopIntegration | null {
  if (!api) {
    return null
  }

  const sessionLauncher = new ElectronSessionLauncher(api.sessions)

  return {
    dispose: () => sessionLauncher.dispose(),
    getPlatform: () => api.app.getPlatform(),
    openExternalUrl: async (url) => {
      const opened = await api.app.openExternal(url)

      if (!opened) {
        throw new Error('Este endereço externo não é permitido.')
      }
    },
    sessionLauncher,
    updater: api.updater,
  }
}
