import {
  session,
  WebContentsView,
  type BrowserWindow,
  type Session,
} from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SESSION_PRELOAD_CHANNELS,
  type SessionProxyConfig,
} from './contracts.js'
import { proxyRules } from './proxy-config-store.js'
import type {
  NativeSessionView,
  NativeSessionViewFactory,
} from './session-manager.js'
import { isAllowedSessionUrl } from './url-policy.js'
import { sampleProcessMetrics } from './process-metrics-sampler.js'
import {
  resolveGamePerformanceProfile,
  type AccountParkingStrategy,
  type GamePerformanceProfile,
} from './game-performance-profile.js'

const hardenedSessions = new WeakSet<Session>()
// Parked views keep their network/timer lifecycle alive, but should almost
// never redraw. Two FPS is enough for lightweight idle-game effects while
// avoiding a hidden renderer competing with the focused account.
const PARKED_COMPATIBILITY_FRAME_RATE = 2
const sessionPreloadPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'session-preload.cjs',
)

function destinationLabel(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'Destino inválido'
  }
}

function safeOrigin(url: string): string {
  try { return new URL(url).origin } catch { return 'unknown' }
}

function hardenPartition(sessionInstance: Session): void {
  sessionInstance.setPermissionCheckHandler(() => false)
  sessionInstance.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  sessionInstance.setDevicePermissionHandler(() => false)
  sessionInstance.on('will-download', (event) => event.preventDefault())
}

function secureWebPreferences(
  sessionInstance: Session,
  allowInsecureLoopback: boolean,
) {
  return {
    allowRunningInsecureContent: false,
    backgroundThrottling: true,
    contextIsolation: true,
    devTools: allowInsecureLoopback,
    navigateOnDragDrop: false,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    preload: sessionPreloadPath,
    sandbox: true,
    safeDialogs: true,
    session: sessionInstance,
    spellcheck: false,
    webSecurity: true,
    webviewTag: false,
  }
}

function parkedBounds(bounds: { height: number; width: number; x: number; y: number }) {
  return {
    ...bounds,
    x: -Math.max(4_096, bounds.width + 64),
    y: -Math.max(4_096, bounds.height + 64),
  }
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0
}

function currentAppMetrics(): Electron.ProcessMetric[] {
  return sampleProcessMetrics().metrics
}

export async function clearNativeSessionPartition(partition: string): Promise<void> {
  const isolatedSession = session.fromPartition(partition, { cache: true })
  await isolatedSession.clearStorageData()
  await isolatedSession.clearCache()
}

export function createNativeSessionViewFactory(
  hostWindow: BrowserWindow,
  allowInsecureLoopback: boolean,
): NativeSessionViewFactory {
  return ({ accountId, onEvent, partition }): NativeSessionView => {
    const isolatedSession = session.fromPartition(partition, { cache: true })

    if (!hardenedSessions.has(isolatedSession)) {
      hardenPartition(isolatedSession)
      hardenedSessions.add(isolatedSession)
    }

    const view = new WebContentsView({
      webPreferences: secureWebPreferences(isolatedSession, allowInsecureLoopback),
    })

    let attached = false
    let destroyed = false
    let frameRateLimit = 0
    let requestedMuted = false
    let requestedZoomFactor = 1
    let parked = true
    let parkingStrategy: AccountParkingStrategy = 'ATTACHED_OFFSCREEN'
    let performanceMode: 'normal' | 'eco' | 'ultra' = 'normal'
    let backgroundThrottlingApplyCount = 0
    let backgroundThrottlingLastReason: string | null = null
    let backgroundThrottlingLastAppliedAt: string | null = null
    let parkingFallbackReason: string | null = null
    let profile: GamePerformanceProfile = resolveGamePerformanceProfile('')
    let detachedAt: number | null = null
    let detachUrl = ''
    let detachPid: number | null = null
    let presentationApplied = false
    let lastSentFrameRate: number | null = null
    let manualCollectionPending = false
    let currentBounds = { height: 720, width: 1_280, x: 0, y: 0 }
    let proxyCredentials: Pick<SessionProxyConfig, 'password' | 'username'> | null = null
    let loadedExtensionId: string | null = null
    let loadedExtensionPath: string | null = null
    const popupWindows = new Set<BrowserWindow>()

    const handleProxyLogin = (
      event: Electron.Event,
      _details: Electron.AuthenticationResponseDetails,
      authInfo: Electron.AuthInfo,
      callback: (username?: string, password?: string) => void,
    ): void => {
      if (!authInfo.isProxy || !proxyCredentials?.username) {
        return
      }

      event.preventDefault()
      callback(proxyCredentials.username, proxyCredentials.password)
    }

    const reportBlockedDestination = (url: string): void => {
      onEvent({
        detail: `${destinationLabel(url)} bloqueado`,
        type: 'popup-blocked',
      })
    }

    const handleWindowOpen = ({ url }: { url: string }) => {
      if (!isAllowedSessionUrl(url, allowInsecureLoopback)) {
        reportBlockedDestination(url)
        return { action: 'deny' as const }
      }

      if (popupWindows.size >= 1) {
        onEvent({
          detail: 'Feche a janela externa já aberta antes de continuar.',
          type: 'popup-blocked',
        })
        return { action: 'deny' as const }
      }

      return {
        action: 'allow' as const,
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#080c11',
          height: 720,
          minHeight: 520,
          minWidth: 520,
          parent: hostWindow,
          show: true,
          title: destinationLabel(url),
          webPreferences: secureWebPreferences(
            isolatedSession,
            allowInsecureLoopback,
          ),
          width: 620,
        },
      }
    }

    const applyBounds = (): void => {
      view.setBounds(parked ? parkedBounds(currentBounds) : currentBounds)
    }

    const fallBackToAttachedParking = (reason: string): void => {
      if (parkingStrategy !== 'DETACHED_VIEW') return
      parkingStrategy = 'ATTACHED_OFFSCREEN'
      parkingFallbackReason = reason
      detachedAt = null
      if (!attached && !destroyed && !hostWindow.isDestroyed()) {
        hostWindow.contentView.addChildView(view)
        attached = true
      }
      applyBounds()
      view.setVisible(!parked)
    }

    const applyBackgroundThrottling = (reason = 'presentation-change'): void => {
      if (!view.webContents.isDestroyed()) {
        // The full benchmark matrix approved Chromium throttling together
        // with detached parking only for Ultra. Normal and Eco retain the
        // compatibility policy that keeps idle-game heartbeats responsive.
        view.webContents.setBackgroundThrottling(performanceMode === 'ultra')
        backgroundThrottlingApplyCount++
        backgroundThrottlingLastReason = reason
        backgroundThrottlingLastAppliedAt = new Date().toISOString()
      }
    }

    const applyFrameRateLimit = (): void => {
      if (!view.webContents.isDestroyed()) {
        const effectiveLimit = parked
          ? Math.min(frameRateLimit > 0 ? frameRateLimit : PARKED_COMPATIBILITY_FRAME_RATE, PARKED_COMPATIBILITY_FRAME_RATE)
          : frameRateLimit
        if (lastSentFrameRate === effectiveLimit) return
        // Electron's native setFrameRate API only supports offscreen rendering.
        // The isolated preload therefore applies a best-effort rAF budget while
        // this on-screen WebContentsView and its authenticated state stay alive.
        view.webContents.send(
          SESSION_PRELOAD_CHANNELS.setFrameRateLimit,
          // A parked account must be capped even when the user configured a
          // higher per-account FPS. Previously an explicit 30/60 FPS setting
          // bypassed the rest-mode budget and kept the hidden renderer busy.
          effectiveLimit,
        )
        lastSentFrameRate = effectiveLimit
      }
    }

    const applyZoomFactor = (): void => {
      if (!view.webContents.isDestroyed()) {
        view.webContents.setZoomFactor(requestedZoomFactor)
      }
    }

    const applyParkedMediaPolicy = (): void => {
      if (view.webContents.isDestroyed()) {
        return
      }
      // Animated image decoding and audio output do not contribute to game
      // timers/network state while a view is parked. Restore both immediately
      // when it returns to the screen.
      view.webContents.setAudioMuted(requestedMuted || parked)
      view.webContents.setImageAnimationPolicy(parked ? profile.imageAnimationPolicy : 'animate')
    }

    const collectUnusedMemory = async (): Promise<boolean> => {
      if (destroyed || view.webContents.isDestroyed() || !allowInsecureLoopback
        || process.env.ALTGRID_EXPERIMENTAL_EXPOSE_GC !== 'true') return false
      try {
        // Manual development experiment only. Never scheduled automatically
        // and never enabled in a packaged build.
        await view.webContents.executeJavaScriptInIsolatedWorld(999, [{
          code: "globalThis.gc?.({ type: 'major', execution: 'async' })",
        }])
        return true
      } catch {
        return false
      }
    }

    view.setBackgroundColor('#080c11')
    view.webContents.setWindowOpenHandler(handleWindowOpen)
    view.webContents.on('did-create-window', (popupWindow) => {
      popupWindows.add(popupWindow)
      popupWindow.setMenuBarVisibility(false)
      popupWindow.webContents.on('login', handleProxyLogin)
      popupWindow.webContents.setWindowOpenHandler(handleWindowOpen)
      popupWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
      popupWindow.webContents.on('will-navigate', (event, url) => {
        if (!isAllowedSessionUrl(url, allowInsecureLoopback)) {
          event.preventDefault()
          reportBlockedDestination(url)
        }
      })
      popupWindow.on('focus', () => onEvent({ type: 'focused' }))
      popupWindow.once('closed', () => popupWindows.delete(popupWindow))
    })
    view.webContents.on('will-attach-webview', (event) => event.preventDefault())
    view.webContents.on('login', handleProxyLogin)
    view.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedSessionUrl(url, allowInsecureLoopback)) {
        event.preventDefault()
        reportBlockedDestination(url)
      }
    })
    view.webContents.on('before-input-event', (event, input) => {
      const switchAccountShortcut = input.type === 'keyDown'
        && (input.control || input.meta)
        && !input.alt
        && !input.shift
        && !input.isAutoRepeat
        && /^[1-9]$/.test(input.key)

      if (switchAccountShortcut) {
        // Native keyboard focus inside the game never reaches the shell's
        // window-level listeners, so Ctrl/Cmd+1-9 must be intercepted here and
        // forwarded, otherwise account switching stops working after a click.
        event.preventDefault()
        onEvent({ type: 'switch-account', detail: input.key })
        return
      }

      const browserZoomShortcut = input.type === 'keyDown'
        && (input.control || input.meta)
        && !input.alt
        && ['+', '-', '0', '=', '_'].includes(input.key)

      if (browserZoomShortcut) {
        // Chromium persists host zoom inside the account partition. Blocking
        // browser zoom here prevents Ctrl/Cmd + wheel/keys from permanently
        // enlarging the game independently from AltGrid's scale control.
        event.preventDefault()
        applyZoomFactor()
        return
      }

      if (
        input.type === 'keyDown'
        && input.key === 'Escape'
        && !input.alt
        && !input.control
        && !input.meta
        && !input.shift
        && !input.isAutoRepeat
      ) {
        // Do not cancel the game's own key event. The shell uses this signal to
        // leave internal maximize/screens-only mode while the page stays intact.
        onEvent({ type: 'escape' })
      }
    })
    view.webContents.on('zoom-changed', (event) => {
      event.preventDefault()
      applyZoomFactor()
    })
    view.webContents.on('did-start-loading', () => onEvent({ type: 'loading' }))
    view.webContents.on('focus', () => onEvent({ type: 'focused' }))
    view.webContents.on('did-finish-load', () => {
      // A new document has a new preload; it must receive the budget even
      // when the preceding page used the same limit.
      lastSentFrameRate = null
      // Reapply after navigation/visibility changes: Electron needs the policy
      // on the live renderer, not just the initial empty WebContents.
      applyBackgroundThrottling('document-finished-loading')
      applyZoomFactor()
      applyFrameRateLimit()
      onEvent({ type: 'ready' })
    })
    view.webContents.on('did-navigate', (_event, url) => {
      if (parkingStrategy === 'DETACHED_VIEW' && detachedAt !== null
        && safeOrigin(url) !== detachUrl) {
        fallBackToAttachedParking('unexpected-navigation')
      }
      onEvent({ type: 'navigated', url })
    })
    view.webContents.on('did-navigate-in-page', (_event, url) => {
      onEvent({ type: 'navigated', url })
    })
    view.webContents.on(
      'did-fail-load',
      (_event, _errorCode, _errorDescription, _url, isMainFrame) => {
        if (isMainFrame) {
          onEvent({
            detail: 'Não foi possível carregar esta conta.',
            type: 'load-failed',
          })
        }
      },
    )
    view.webContents.on('render-process-gone', (_event, details) => {
      if (parkingStrategy === 'DETACHED_VIEW' && detachedAt !== null) {
        fallBackToAttachedParking(`render-process-gone:${details.reason}`)
      }
      if (!destroyed && details.reason !== 'clean-exit') {
        onEvent({ detail: 'Sessão interrompida.', type: 'crashed' })
      }
    })
    view.webContents.on('unresponsive', () => {
      if (parkingStrategy === 'DETACHED_VIEW' && detachedAt !== null) {
        fallBackToAttachedParking('unresponsive')
      }
    })

    return {
      attach(): void {
        if (destroyed || attached) {
          return
        }

        hostWindow.contentView.addChildView(view)
        attached = true
      },

      requestMemoryCleanup(): boolean {
        if (destroyed || view.webContents.isDestroyed() || manualCollectionPending
          || !allowInsecureLoopback
          || process.env.ALTGRID_EXPERIMENTAL_EXPOSE_GC !== 'true') return false
        manualCollectionPending = true
        void collectUnusedMemory().finally(() => { manualCollectionPending = false })
        return true
      },

      destroy(force): void {
        if (destroyed) {
          return
        }

        destroyed = true
        manualCollectionPending = false
        view.setVisible(false)

        for (const popupWindow of popupWindows) {
          if (!popupWindow.isDestroyed()) {
            popupWindow.destroy()
          }
        }
        popupWindows.clear()

        if (loadedExtensionId) {
          isolatedSession.extensions.removeExtension(loadedExtensionId)
          loadedExtensionId = null
          loadedExtensionPath = null
        }

        if (attached && !hostWindow.isDestroyed()) {
          hostWindow.contentView.removeChildView(view)
          attached = false
        }

        if (!view.webContents.isDestroyed()) {
          // Session storage lives in the persistent partition, so closing the
          // WebContents immediately does not discard the game's authenticated state.
          view.webContents.stop()
          view.webContents.close({ waitForBeforeUnload: false })
        }

        if (force) {
          // Abort keep-alive sockets owned by this account. Persistent cookies
          // and storage remain intact, but network/audio helpers can terminate.
          void isolatedSession.closeAllConnections().catch(() => undefined)
        }
      },

      focus(): void {
        if (!destroyed && !parked && view.getVisible() && !view.webContents.isDestroyed()) {
          view.webContents.focus()
        }
      },

      getProcessId(): number | null {
        if (view.webContents.isDestroyed()) return null
        const pid = view.webContents.getOSProcessId()
        return pid > 0 ? pid : null
      },

      getDiagnostics() {
        const rawUrl = view.webContents.isDestroyed() ? '' : view.webContents.getURL()
        let origin = 'unknown'
        try { origin = new URL(rawUrl).origin } catch { /* Redacted diagnostic. */ }
        return {
          webContentsId: view.webContents.id,
          pid: view.webContents.isDestroyed() ? null : view.webContents.getOSProcessId(),
          origin,
          parked,
          attached,
          parkingStrategy,
          parkingFallbackReason,
          detachedAt,
          detachedDurationMs: detachedAt === null ? 0 : Date.now() - detachedAt,
          detachPid,
          urlChangedWhileDetached: detachedAt !== null && safeOrigin(rawUrl) !== detachUrl,
          muted: requestedMuted || parked,
          requestedMuted,
          backgroundThrottling: performanceMode === 'ultra',
          backgroundThrottlingApplyCount,
          backgroundThrottlingLastReason,
          backgroundThrottlingLastAppliedAt,
          imageAnimationPolicy: parked ? profile.imageAnimationPolicy : 'animate',
          profileId: profile.id,
        }
      },

      async getResourceUsage(): Promise<{ cpuPercent: number; privateKb: number; sharedKb: number }> {
        if (view.webContents.isDestroyed()) {
          return { cpuPercent: 0, privateKb: 0, sharedKb: 0 }
        }
        const processId = view.webContents.getOSProcessId()
        // getResourceUsage is requested for every account at once. Reuse one
        // process snapshot for the batch instead of traversing Electron's full
        // process tree N times for N accounts.
        const metric = currentAppMetrics().find((candidate) => candidate.pid === processId)
        const usage = metric?.memory
        const privateKb = finiteNonNegative(
          usage?.privateBytes ?? usage?.workingSetSize,
        )
        const workingSetKb = finiteNonNegative(usage?.workingSetSize)
        return {
          cpuPercent: finiteNonNegative(metric?.cpu?.percentCPUUsage),
          privateKb,
          sharedKb: Math.max(0, workingSetKb - privateKb),
        }
      },

      loadURL(url): Promise<void> {
        profile = resolveGamePerformanceProfile(url)
        return view.webContents.loadURL(url)
      },

      reload(): void {
        if (!view.webContents.isDestroyed()) {
          view.webContents.reload()
        }
      },

      stop(): void {
        if (!view.webContents.isDestroyed()) {
          view.webContents.stop()
        }
      },

      setBounds(bounds): void {
        if (!destroyed) {
          if (bounds.x === currentBounds.x && bounds.y === currentBounds.y
            && bounds.width === currentBounds.width && bounds.height === currentBounds.height) return
          currentBounds = { ...bounds }
          applyBounds()
        }
      },

      setEcoMode(_enabled): void {
        if (!view.webContents.isDestroyed()) {
          applyBackgroundThrottling('performance-mode-change')
        }
      },

      async setExtension(extensionPath): Promise<void> {
        if (loadedExtensionPath === extensionPath) return
        if (loadedExtensionId) {
          isolatedSession.extensions.removeExtension(loadedExtensionId)
          loadedExtensionId = null
          loadedExtensionPath = null
        }
        if (!extensionPath) return
        const loaded = await isolatedSession.extensions.loadExtension(extensionPath)
        loadedExtensionId = loaded.id
        loadedExtensionPath = extensionPath
      },

      setFrameRateLimit(fps): void {
        if (!view.webContents.isDestroyed()) {
          frameRateLimit = fps
          applyFrameRateLimit()
        }
      },

      setMuted(muted): void {
        if (!view.webContents.isDestroyed()) {
          requestedMuted = muted
          applyParkedMediaPolicy()
        }
      },

      async setProxy(config): Promise<void> {
        proxyCredentials = config?.enabled && config.username
          ? { password: config.password, username: config.username }
          : null
        await isolatedSession.setProxy(config?.enabled
          ? {
              mode: 'fixed_servers',
              proxyBypassRules: '<local>',
              proxyRules: proxyRules(config),
            }
          : { mode: 'direct' })
        await isolatedSession.closeAllConnections()
      },

      async testProxy(targetUrl): Promise<import('./contracts.js').SessionProxyTestResult> {
        const startedAt = Date.now()
        const route = await isolatedSession.resolveProxy(targetUrl)
        const routed = route.trim().toUpperCase() !== 'DIRECT'

        if (!routed) {
          return {
            latencyMs: Math.max(0, Date.now() - startedAt),
            message: 'Esta conta está usando conexão direta.',
            ok: false,
            route,
          }
        }

        try {
          const response = await isolatedSession.fetch(targetUrl, {
            cache: 'no-store',
            signal: AbortSignal.timeout(12_000),
          })
          await response.body?.cancel().catch(() => undefined)
          const reachable = response.status >= 200 && response.status < 500

          return {
            latencyMs: Math.max(0, Date.now() - startedAt),
            message: reachable
              ? 'Proxy conectado e resposta recebida pela rota configurada.'
              : `O proxy respondeu, mas o destino retornou HTTP ${response.status}.`,
            ok: reachable,
            route,
          }
        } catch {
          return {
            latencyMs: Math.max(0, Date.now() - startedAt),
            message: 'Não foi possível acessar a internet por este proxy. Confira endereço, porta e credenciais.',
            ok: false,
            route,
          }
        }
      },

      setVisible(visible): void {
        if (!destroyed) {
          if (presentationApplied && parked === !visible) return
          presentationApplied = true
          // Keep the WebContents and persistent partition alive while hiding
          // its pixels when another account is displayed.
          parked = !visible
          if (parkingStrategy === 'DETACHED_VIEW' && parked) {
            detachUrl = safeOrigin(view.webContents.getURL())
            detachPid = view.webContents.getOSProcessId()
            detachedAt = Date.now()
            view.setVisible(false)
            if (attached && !hostWindow.isDestroyed()) {
              hostWindow.contentView.removeChildView(view)
              attached = false
            }
          } else {
            if (!attached && !hostWindow.isDestroyed()) {
              hostWindow.contentView.addChildView(view)
              attached = true
            }
            if (!parked && detachedAt !== null) {
              const currentUrl = view.webContents.getURL()
              const currentOrigin = safeOrigin(currentUrl)
              const currentPid = view.webContents.getOSProcessId()
              if (!currentUrl || currentOrigin !== detachUrl || currentPid !== detachPid) {
                fallBackToAttachedParking(!currentUrl ? 'blank-page' : currentOrigin !== detachUrl
                  ? 'unexpected-navigation' : 'renderer-recreated')
              }
              detachedAt = null
            }
            applyBounds()
            view.setVisible(visible)
          }
          applyBackgroundThrottling('visibility-change')
          applyFrameRateLimit()
          applyParkedMediaPolicy()
        }
      },

      setPerformanceMode(mode): void {
        if (destroyed) return
        performanceMode = mode
        const nextParking: AccountParkingStrategy = mode === 'ultra'
          ? 'DETACHED_VIEW'
          : 'ATTACHED_OFFSCREEN'
        if (parkingStrategy !== nextParking) {
          parkingStrategy = nextParking
          parkingFallbackReason = null
          if (parked && nextParking === 'DETACHED_VIEW' && attached && !hostWindow.isDestroyed()) {
            detachUrl = safeOrigin(view.webContents.getURL())
            detachPid = view.webContents.getOSProcessId()
            detachedAt = Date.now()
            view.setVisible(false)
            hostWindow.contentView.removeChildView(view)
            attached = false
          } else if (nextParking === 'ATTACHED_OFFSCREEN' && !attached && !hostWindow.isDestroyed()) {
            hostWindow.contentView.addChildView(view)
            attached = true
            detachedAt = null
            applyBounds()
            view.setVisible(!parked)
          }
        }
        applyBackgroundThrottling('performance-mode-change')
        applyFrameRateLimit()
        applyParkedMediaPolicy()
      },

      setZoomFactor(factor): void {
        requestedZoomFactor = factor
        applyZoomFactor()
      },
    }
  }
}
