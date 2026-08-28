import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core'

import type {
  AccountSessionLaunchTarget,
  AccountSessionLauncher,
  AccountSessionStatusEvent,
} from '../app'
import type { ConfiguredAccount } from './configured-account-service'
import type { GridLayout } from './grid-layout-service'

interface MobileSessionLayoutEntry {
  accountId: string
  height: number
  visible: boolean
  width: number
  x: number
  y: number
}

interface MobileGamePlugin {
  addListener(
    eventName: 'sessionStatus',
    listener: (event: MobileSessionStatusEvent) => void,
  ): Promise<PluginListenerHandle>
  applyLayout(options: { sessions: MobileSessionLayoutEntry[] }): Promise<void>
  clear(options: { accountId: string }): Promise<void>
  close(options: { accountId: string }): Promise<void>
  open(options: { accountId: string; title: string; url: string }): Promise<void>
  reload(options: { accountId: string }): Promise<void>
}

interface MobileSessionStatusEvent {
  accountId?: string
  reason?: string
  status?: 'closed' | 'crashed' | 'opening' | 'ready'
}

const MobileGame = registerPlugin<MobileGamePlugin>('AltGridMobile')

export class MobileSessionLauncher implements AccountSessionLauncher {
  readonly mobileNative = true

  private readonly sessions = new Map<string, {
    accountId: string
    status: 'crashed' | 'opening' | 'ready'
    title: string
    url: string
  }>()

  async applyLayout(layout: GridLayout): Promise<void> {
    const visibleAccountIds = new Set(layout.slots.map((slot) => slot.sessionId))
    const sessions: MobileSessionLayoutEntry[] = layout.slots.map((slot) => ({
      accountId: slot.sessionId,
      height: slot.bounds.height,
      visible: true,
      width: slot.bounds.width,
      x: slot.bounds.x,
      y: slot.bounds.y,
    }))

    layout.overflowSessionIds.forEach((accountId) => {
      if (!visibleAccountIds.has(accountId)) {
        sessions.push({
          accountId,
          height: 0,
          visible: false,
          width: 0,
          x: 0,
          y: 0,
        })
      }
    })

    await MobileGame.applyLayout({ sessions })
  }

  async clearData(account: ConfiguredAccount): Promise<void> {
    await MobileGame.clear({ accountId: account.id })
    this.sessions.delete(account.id)
  }

  async close(account: ConfiguredAccount): Promise<void> {
    if (!this.sessions.has(account.id)) {
      return
    }

    await MobileGame.close({ accountId: account.id })
    this.sessions.delete(account.id)
  }

  focus(_account: ConfiguredAccount): void {}

  getPlatform(): string {
    return Capacitor.getPlatform()
  }

  async open(
    account: ConfiguredAccount,
    target: AccountSessionLaunchTarget | null,
  ): Promise<void> {
    if (!target) {
      throw new Error('Não foi possível determinar o endereço deste jogo.')
    }

    const existing = this.sessions.get(account.id)
    if (existing) {
      return
    }

    const launch = {
      accountId: account.id,
      status: 'opening' as const,
      title: target.game?.name ?? account.displayName,
      url: target.launchUrl,
    }
    this.sessions.set(account.id, launch)

    try {
      await MobileGame.open({
        accountId: launch.accountId,
        title: launch.title,
        url: launch.url,
      })
      const current = this.sessions.get(account.id)
      if (current === launch) {
        current.status = 'ready'
      }
    } catch (error) {
      if (this.sessions.get(account.id) === launch) {
        this.sessions.delete(account.id)
      }
      throw error
    }
  }

  registerEscapeHandler(): () => void {
    return () => undefined
  }

  registerStatusHandler(
    handler: (event: AccountSessionStatusEvent) => void,
  ): () => void {
    let disposed = false
    const listener = MobileGame.addListener('sessionStatus', (event) => {
      const accountId = event.accountId
      if (disposed || !accountId) {
        return
      }

      const mapped = this.mapStatusEvent({ ...event, accountId })
      if (!mapped) {
        return
      }

      const session = this.sessions.get(accountId)
      if (mapped.type === 'closed') {
        this.sessions.delete(accountId)
      } else if (session && mapped.type === 'loading') {
        session.status = 'opening'
      } else if (session && mapped.type === 'ready') {
        session.status = 'ready'
      } else if (session && mapped.type === 'crashed') {
        session.status = 'crashed'
      }
      handler(mapped)
    }).catch(() => null)

    return () => {
      disposed = true
      void listener.then((handle) => handle?.remove())
    }
  }

  reload(account: ConfiguredAccount): Promise<void> | void {
    if (!this.sessions.has(account.id)) {
      return
    }

    return MobileGame.reload({ accountId: account.id })
  }

  setEcoMode(_enabled: boolean, _backgroundFps: 10 | 20 | 30): boolean {
    return false
  }

  setFrameRate(): void {}

  setMuted(): void {}

  private mapStatusEvent(
    event: MobileSessionStatusEvent & { accountId: string },
  ): AccountSessionStatusEvent | null {
    switch (event.status) {
      case 'opening':
        return { accountId: event.accountId, type: 'loading' }
      case 'ready':
        return { accountId: event.accountId, type: 'ready' }
      case 'closed':
        return { accountId: event.accountId, type: 'closed' }
      case 'crashed':
        return {
          accountId: event.accountId,
          detail: event.reason || 'Sessão interrompida.',
          type: 'crashed',
        }
      default:
        return null
    }
  }
}

export function createMobileSessionLauncher(): MobileSessionLauncher | null {
  return Capacitor.isNativePlatform()
    ? new MobileSessionLauncher()
    : null
}
