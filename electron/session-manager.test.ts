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
  loadURL: Mock<(url: string) => Promise<void>>
  reload: Mock<() => void>
  setBounds: Mock<(bounds: SessionBounds) => void>
  setEcoMode: Mock<(enabled: boolean) => void>
  setMuted: Mock<(muted: boolean) => void>
  setVisible: Mock<(visible: boolean) => void>
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
      loadURL: vi.fn(async () => undefined),
      reload: vi.fn(),
      setBounds: vi.fn(),
      setEcoMode: vi.fn(),
      setMuted: vi.fn(),
      setVisible: vi.fn(),
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

  it('does not leave startup blocked indefinitely when a game never loads', async () => {
    const harness = createHarness(false, 5)
    harness.createView.mockImplementationOnce((context) => {
      const view: FakeView = {
        attach: vi.fn(),
        destroy: vi.fn(),
        emit: (event) => context.onEvent(event),
        focus: vi.fn(),
        loadURL: vi.fn(() => new Promise<void>(() => undefined)),
        reload: vi.fn(),
        setBounds: vi.fn(),
        setEcoMode: vi.fn(),
        setMuted: vi.fn(),
        setVisible: vi.fn(),
      }
      harness.views.set(context.accountId, view)
      return view
    })

    await expect(harness.manager.createSession(
      'account-timeout',
      'https://game.example/',
    )).resolves.toMatchObject({ status: 'load-failed' })
  })

  it('rejects PII-like ids, unsafe URLs, and invalid view bounds', () => {
    expect(() => normalizeAccountId('person@example.com')).toThrow(TypeError)
    expect(() => normalizeAccountId('../account')).toThrow(TypeError)
    expect(() => normalizeSessionUrl('http://game.example/')).toThrow(TypeError)
    expect(() => normalizeSessionUrl('file:///C:/secret')).toThrow(TypeError)
    expect(normalizeSessionUrl('http://127.0.0.1:8080/', true)).toBe(
      'http://127.0.0.1:8080/',
    )
    expect(() => normalizeSessionBounds({ x: 0, y: 0, width: 0, height: 600 }))
      .toThrow(RangeError)
  })
})
