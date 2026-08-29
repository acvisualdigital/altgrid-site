import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccountSessionLaunchTarget } from '../app'
import type { ConfiguredAccount } from './configured-account-service'
import type { GridLayout } from './grid-layout-service'

const mobilePlugin = vi.hoisted(() => {
  let statusListener: ((event: unknown) => void) | null = null
  const removeListener = vi.fn(async () => undefined)

  return {
    addListener: vi.fn(async (
      _eventName: string,
      listener: (event: unknown) => void,
    ) => {
      statusListener = listener
      return { remove: removeListener }
    }),
    applyLayout: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    emitStatus(event: unknown): void {
      statusListener?.(event)
    },
    open: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    removeListener,
    resetListener(): void {
      statusListener = null
    },
    setFullscreen: vi.fn(async () => undefined),
  }
})

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'android',
    isNativePlatform: () => true,
  },
  registerPlugin: () => mobilePlugin,
}))

import { MobileSessionLauncher } from './mobile-session-adapter'

const target: AccountSessionLaunchTarget = {
  allowProxy: false,
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
  beforeEach(() => {
    vi.clearAllMocks()
    mobilePlugin.resetListener()
  })

  it('reports the native platform without imposing a client-side session limit', () => {
    const launcher = new MobileSessionLauncher()

    expect(launcher.getPlatform()).toBe('android')
    expect(launcher.mobileNative).toBe(true)
    expect('maxConcurrentSessions' in launcher).toBe(false)
  })

  it('delegates immersive fullscreen to the Android host', async () => {
    const launcher = new MobileSessionLauncher()

    await launcher.setFullscreen(true)
    await launcher.setFullscreen(false)

    expect(mobilePlugin.setFullscreen.mock.calls).toEqual([
      [{ enabled: true }],
      [{ enabled: false }],
    ])
  })

  it('keeps multiple Android sessions alive and delegates controls by account', async () => {
    const launcher = new MobileSessionLauncher()
    const first = account('account-1')
    const second = account('account-2')

    await launcher.open(first, target)
    await launcher.open(second, target)
    await launcher.reload(first)
    await launcher.focus(first)

    expect(mobilePlugin.reload).toHaveBeenCalledWith({ accountId: first.id })
    expect(mobilePlugin.open).toHaveBeenCalledTimes(2)
    expect(mobilePlugin.open).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId: second.id,
    }))

    await launcher.close(first)
    expect(mobilePlugin.close).toHaveBeenCalledWith({ accountId: first.id })
    await launcher.focus(second)
    expect(mobilePlugin.open).toHaveBeenCalledTimes(2)
  })

  it('clears one account without affecting another live session', async () => {
    const launcher = new MobileSessionLauncher()
    const first = account('account-1')
    const second = account('account-2')

    await launcher.open(first, target)
    await launcher.open(second, target)
    await launcher.clearData(first)
    await launcher.focus(second)

    expect(mobilePlugin.clear).toHaveBeenCalledOnce()
    expect(mobilePlugin.clear).toHaveBeenCalledWith({ accountId: first.id })
    expect(mobilePlugin.open).toHaveBeenCalledTimes(2)
  })

  it('sends visible host bounds and keeps background accounts hidden', async () => {
    const launcher = new MobileSessionLauncher()

    await launcher.applyLayout({
      capacity: 1,
      columns: 1,
      overflowSessionIds: ['account-2'],
      pageCount: 1,
      pageIndex: 0,
      requestedMode: '1x1',
      resolvedMode: '1x1',
      rows: 1,
      slots: [{
        bounds: { height: 640, width: 360, x: 8, y: 72 },
        column: 0,
        index: 0,
        row: 0,
        sessionId: 'account-1',
      }],
    } satisfies GridLayout)

    expect(mobilePlugin.applyLayout).toHaveBeenCalledWith({
      sessions: [
        {
          accountId: 'account-1',
          height: 640,
          visible: true,
          width: 360,
          x: 8,
          y: 72,
        },
        {
          accountId: 'account-2',
          height: 0,
          visible: false,
          width: 0,
          x: 0,
          y: 0,
        },
      ],
    })
  })

  it('maps native lifecycle events and removes only the closed account', async () => {
    const launcher = new MobileSessionLauncher()
    const first = account('account-1')
    const second = account('account-2')
    const handler = vi.fn()
    const unsubscribe = launcher.registerStatusHandler(handler)

    await vi.waitFor(() => expect(mobilePlugin.addListener).toHaveBeenCalledWith(
      'sessionStatus',
      expect.any(Function),
    ))
    await launcher.open(first, target)
    await launcher.open(second, target)

    mobilePlugin.emitStatus({ accountId: first.id, status: 'opening' })
    mobilePlugin.emitStatus({ accountId: first.id, status: 'ready' })
    mobilePlugin.emitStatus({
      accountId: first.id,
      reason: 'WebView encerrada.',
      status: 'crashed',
    })
    mobilePlugin.emitStatus({ accountId: first.id, status: 'closed' })

    expect(handler.mock.calls.map(([event]) => event)).toEqual([
      { accountId: first.id, type: 'loading' },
      { accountId: first.id, type: 'ready' },
      {
        accountId: first.id,
        detail: 'WebView encerrada.',
        type: 'crashed',
      },
      { accountId: first.id, type: 'closed' },
    ])
    await launcher.focus(second)
    expect(mobilePlugin.open).toHaveBeenCalledTimes(2)

    unsubscribe()
    await vi.waitFor(() => expect(mobilePlugin.removeListener).toHaveBeenCalledOnce())
  })

  it('ignores malformed native events', async () => {
    const launcher = new MobileSessionLauncher()
    const handler = vi.fn()

    launcher.registerStatusHandler(handler)
    await vi.waitFor(() => expect(mobilePlugin.addListener).toHaveBeenCalledOnce())

    mobilePlugin.emitStatus({ status: 'ready' })
    mobilePlugin.emitStatus({ accountId: 'account-1', status: 'unknown' })

    expect(handler).not.toHaveBeenCalled()
  })
})
