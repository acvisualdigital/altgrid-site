import { describe, expect, it, vi, type Mock } from 'vitest'

import type { SessionBounds } from './contracts.js'
import {
  SessionManager,
  normalizeAccountId,
  normalizeSessionBounds,
  normalizeSessionUrl,
  type NativeSessionEvent,
  type NativeSessionView,
  type NativeSessionViewContext,
} from './session-manager.js'

interface FakeView extends NativeSessionView {
  attach: Mock<() => void>
  destroy: Mock<(force: boolean) => void>
  emit(event: NativeSessionEvent): void
  focus: Mock<() => void>
  getResourceUsage: Mock<() => Promise<{ privateKb: number; sharedKb: number }>>
  loadURL: Mock<(url: string) => Promise<void>>
  reload: Mock<() => void>
  stop: Mock<() => void>
  setBounds: Mock<(bounds: SessionBounds) => void>
  setEcoMode: Mock<(enabled: boolean) => void>
  setFrameRateLimit: Mock<(fps: number) => void>
  setMuted: Mock<(muted: boolean) => void>
  setProxy: Mock<(config: import('./contracts.js').SessionProxyConfig | null) => Promise<void>>
  setVisible: Mock<(visible: boolean) => void>
  setZoomFactor: Mock<(factor: number) => void>
  testProxy: Mock<(targetUrl: string) => Promise<import('./contracts.js').SessionProxyTestResult>>
}

function createHarness(
  allowInsecureLoopback = false,
  loadTimeoutMs?: number,
) {
  const contexts = new Map<string, NativeSessionViewContext>()
  const views = new Map<string, FakeView>()
  const clearPartitionData = vi.fn(async () => undefined)
  const createView = vi.fn((context: NativeSessionViewContext): FakeView => {
    const view: FakeView = {
      attach: vi.fn(),
      destroy: vi.fn(),
      emit: (event) => context.onEvent(event),
      focus: vi.fn(),
      getResourceUsage: vi.fn(async () => ({ privateKb: 128_000, sharedKb: 16_000 })),
      loadURL: vi.fn(async () => undefined),
      reload: vi.fn(),
      stop: vi.fn(),
      setBounds: vi.fn(),
      setEcoMode: vi.fn(),
      setFrameRateLimit: vi.fn(),
      setMuted: vi.fn(),
      setProxy: vi.fn(async () => undefined),
      setVisible: vi.fn(),
      setZoomFactor: vi.fn(),
      testProxy: vi.fn(async () => ({
        latencyMs: 1,
        message: 'Rota aplicada.',
        ok: true,
        route: 'PROXY proxy.example.com:8080',
      })),
    }
    contexts.set(context.accountId, context)
    views.set(context.accountId, view)
    return view
  })
  const manager = new SessionManager({
    allowInsecureLoopback,
    clearPartitionData,
    createView,
    loadTimeoutMs,
  })

  return { clearPartitionData, contexts, createView, manager, views }
}

describe('SessionManager', () => {
  it('creates one persistent isolated partition per internal account id', async () => {
    const harness = createHarness()

    const first = await harness.manager.createSession(
      'account-1',
      'https://game.example/play',
    )
    const second = await harness.manager.createSession(
      'account-2',
      'https://game.example/play',
    )

    expect(first.partition).toBe('persist:altgrid-account-account-1')
    expect(second.partition).toBe('persist:altgrid-account-account-2')
    expect(first.partition).not.toBe(second.partition)
    expect(harness.contexts.get('account-1')?.accountId).toBe('account-1')
    expect(harness.createView).toHaveBeenCalledTimes(2)
  })

  it('applies an isolated proxy before the first account load', async () => {
    const harness = createHarness()
    const proxy = {
      enabled: true,
      host: 'proxy.example.com',
      password: 'secret',
      port: 1080,
      protocol: 'socks5' as const,
      username: 'founder',
    }

    await harness.manager.createSession(
      'account-proxy',
      'https://game.example/',
      proxy,
    )

    const view = harness.views.get('account-proxy')!
    expect(view.setProxy).toHaveBeenCalledWith(proxy)
    expect(view.setProxy.mock.invocationCallOrder[0]).toBeLessThan(
      view.loadURL.mock.invocationCallOrder[0]!,
    )
  })

  it('reconnects an open account after changing its proxy', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-proxy', 'https://game.example/')
    const view = harness.views.get('account-proxy')!
    view.loadURL.mockClear()

    await harness.manager.setSessionProxy('account-proxy', {
      enabled: true,
      host: 'proxy.example.com',
      password: '',
      port: 8080,
      protocol: 'http',
      username: '',
    })

    expect(view.setProxy).toHaveBeenLastCalledWith(expect.objectContaining({
      host: 'proxy.example.com',
    }))
    expect(view.loadURL).toHaveBeenCalledWith('https://game.example/')
  })

  it('does not recreate or reload while showing, hiding, resizing, or muting', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-1', 'https://game.example/')
    const view = harness.views.get('account-1')!
    const bounds: SessionBounds = { x: 20, y: 40, width: 800, height: 600 }

    harness.manager.showSession('account-1')
    harness.manager.focusSession('account-1')
    harness.manager.resizeSession('account-1', bounds)
    harness.manager.hideSession('account-1')
    harness.manager.showSession('account-1')
    harness.manager.muteSession('account-1', true)

    expect(harness.createView).toHaveBeenCalledOnce()
    expect(view.loadURL).toHaveBeenCalledOnce()
    expect(view.reload).not.toHaveBeenCalled()
    expect(view.focus).toHaveBeenCalledOnce()
    expect(view.setBounds).toHaveBeenLastCalledWith(bounds)
    expect(view.setVisible.mock.calls.map((call) => call[0])).toEqual([
      false,
      true,
      false,
      true,
    ])
    expect(harness.manager.getSessions()[0]).toMatchObject({
      bounds,
      muted: true,
      visible: true,
    })
  })

  it('skips repeated visibility, bounds, and mute updates', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-1', 'https://game.example/')
    const view = harness.views.get('account-1')!
    const initialBounds: SessionBounds = {
      x: 0,
      y: 0,
      width: 1_280,
      height: 720,
    }
    const resizedBounds: SessionBounds = {
      x: 20,
      y: 40,
      width: 800,
      height: 600,
    }
    view.setBounds.mockClear()
    view.setMuted.mockClear()
    view.setVisible.mockClear()

    harness.manager.hideSession('account-1')
    harness.manager.resizeSession('account-1', initialBounds)
    harness.manager.muteSession('account-1', false)
    harness.manager.showSession('account-1')
    harness.manager.showSession('account-1')
    harness.manager.hideSession('account-1')
    harness.manager.hideSession('account-1')
    harness.manager.resizeSession('account-1', resizedBounds)
    harness.manager.resizeSession('account-1', { ...resizedBounds })
    harness.manager.muteSession('account-1', true)
    harness.manager.muteSession('account-1', true)

    expect(view.setVisible.mock.calls.map((call) => call[0])).toEqual([
      true,
      false,
    ])
    expect(view.setBounds).toHaveBeenCalledOnce()
    expect(view.setBounds).toHaveBeenCalledWith(resizedBounds)
    expect(view.setMuted).toHaveBeenCalledOnce()
    expect(view.setMuted).toHaveBeenCalledWith(true)
  })

  it('zooms out narrow grid slots so non-responsive games stop clipping', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-1', 'https://game.example/')
    const view = harness.views.get('account-1')!
    view.setZoomFactor.mockClear()

    harness.manager.resizeSession('account-1', { x: 0, y: 0, width: 480, height: 600 })
    expect(view.setZoomFactor).toHaveBeenLastCalledWith(0.67)

    harness.manager.resizeSession('account-1', { x: 0, y: 0, width: 1_920, height: 1_080 })
    expect(view.setZoomFactor).toHaveBeenLastCalledWith(1)
  })

  it('applies Eco Mode to existing sessions and new sessions without reloading', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-1', 'https://game.example/')
    await harness.manager.createSession('account-2', 'https://game.example/')

    expect(harness.manager.setEcoMode(true)).toBe(true)

    for (const accountId of ['account-1', 'account-2']) {
      const view = harness.views.get(accountId)!
      expect(view.setEcoMode).toHaveBeenLastCalledWith(true)
      expect(view.loadURL).toHaveBeenCalledOnce()
      expect(view.reload).not.toHaveBeenCalled()
      expect(view.destroy).not.toHaveBeenCalled()
    }

    await harness.manager.createSession('account-3', 'https://game.example/')
    expect(harness.views.get('account-3')?.setEcoMode).toHaveBeenCalledWith(true)
    expect(harness.manager.setEcoMode(false)).toBe(false)
    for (const view of harness.views.values()) {
      expect(view.setEcoMode).toHaveBeenLastCalledWith(false)
    }

    expect(() => harness.manager.setEcoMode('true')).toThrow(TypeError)
  })

  it('keeps the focused session smooth and applies the Eco budget to the others', async () => {
    const harness = createHarness()
    const events = vi.fn()
    harness.manager.subscribe(events)
    await harness.manager.createSession('account-1', 'https://game.example/')
    await harness.manager.createSession('account-2', 'https://game.example/')
    harness.manager.showSession('account-1')
    harness.manager.showSession('account-2')
    const first = harness.views.get('account-1')!
    const second = harness.views.get('account-2')!
    first.setFrameRateLimit.mockClear()
    second.setFrameRateLimit.mockClear()

    harness.manager.setFrameRate('account-1', 60)
    harness.manager.setFrameRate('account-2', 0)
    harness.manager.setEcoMode(true)

    expect(first.setFrameRateLimit).toHaveBeenLastCalledWith(60)
    expect(second.setFrameRateLimit).toHaveBeenLastCalledWith(20)

    second.emit({ type: 'focused' })
    expect(first.setFrameRateLimit).toHaveBeenLastCalledWith(20)
    expect(second.setFrameRateLimit).toHaveBeenLastCalledWith(0)
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId: 'account-2',
      type: 'focused',
    }))

    harness.manager.setEcoMode(true, 30)
    expect(first.setFrameRateLimit).toHaveBeenLastCalledWith(30)
    expect(second.setFrameRateLimit).toHaveBeenLastCalledWith(0)
    expect(() => harness.manager.setEcoMode(true, 9)).toThrow(RangeError)
    expect(() => harness.manager.setEcoMode(true, 31)).toThrow(RangeError)
  })

  it('stores a desired FPS per session and updates native state before its snapshot', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-1', 'https://game.example/')
    const view = harness.views.get('account-1')!
    view.setFrameRateLimit.mockClear()

    expect(harness.manager.setFrameRate('account-1', 75.4).frameRate).toBe(75)
    expect(view.setFrameRateLimit).toHaveBeenLastCalledWith(75)
    expect(harness.manager.setFrameRate('account-1', 999).frameRate).toBe(240)
    expect(harness.manager.setFrameRate('account-1', -4).frameRate).toBe(0)
    expect(() => harness.manager.setFrameRate('account-1', Number.NaN)).toThrow(TypeError)

    view.setFrameRateLimit.mockImplementationOnce(() => {
      throw new Error('native failure')
    })
    expect(() => harness.manager.setFrameRate('account-1', 30)).toThrow('native failure')
    expect(harness.manager.getSessions()[0]?.frameRate).toBe(0)
  })

  it('rolls existing sessions back when a native Eco Mode update fails', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-1', 'https://game.example/')
    await harness.manager.createSession('account-2', 'https://game.example/')
    harness.views.get('account-2')?.setEcoMode.mockImplementationOnce(() => {
      throw new Error('native failure')
    })

    expect(() => harness.manager.setEcoMode(true)).toThrow(
      'Não foi possível alterar o Eco Mode.',
    )
    expect(harness.views.get('account-1')?.setEcoMode.mock.calls.slice(-2))
      .toEqual([[true], [false]])
    expect(harness.views.get('account-2')?.setEcoMode).toHaveBeenLastCalledWith(false)

    // The manager retained OFF, so a later session inherits the safe state.
    await harness.manager.createSession('account-3', 'https://game.example/')
    expect(harness.views.get('account-3')?.setEcoMode).toHaveBeenCalledWith(false)
  })

  it('reuses an existing session when create is requested again', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-1', 'https://game.example/one')
    const reused = await harness.manager.createSession(
      'account-1',
      'https://game.example/two',
    )

    expect(reused.url).toBe('https://game.example/one')
    expect(harness.createView).toHaveBeenCalledOnce()
    expect(harness.views.get('account-1')?.loadURL).toHaveBeenCalledOnce()
  })

  it('reloads and navigates only through explicit commands', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-1', 'https://game.example/one')
    const view = harness.views.get('account-1')!

    harness.manager.reloadSession('account-1')
    await harness.manager.navigateSession('account-1', 'https://game.example/two')

    expect(view.reload).toHaveBeenCalledOnce()
    expect(view.loadURL).toHaveBeenNthCalledWith(2, 'https://game.example/two')
    expect(harness.manager.getSessions()[0]?.url).toBe('https://game.example/two')
  })

  it('reports a session crash without affecting other sessions', async () => {
    const harness = createHarness()
    const events = vi.fn()
    harness.manager.subscribe(events)
    await harness.manager.createSession('account-1', 'https://game.example/')
    await harness.manager.createSession('account-2', 'https://game.example/')

    harness.views.get('account-1')?.emit({
      detail: 'Sessão interrompida.',
      type: 'crashed',
    })

    expect(harness.manager.getSessions()).toEqual([
      expect.objectContaining({ accountId: 'account-1', status: 'crashed' }),
      expect.objectContaining({ accountId: 'account-2', status: 'loading' }),
    ])
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId: 'account-1',
      type: 'crashed',
    }))

    harness.manager.reloadSession('account-1')
    expect(harness.manager.getSessions()[0]?.status).toBe('loading')
  })

  it('uses graceful close versus forced destroy without clearing the partition', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-close', 'https://game.example/')
    await harness.manager.createSession('account-destroy', 'https://game.example/')

    expect(harness.manager.closeSession('account-close')).toBe(true)
    expect(harness.views.get('account-close')?.destroy).toHaveBeenCalledWith(false)
    expect(harness.manager.destroySession('account-destroy')).toBe(true)
    expect(harness.views.get('account-destroy')?.destroy).toHaveBeenCalledWith(true)
    expect(harness.manager.getSessions()).toEqual([])
  })

  it('clears only the isolated partition selected by internal account id', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-clean', 'https://game.example/')

    await expect(harness.manager.clearSessionData('account-clean')).resolves.toBe(true)

    expect(harness.views.get('account-clean')?.destroy).toHaveBeenCalledWith(true)
    expect(harness.clearPartitionData).toHaveBeenCalledWith(
      'persist:altgrid-account-account-clean',
    )
    expect(harness.manager.getSessions()).toEqual([])
  })

  it('reports private memory independently for every active account', async () => {
    const harness = createHarness()
    await harness.manager.createSession('account-memory-a', 'https://game.example/')
    await harness.manager.createSession('account-memory-b', 'https://game.example/')

    await expect(harness.manager.getResourceUsage()).resolves.toEqual([
      { accountId: 'account-memory-a', privateKb: 128_000, sharedKb: 16_000 },
      { accountId: 'account-memory-b', privateKb: 128_000, sharedKb: 16_000 },
    ])
  })

  it('does not leave startup blocked indefinitely when a game never loads', async () => {
    const harness = createHarness(false, 5)
    harness.createView.mockImplementationOnce((context) => {
      const view: FakeView = {
        attach: vi.fn(),
        destroy: vi.fn(),
        emit: (event) => context.onEvent(event),
        focus: vi.fn(),
        getResourceUsage: vi.fn(async () => ({ privateKb: 128_000, sharedKb: 16_000 })),
        loadURL: vi.fn(() => new Promise<void>(() => undefined)),
        reload: vi.fn(),
        stop: vi.fn(),
        setBounds: vi.fn(),
        setEcoMode: vi.fn(),
        setFrameRateLimit: vi.fn(),
        setMuted: vi.fn(),
        setProxy: vi.fn(async () => undefined),
        setVisible: vi.fn(),
        setZoomFactor: vi.fn(),
        testProxy: vi.fn(async () => ({
          latencyMs: 1,
          message: 'Rota aplicada.',
          ok: true,
          route: 'PROXY proxy.example.com:8080',
        })),
      }
      harness.views.set(context.accountId, view)
      return view
    })

    await expect(harness.manager.createSession(
      'account-timeout',
      'https://game.example/',
    )).resolves.toMatchObject({ status: 'load-failed' })
    expect(harness.views.get('account-timeout')?.stop).toHaveBeenCalledOnce()
  })

  it('rejects PII-like ids, unsafe URLs, and invalid view bounds', () => {
    expect(() => normalizeAccountId('person@example.com')).toThrow(TypeError)
    expect(() => normalizeAccountId('../account')).toThrow(TypeError)
    expect(() => normalizeSessionUrl('http://game.example/')).toThrow(TypeError)
    expect(() => normalizeSessionUrl('file:///C:/secret')).toThrow(TypeError)
    expect(normalizeSessionUrl('http://127.0.0.1:8080/', true)).toBe(
      'http://127.0.0.1:8080/',
    )
    expect(normalizeSessionBounds({ x: 0, y: 0, width: 8_192, height: 4_096 }))
      .toEqual({ x: 0, y: 0, width: 8_192, height: 4_096 })
    expect(() => normalizeSessionBounds({ x: 0, y: 0, width: 0, height: 600 }))
      .toThrow(RangeError)
    expect(() => normalizeSessionBounds({
      x: 0,
      y: 0,
      width: 8_192,
      height: 4_097,
    })).toThrow(RangeError)
  })
})
