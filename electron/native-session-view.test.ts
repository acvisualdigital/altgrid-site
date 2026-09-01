import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type EventHandler = (...args: unknown[]) => void
type PermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (allowed: boolean) => void,
) => void

const electronMocks = vi.hoisted(() => {
  function createPartition() {
    const handlers = new Map<string, EventHandler>()
    return {
      clearCache: vi.fn(async () => undefined),
      closeAllConnections: vi.fn(async () => undefined),
      clearStorageData: vi.fn(async () => undefined),
      fetch: vi.fn(async () => ({
        body: { cancel: vi.fn(async () => undefined) },
        status: 200,
      })),
      handlers,
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers.set(event, handler)
      }),
      setDevicePermissionHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setProxy: vi.fn(async () => undefined),
      resolveProxy: vi.fn(async () => 'PROXY proxy.example.com:1080'),
    }
  }

  const partitions = new Map<string, ReturnType<typeof createPartition>>()
  const fromPartition = vi.fn((partition: string) => {
    let instance = partitions.get(partition)
    if (!instance) {
      instance = createPartition()
      partitions.set(partition, instance)
    }
    return instance
  })

  class FakeWebContentsView {
    readonly handlers = new Map<string, EventHandler>()
    readonly webContents = {
      close: vi.fn(),
      executeJavaScriptInIsolatedWorld: vi.fn(
        async (
          _worldId: number,
          _scripts: Array<{ code?: string; url?: string }>,
        ): Promise<unknown> => undefined,
      ),
      focus: vi.fn(),
      getURL: vi.fn(() => 'https://game.example/'),
      getOSProcessId: vi.fn(() => 42),
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async () => undefined),
      on: vi.fn((event: string, handler: EventHandler) => {
        this.handlers.set(event, handler)
      }),
      reload: vi.fn(),
      resolveProxy: vi.fn(async () => 'PROXY proxy.example.com:1080'),
      send: vi.fn(),
      setAudioMuted: vi.fn(),
      setBackgroundThrottling: vi.fn(),
      setImageAnimationPolicy: vi.fn(),
      setWindowOpenHandler: vi.fn((handler: EventHandler) => {
        this.windowOpenHandler = handler
      }),
      setZoomFactor: vi.fn(),
      stop: vi.fn(),
    }
    backgroundColor = ''
    bounds: unknown = null
    visible = false
    windowOpenHandler: EventHandler | null = null

    constructor(readonly options: Record<string, unknown>) {
      views.push(this)
    }

    getVisible(): boolean {
      return this.visible
    }

    setBackgroundColor(color: string): void {
      this.backgroundColor = color
    }

    setBounds(bounds: unknown): void {
      this.bounds = bounds
    }

    setVisible(visible: boolean): void {
      this.visible = visible
    }
  }

  const views: FakeWebContentsView[] = []
  const getAppMetrics = vi.fn(() => [{
    cpu: { percentCPUUsage: 12.5 },
    memory: { privateBytes: 128_000, workingSetSize: 144_000 },
    pid: 42,
  }])

  return {
    FakeWebContentsView,
    fromPartition,
    getAppMetrics,
    partitions,
    reset(): void {
      partitions.clear()
      views.splice(0)
      fromPartition.mockClear()
      getAppMetrics.mockReset()
      getAppMetrics.mockReturnValue([{
        cpu: { percentCPUUsage: 12.5 },
        memory: { privateBytes: 128_000, workingSetSize: 144_000 },
        pid: 42,
      }])
    },
    views,
  }
})

vi.mock('electron', () => ({
  app: {
    getAppMetrics: electronMocks.getAppMetrics,
  },
  session: {
    fromPartition: electronMocks.fromPartition,
  },
  WebContentsView: electronMocks.FakeWebContentsView,
}))

import {
  clearNativeSessionPartition,
  createNativeSessionViewFactory,
} from './native-session-view.js'

function createHostWindow() {
  const addChildView = vi.fn()
  const removeChildView = vi.fn()
  return {
    addChildView,
    hostWindow: {
      contentView: { addChildView, removeChildView },
      isDestroyed: vi.fn(() => false),
    } as unknown as BrowserWindow,
    removeChildView,
  }
}

describe('createNativeSessionViewFactory', () => {
  beforeEach(() => {
    electronMocks.reset()
  })

  it('binds every account view to its own hardened persistent partition', () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)

    factory({
      accountId: 'account-1',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-1',
    })
    factory({
      accountId: 'account-2',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-2',
    })

    expect(electronMocks.fromPartition).toHaveBeenNthCalledWith(
      1,
      'persist:altgrid-account-account-1',
      { cache: true },
    )
    expect(electronMocks.fromPartition).toHaveBeenNthCalledWith(
      2,
      'persist:altgrid-account-account-2',
      { cache: true },
    )
    const firstPartition = electronMocks.partitions.get(
      'persist:altgrid-account-account-1',
    )!
    const secondPartition = electronMocks.partitions.get(
      'persist:altgrid-account-account-2',
    )!
    expect(firstPartition).not.toBe(secondPartition)

    for (const partition of [firstPartition, secondPartition]) {
      const checkPermission = partition.setPermissionCheckHandler.mock.calls[0]?.[0] as unknown as (() => boolean) | undefined
      const requestPermission = partition.setPermissionRequestHandler.mock.calls[0]?.[0] as unknown as PermissionRequestHandler | undefined
      const checkDevice = partition.setDevicePermissionHandler.mock.calls[0]?.[0] as unknown as (() => boolean) | undefined
      const permissionResult = vi.fn()
      const downloadEvent = { preventDefault: vi.fn() }

      expect(checkPermission?.()).toBe(false)
      requestPermission?.(null, 'camera', permissionResult)
      expect(permissionResult).toHaveBeenCalledWith(false)
      expect(checkDevice?.()).toBe(false)
      partition.handlers.get('will-download')?.(downloadEvent)
      expect(downloadEvent.preventDefault).toHaveBeenCalledOnce()
    }

    const [firstView, secondView] = electronMocks.views
    const firstPreferences = firstView?.options.webPreferences as Record<string, unknown>
    const secondPreferences = secondView?.options.webPreferences as Record<string, unknown>
    expect(firstPreferences.session).toBe(firstPartition)
    expect(secondPreferences.session).toBe(secondPartition)
    expect(firstPreferences).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      preload: expect.stringMatching(/session-preload\.cjs$/),
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    })
  })

  it('hardens a reused persistent partition once without clearing its storage', () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const context = {
      accountId: 'account-1',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-1',
    }

    factory(context)
    factory(context)

    const partition = electronMocks.partitions.get(context.partition)!
    expect(electronMocks.fromPartition).toHaveBeenCalledTimes(2)
    expect(partition.setPermissionCheckHandler).toHaveBeenCalledOnce()
    expect(partition.setPermissionRequestHandler).toHaveBeenCalledOnce()
    expect(partition.setDevicePermissionHandler).toHaveBeenCalledOnce()
    expect(partition.on).toHaveBeenCalledOnce()
  })

  it('throttles hidden views without closing their persistent WebContents', () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-eco',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-eco',
    })
    const view = electronMocks.views[0]!

    nativeView.setEcoMode(true)
    nativeView.setVisible(true)
    nativeView.setVisible(false)
    nativeView.setEcoMode(false)

    expect(view.webContents.setBackgroundThrottling.mock.calls).toEqual([
      [true],
      [true],
      [true],
      [true],
    ])
    expect(view.webContents.loadURL).not.toHaveBeenCalled()
    expect(view.webContents.reload).not.toHaveBeenCalled()
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(view.webContents.send).toHaveBeenLastCalledWith(
      'altgrid:session-preload:set-frame-rate-limit',
      1,
    )
  })

  it('reclaims unreachable V8 memory after a view is parked', async () => {
    vi.useFakeTimers()
    try {
      const { hostWindow } = createHostWindow()
      const factory = createNativeSessionViewFactory(hostWindow, false)
      const nativeView = factory({
        accountId: 'account-parked-gc',
        onEvent: vi.fn(),
        partition: 'persist:altgrid-account-account-parked-gc',
      })
      const view = electronMocks.views[0]!

      nativeView.setVisible(false)
      await vi.advanceTimersByTimeAsync(2_000)

      expect(view.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
        999,
        [{ code: 'globalThis.gc?.()' }],
      )
      expect(view.webContents.close).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(30_000)
      expect(view.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('suppresses hidden media work without stopping the game renderer', () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-media-rest',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-media-rest',
    })
    const view = electronMocks.views[0]!

    nativeView.setMuted(false)
    nativeView.setVisible(true)
    nativeView.setVisible(false)

    expect(view.webContents.setImageAnimationPolicy).toHaveBeenLastCalledWith('noAnimation')
    expect(view.webContents.setAudioMuted).toHaveBeenLastCalledWith(true)
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(view.webContents.stop).not.toHaveBeenCalled()

    nativeView.setVisible(true)
    expect(view.webContents.setImageAnimationPolicy).toHaveBeenLastCalledWith('animate')
    expect(view.webContents.setAudioMuted).toHaveBeenLastCalledWith(false)
  })

  it('applies the zoom factor to the live WebContents until destroyed', () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-zoom',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-zoom',
    })
    const view = electronMocks.views[0]!

    nativeView.setZoomFactor(0.75)
    expect(view.webContents.setZoomFactor).toHaveBeenLastCalledWith(0.75)

    view.webContents.isDestroyed.mockReturnValue(true)
    nativeView.setZoomFactor(1)
    expect(view.webContents.setZoomFactor).toHaveBeenCalledOnce()
  })

  it('blocks Chromium zoom shortcuts and restores the AltGrid scale', () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-protected-zoom',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-protected-zoom',
    })
    const view = electronMocks.views[0]!
    const inputEvent = { preventDefault: vi.fn() }
    const zoomEvent = { preventDefault: vi.fn() }

    nativeView.setZoomFactor(0.75)
    view.handlers.get('before-input-event')?.(inputEvent, {
      alt: false,
      control: true,
      isAutoRepeat: false,
      key: '+',
      meta: false,
      shift: false,
      type: 'keyDown',
    })
    view.handlers.get('zoom-changed')?.(zoomEvent, 'in')

    expect(inputEvent.preventDefault).toHaveBeenCalledOnce()
    expect(zoomEvent.preventDefault).toHaveBeenCalledOnce()
    expect(view.webContents.setZoomFactor).toHaveBeenLastCalledWith(0.75)
  })

  it('applies one proxy per partition and answers only proxy authentication', async () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-proxy',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-proxy',
    })
    const view = electronMocks.views[0]!
    const partition = electronMocks.partitions.get(
      'persist:altgrid-account-account-proxy',
    )!

    await nativeView.setProxy({
      enabled: true,
      host: 'proxy.example.com',
      password: 'secret',
      port: 1080,
      protocol: 'socks5',
      username: 'founder',
    })

    expect(partition.setProxy).toHaveBeenCalledWith({
      mode: 'fixed_servers',
      proxyBypassRules: '<local>',
      proxyRules: 'socks5://proxy.example.com:1080',
    })
    expect(partition.closeAllConnections).toHaveBeenCalledOnce()

    const callback = vi.fn()
    const proxyEvent = { preventDefault: vi.fn() }
    view.handlers.get('login')?.(
      proxyEvent,
      {},
      { isProxy: true },
      callback,
    )
    expect(proxyEvent.preventDefault).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith('founder', 'secret')

    callback.mockClear()
    view.handlers.get('login')?.(
      { preventDefault: vi.fn() },
      {},
      { isProxy: false },
      callback,
    )
    expect(callback).not.toHaveBeenCalled()
  })

  it('validates a proxy with a real request through the isolated partition', async () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-proxy-test',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-proxy-test',
    })
    const partition = electronMocks.partitions.get(
      'persist:altgrid-account-account-proxy-test',
    )!

    const result = await nativeView.testProxy('https://api.example.com/health')

    expect(partition.resolveProxy).toHaveBeenCalledWith('https://api.example.com/health')
    expect(partition.fetch).toHaveBeenCalledWith(
      'https://api.example.com/health',
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect(result).toMatchObject({
      message: 'Proxy conectado e resposta recebida pela rota configurada.',
      ok: true,
      route: 'PROXY proxy.example.com:1080',
    })
  })

  it('does not report a direct connection as a valid proxy', async () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-direct-test',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-direct-test',
    })
    const partition = electronMocks.partitions.get(
      'persist:altgrid-account-account-direct-test',
    )!
    partition.resolveProxy.mockResolvedValueOnce('DIRECT')

    const result = await nativeView.testProxy('https://api.example.com/health')

    expect(partition.fetch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, route: 'DIRECT' })
  })

  it('sends the best-effort FPS budget without using offscreen frame APIs', () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-fps',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-fps',
    })
    const view = electronMocks.views[0]!

    nativeView.setVisible(true)
    nativeView.setFrameRateLimit(24)
    expect(view.webContents.send).toHaveBeenLastCalledWith(
      'altgrid:session-preload:set-frame-rate-limit',
      24,
    )

    view.handlers.get('did-finish-load')?.()
    expect(view.webContents.send).toHaveBeenLastCalledWith(
      'altgrid:session-preload:set-frame-rate-limit',
      24,
    )
    expect(view.webContents.send).toHaveBeenCalledTimes(3)
    expect('setFrameRate' in view.webContents).toBe(false)
  })

  it('reports CPU and private memory for the account renderer process', async () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-metrics',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-metrics',
    })

    await expect(nativeView.getResourceUsage()).resolves.toEqual({
      cpuPercent: 12.5,
      privateKb: 128_000,
      sharedKb: 16_000,
    })
  })

  it('shares one Electron process snapshot across a simultaneous account batch', async () => {
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const first = factory({
      accountId: 'account-metrics-a',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-metrics-a',
    })
    const second = factory({
      accountId: 'account-metrics-b',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-metrics-b',
    })

    await Promise.all([first.getResourceUsage(), second.getResourceUsage()])

    expect(electronMocks.getAppMetrics).toHaveBeenCalledOnce()
  })

  it('normalizes temporarily invalid native CPU and memory readings', async () => {
    electronMocks.getAppMetrics.mockReturnValueOnce([{
      cpu: { percentCPUUsage: Number.NaN },
      memory: { privateBytes: Number.NaN, workingSetSize: Number.NaN },
      pid: 42,
    }])
    const { hostWindow } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-invalid-metrics',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-invalid-metrics',
    })

    await expect(nativeView.getResourceUsage()).resolves.toEqual({
      cpuPercent: 0,
      privateKb: 0,
      sharedKb: 0,
    })
  })

  it('reports focus from the native game surface', () => {
    const { hostWindow } = createHostWindow()
    const onEvent = vi.fn()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    factory({
      accountId: 'account-focus',
      onEvent,
      partition: 'persist:altgrid-account-account-focus',
    })

    electronMocks.views[0]!.handlers.get('focus')?.()

    expect(onEvent).toHaveBeenCalledWith({ type: 'focused' })
  })

  it('clears storage and cache only when explicitly requested', async () => {
    await clearNativeSessionPartition('persist:altgrid-account-account-1')

    const partition = electronMocks.partitions.get(
      'persist:altgrid-account-account-1',
    )!
    expect(partition.clearStorageData).toHaveBeenCalledOnce()
    expect(partition.clearCache).toHaveBeenCalledOnce()
  })

  it('allows safe authentication popups in the account partition and blocks unsafe escapes', () => {
    const { hostWindow } = createHostWindow()
    const onEvent = vi.fn()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    factory({
      accountId: 'account-1',
      onEvent,
      partition: 'persist:altgrid-account-account-1',
    })
    const view = electronMocks.views[0]!
    const partition = electronMocks.partitions.get(
      'persist:altgrid-account-account-1',
    )!

    const safePopup = view.windowOpenHandler?.({
      url: 'https://accounts.google.com/o/oauth2/v2/auth',
    }) as unknown as {
      action?: string
      overrideBrowserWindowOptions?: {
        webPreferences?: { session?: unknown }
      }
    }
    expect(safePopup.action).toBe('allow')
    expect(
      safePopup.overrideBrowserWindowOptions?.webPreferences?.session,
    ).toBe(partition)
    expect(view.windowOpenHandler?.({ url: 'javascript:alert(1)' })).toEqual({
      action: 'deny',
    })
    const webviewEvent = { preventDefault: vi.fn() }
    view.handlers.get('will-attach-webview')?.(webviewEvent)
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce()

    const safeNavigation = { preventDefault: vi.fn() }
    const unsafeNavigation = { preventDefault: vi.fn() }
    view.handlers.get('will-navigate')?.(
      safeNavigation,
      'https://game.example/next',
    )
    view.handlers.get('will-navigate')?.(
      unsafeNavigation,
      'file:///C:/private.txt',
    )
    expect(safeNavigation.preventDefault).not.toHaveBeenCalled()
    expect(unsafeNavigation.preventDefault).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining('bloqueado'),
      type: 'popup-blocked',
    }))
  })

  it('attaches once and destroys the native view without deleting its partition', () => {
    const { addChildView, hostWindow, removeChildView } = createHostWindow()
    const factory = createNativeSessionViewFactory(hostWindow, false)
    const nativeView = factory({
      accountId: 'account-1',
      onEvent: vi.fn(),
      partition: 'persist:altgrid-account-account-1',
    })
    const view = electronMocks.views[0]!

    nativeView.attach()
    nativeView.attach()
    nativeView.setVisible(true)
    nativeView.focus()
    nativeView.stop()
    nativeView.destroy(false)
    nativeView.destroy(true)

    expect(addChildView).toHaveBeenCalledOnce()
    expect(removeChildView).toHaveBeenCalledOnce()
    expect(view.webContents.focus).toHaveBeenCalledOnce()
    // One explicit stop plus the defensive stop performed during destruction.
    expect(view.webContents.stop).toHaveBeenCalledTimes(2)
    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(view.webContents.close).toHaveBeenCalledWith({
      waitForBeforeUnload: false,
    })
    expect(electronMocks.partitions.size).toBe(1)
  })
})
