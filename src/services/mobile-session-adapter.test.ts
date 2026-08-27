import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccountSessionLaunchTarget } from '../app'
import type { ConfiguredAccount } from './configured-account-service'

const mobilePlugin = vi.hoisted(() => ({
  clear: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  open: vi.fn(async () => undefined),
  reload: vi.fn(async () => undefined),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => mobilePlugin,
}))

import { MobileSessionLauncher } from './mobile-session-adapter'

const target: AccountSessionLaunchTarget = {
  game: null,
  kind: 'custom',
  launchUrl: 'https://game.example/',
}

function account(id: string): ConfiguredAccount {
  return {
    createdAt: '2026-08-27T12:00:00.000Z',
    displayName: `Conta ${id}`,
    gameSlug: '__custom_url__',
    id,
  }
}

describe('MobileSessionLauncher', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates lifecycle controls and allows only one Android session at a time', async () => {
    const launcher = new MobileSessionLauncher()
    const first = account('account-1')
    const second = account('account-2')

    await launcher.open(first, target)
    await expect(launcher.open(second, target)).rejects.toThrow(
      'A versão Android permite uma sessão por vez.',
    )
    await launcher.reload(first)
    await launcher.focus(first)

    expect(mobilePlugin.reload).toHaveBeenCalledWith({ accountId: first.id })
    expect(mobilePlugin.open).toHaveBeenLastCalledWith({
      accountId: first.id,
      title: first.displayName,
      url: target.launchUrl,
    })

    await launcher.close(first)
    await launcher.open(second, target)
    expect(mobilePlugin.close).toHaveBeenCalledWith({ accountId: first.id })
    expect(mobilePlugin.open).toHaveBeenLastCalledWith({
      accountId: second.id,
      title: second.displayName,
      url: target.launchUrl,
    })
  })

  it('does not clear another account while a mobile session is active', async () => {
    const launcher = new MobileSessionLauncher()
    const first = account('account-1')
    const second = account('account-2')

    await launcher.open(first, target)
    await expect(launcher.clearData(second)).rejects.toThrow(
      'A versão Android permite uma sessão por vez.',
    )
    await launcher.clearData(first)
    await launcher.open(second, target)

    expect(mobilePlugin.clear).toHaveBeenCalledOnce()
    expect(mobilePlugin.clear).toHaveBeenCalledWith({ accountId: first.id })
  })
})
