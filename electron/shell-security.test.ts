import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>(
    async () => undefined,
  ),
}))

vi.mock('electron', () => ({
  shell: {
    openExternal: electronMocks.openExternal,
  },
}))

import { configureShellSecurity } from './shell-security.js'

type Headers = Record<string, string[]>
type HeadersHandler = (
  details: {
    resourceType: string
    responseHeaders?: Headers
    url: string
  },
  callback: (response: { responseHeaders?: Headers }) => void,
) => void
type NavigationHandler = (
  event: { preventDefault(): void },
  url: string,
) => void
type WebviewHandler = (event: { preventDefault(): void }) => void
type WindowOpenHandler = (details: { url: string }) => { action: string }

function createHarness() {
  let headersHandler: HeadersHandler | null = null
  let navigationHandler: NavigationHandler | null = null
  let permissionCheckHandler: (() => boolean) | null = null
  let permissionRequestHandler:
    | ((callback: (allowed: boolean) => void) => void)
    | null = null
  let devicePermissionHandler: (() => boolean) | null = null
  let webviewHandler: WebviewHandler | null = null
  let windowOpenHandler: WindowOpenHandler | null = null

  const session = {
    setDevicePermissionHandler: vi.fn((handler: () => boolean) => {
      devicePermissionHandler = handler
    }),
    setPermissionCheckHandler: vi.fn((handler: () => boolean) => {
      permissionCheckHandler = handler
    }),
    setPermissionRequestHandler: vi.fn((
      handler: (
        webContents: unknown,
        permission: string,
        callback: (allowed: boolean) => void,
      ) => void,
    ) => {
      permissionRequestHandler = (callback) => {
        handler(null, 'camera', callback)
      }
    }),
    webRequest: {
      onHeadersReceived: vi.fn((handler: HeadersHandler) => {
        headersHandler = handler
      }),
    },
  }
  const webContents = {
    on: vi.fn((event: string, handler: NavigationHandler | WebviewHandler) => {
      if (event === 'will-navigate') {
        navigationHandler = handler as NavigationHandler
      } else if (event === 'will-attach-webview') {
        webviewHandler = handler as WebviewHandler
      }
    }),
    session,
    setWindowOpenHandler: vi.fn((handler: WindowOpenHandler) => {
      windowOpenHandler = handler
    }),
  }
  const browserWindow = { webContents } as unknown as BrowserWindow

  configureShellSecurity(browserWindow, 'altgrid://app/')

  return {
    devicePermissionHandler: () => devicePermissionHandler,
    headersHandler: () => headersHandler,
    navigationHandler: () => navigationHandler,
    permissionCheckHandler: () => permissionCheckHandler,
    permissionRequestHandler: () => permissionRequestHandler,
    session,
    webviewHandler: () => webviewHandler,
    windowOpenHandler: () => windowOpenHandler,
  }
}

describe('configureShellSecurity', () => {
  beforeEach(() => {
    electronMocks.openExternal.mockClear()
  })

  it('denies shell permissions and device access by default', () => {
    const harness = createHarness()
    const permissionResult = vi.fn()

    expect(harness.permissionCheckHandler()?.()).toBe(false)
    expect(harness.devicePermissionHandler()?.()).toBe(false)
    harness.permissionRequestHandler()?.(permissionResult)
    expect(permissionResult).toHaveBeenCalledWith(false)
  })

  it('adds the restrictive CSP only to the trusted main document', () => {
    const harness = createHarness()
    const trustedResult = vi.fn()
    const passthroughResult = vi.fn()

    harness.headersHandler()?.(
      {
        resourceType: 'mainFrame',
        responseHeaders: { 'X-Frame-Options': ['DENY'] },
        url: 'altgrid://app/admin?tab=games',
      },
      trustedResult,
    )
    harness.headersHandler()?.(
      {
        resourceType: 'script',
        responseHeaders: { ETag: ['test'] },
        url: 'altgrid://app/assets/app.js',
      },
      passthroughResult,
    )

    expect(trustedResult).toHaveBeenCalledWith({
      responseHeaders: expect.objectContaining({
        'Content-Security-Policy': [expect.stringContaining("object-src 'none'")],
        'X-Frame-Options': ['DENY'],
      }),
    })
    expect(trustedResult.mock.calls[0]?.[0].responseHeaders[
      'Content-Security-Policy'
    ]?.[0]).toContain("frame-ancestors 'none'")
    expect(passthroughResult).toHaveBeenCalledWith({
      responseHeaders: { ETag: ['test'] },
    })
  })

  it('denies popups and opens only credential-free HTTPS externally', () => {
    const harness = createHarness()

    expect(harness.windowOpenHandler()?.({
      url: 'https://altgrid.example/plans',
    })).toEqual({ action: 'deny' })
    expect(harness.windowOpenHandler()?.({
      url: 'javascript:alert(1)',
    })).toEqual({ action: 'deny' })

    expect(electronMocks.openExternal).toHaveBeenCalledOnce()
    expect(electronMocks.openExternal).toHaveBeenCalledWith(
      'https://altgrid.example/plans',
    )
  })

  it('keeps trusted navigation internal and blocks unsafe or external destinations', () => {
    const harness = createHarness()
    const trustedEvent = { preventDefault: vi.fn() }
    const externalEvent = { preventDefault: vi.fn() }
    const unsafeEvent = { preventDefault: vi.fn() }
    const webviewEvent = { preventDefault: vi.fn() }

    harness.navigationHandler()?.(trustedEvent, 'altgrid://app/settings')
    harness.navigationHandler()?.(
      externalEvent,
      'https://support.altgrid.example/help',
    )
    harness.navigationHandler()?.(unsafeEvent, 'file:///C:/private.txt')
    harness.webviewHandler()?.(webviewEvent)

    expect(trustedEvent.preventDefault).not.toHaveBeenCalled()
    expect(externalEvent.preventDefault).toHaveBeenCalledOnce()
    expect(unsafeEvent.preventDefault).toHaveBeenCalledOnce()
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce()
    expect(electronMocks.openExternal).toHaveBeenCalledOnce()
    expect(electronMocks.openExternal).toHaveBeenCalledWith(
      'https://support.altgrid.example/help',
    )
  })
})
