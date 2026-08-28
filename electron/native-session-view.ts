import {
  session,
  WebContentsView,
  type BrowserWindow,
  type Session,
} from 'electron'

import type {
  NativeSessionView,
  NativeSessionViewFactory,
} from './session-manager.js'
import { isAllowedSessionUrl } from './url-policy.js'

const hardenedSessions = new WeakSet<Session>()

function destinationLabel(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'Destino inválido'
  }
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
    let ecoModeEnabled = false
    let parked = true
    let currentBounds = { height: 720, width: 1_280, x: 0, y: 0 }
    const popupWindows = new Set<BrowserWindow>()

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

    const applyBackgroundThrottling = (): void => {
      if (!view.webContents.isDestroyed()) {
        // Hidden views keep their persistent partition but stop spending
        // renderer time while another account is on screen.
        view.webContents.setBackgroundThrottling(ecoModeEnabled || parked)
      }
    }

    view.setBackgroundColor('#080c11')
    view.webContents.setWindowOpenHandler(handleWindowOpen)
    view.webContents.on('did-create-window', (popupWindow) => {
      popupWindows.add(popupWindow)
      popupWindow.setMenuBarVisibility(false)
      popupWindow.webContents.setWindowOpenHandler(handleWindowOpen)
      popupWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
      popupWindow.webContents.on('will-navigate', (event, url) => {
        if (!isAllowedSessionUrl(url, allowInsecureLoopback)) {
          event.preventDefault()
          reportBlockedDestination(url)
        }
      })
      popupWindow.once('closed', () => popupWindows.delete(popupWindow))
    })
    view.webContents.on('will-attach-webview', (event) => event.preventDefault())
    view.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedSessionUrl(url, allowInsecureLoopback)) {
        event.preventDefault()
        reportBlockedDestination(url)
      }
    })
    view.webContents.on('before-input-event', (_event, input) => {
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
    view.webContents.on('did-start-loading', () => onEvent({ type: 'loading' }))
    view.webContents.on('did-finish-load', () => onEvent({ type: 'ready' }))
    view.webContents.on('did-navigate', (_event, url) => {
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
      if (!destroyed && details.reason !== 'clean-exit') {
        onEvent({ detail: 'Sessão interrompida.', type: 'crashed' })
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

      destroy(force): void {
        if (destroyed) {
          return
        }

        destroyed = true
        view.setVisible(false)

        for (const popupWindow of popupWindows) {
          if (!popupWindow.isDestroyed()) {
            popupWindow.destroy()
          }
        }
        popupWindows.clear()

        if (attached && !hostWindow.isDestroyed()) {
          hostWindow.contentView.removeChildView(view)
          attached = false
        }

        if (!view.webContents.isDestroyed()) {
          // Session storage lives in the persistent partition, so closing the
          // WebContents immediately does not discard the game's authenticated state.
          view.webContents.close({ waitForBeforeUnload: false })
        }
      },

      focus(): void {
        if (!destroyed && !parked && view.getVisible() && !view.webContents.isDestroyed()) {
          view.webContents.focus()
        }
      },

      loadURL(url): Promise<void> {
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
          currentBounds = { ...bounds }
          applyBounds()
        }
      },

      setEcoMode(enabled): void {
        if (!view.webContents.isDestroyed()) {
          ecoModeEnabled = enabled
          applyBackgroundThrottling()
        }
      },

      setMuted(muted): void {
        if (!view.webContents.isDestroyed()) {
          view.webContents.setAudioMuted(muted)
        }
      },

      setVisible(visible): void {
        if (!destroyed) {
          // Keep the WebContents and persistent partition alive while hiding
          // its pixels when another account is displayed.
          parked = !visible
          applyBounds()
          view.setVisible(visible)
          applyBackgroundThrottling()
        }
      },

      setZoomFactor(factor): void {
        if (!view.webContents.isDestroyed()) {
          view.webContents.setZoomFactor(factor)
        }
      },
    }
  }
}
