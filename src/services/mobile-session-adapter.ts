import { Capacitor, registerPlugin } from '@capacitor/core'

import type {
  AccountSessionLaunchTarget,
  AccountSessionLauncher,
} from '../app'
import type { ConfiguredAccount } from './configured-account-service'

interface MobileGamePlugin {
  clear(options: { accountId: string }): Promise<void>
  close(options: { accountId: string }): Promise<void>
  open(options: { accountId: string; title: string; url: string }): Promise<void>
  reload(options: { accountId: string }): Promise<void>
}

const MobileGame = registerPlugin<MobileGamePlugin>('AltGridMobile')

export class MobileSessionLauncher implements AccountSessionLauncher {
  private active: {
    accountId: string
    title: string
    url: string
  } | null = null
  private openingAccountId: string | null = null

  applyLayout(): void {}

  async clearData(account: ConfiguredAccount): Promise<void> {
    this.requireAvailableAccount(account.id)
    await MobileGame.clear({ accountId: account.id })
    if (this.active?.accountId === account.id) {
      this.active = null
    }
  }

  async close(account: ConfiguredAccount): Promise<void> {
    if (this.active?.accountId !== account.id) {
      return
    }

    await MobileGame.close({ accountId: account.id })
    this.active = null
  }

  focus(account: ConfiguredAccount): Promise<void> | void {
    if (this.active?.accountId !== account.id) {
      return
    }

    return MobileGame.open({ ...this.active })
  }

  async open(
    account: ConfiguredAccount,
    target: AccountSessionLaunchTarget | null,
  ): Promise<void> {
    if (!target) {
      throw new Error('Não foi possível determinar o endereço deste jogo.')
    }

    this.requireAvailableAccount(account.id)
    const launch = {
      accountId: account.id,
      title: target.game?.name ?? account.displayName,
      url: target.launchUrl,
    }
    this.openingAccountId = account.id

    try {
      await MobileGame.open(launch)
      this.active = launch
    } finally {
      this.openingAccountId = null
    }
  }

  registerEscapeHandler(): () => void {
    return () => undefined
  }

  registerStatusHandler(): () => void {
    return () => undefined
  }

  reload(account: ConfiguredAccount): Promise<void> | void {
    if (this.active?.accountId !== account.id) {
      return
    }

    return MobileGame.reload({ accountId: account.id })
  }

  setEcoMode(): boolean {
    return false
  }

  setMuted(): void {}

  private requireAvailableAccount(accountId: string): void {
    const occupiedBy = this.active?.accountId ?? this.openingAccountId

    if (occupiedBy && occupiedBy !== accountId) {
      throw new Error(
        'A versão Android permite uma sessão por vez. Feche a conta aberta para continuar.',
      )
    }
  }
}

export function createMobileSessionLauncher(): MobileSessionLauncher | null {
  return Capacitor.isNativePlatform()
    ? new MobileSessionLauncher()
    : null
}
