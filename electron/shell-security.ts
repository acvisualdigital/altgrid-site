import { shell, type BrowserWindow, type Session } from 'electron'

import { isSafeExternalUrl, isTrustedShellUrl } from './url-policy.js'

const SHELL_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*",
].join('; ')

function denyPermissions(sessionInstance: Session): void {
  sessionInstance.setPermissionCheckHandler(() => false)
  sessionInstance.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  sessionInstance.setDevicePermissionHandler(() => false)
}

export function configureShellSecurity(
  browserWindow: BrowserWindow,
  shellEntryUrl: string,
): void {
  const shellSession = browserWindow.webContents.session
  denyPermissions(shellSession)

  shellSession.webRequest.onHeadersReceived((details, callback) => {
    if (
      details.resourceType !== 'mainFrame'
      || !isTrustedShellUrl(details.url, shellEntryUrl)
    ) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [SHELL_CSP],
      },
    })
  })

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url).catch(() => undefined)
    }

    return { action: 'deny' }
  })
  browserWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
  browserWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedShellUrl(url, shellEntryUrl)) {
      event.preventDefault()

      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url).catch(() => undefined)
      }
    }
  })
}
