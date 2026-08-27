import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthApp, compareVersions, passwordRecoveryRedirectUrl } from './app'
import {
  AuthService,
  AuthServiceError,
  type AuthStateListener,
} from './services/auth-service'
import { BackendApiError } from './services/backend-api'
import { ChatService } from './services/chat-service'
import {
  CUSTOM_GAME_SLUG,
  ConfiguredAccountService,
  type ConfiguredAccount,
} from './services/configured-account-service'
import type { GridLayout } from './services/grid-layout-service'
import { PermissionService } from './services/permission-service'
import {
  SessionSurfaceManager,
  type SessionSurfaceElementFactory,
} from './services/session-surface-manager'
import type { ChatChannel, PublicGame } from './types/backend-api'

const user = {
  aud: 'authenticated',
  created_at: '2026-08-25T12:00:00.000Z',
  email: 'hunter@example.com',
  id: '00000000-0000-4000-8000-000000000001',
  identities: [{ id: 'email-identity' }],
  role: 'authenticated',
} as User

const session = {
  access_token: 'test-access-token',
  expires_in: 3600,
  refresh_token: 'test-refresh-token',
  token_type: 'bearer',
  user,
} as Session

describe('password recovery redirect', () => {
  it('uses the registered desktop protocol in packaged AltGrid', () => {
    expect(passwordRecoveryRedirectUrl({
      origin: 'null',
      protocol: 'altgrid:',
    })).toBe('altgrid://app/?auth=recovery')
  })

  it('keeps the browser origin during local/web development', () => {
    expect(passwordRecoveryRedirectUrl({
      origin: 'http://127.0.0.1:3000',
      protocol: 'http:',
    })).toBe('http://127.0.0.1:3000/?auth=recovery')
  })
})

describe('version comparison', () => {
  it('orders beta builds by their prerelease identifiers', () => {
    expect(compareVersions('0.9.0-beta.1', '0.9.0-beta.2')).toBe(-1)
    expect(compareVersions('0.9.0-beta.10', '0.9.0-beta.2')).toBe(1)
    expect(compareVersions('v0.9.0-beta.2', '0.9.0-beta.2')).toBe(0)
  })

  it('orders prereleases before the corresponding stable release', () => {
    expect(compareVersions('0.9.0-beta.2', '0.9.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
  })

  it('ignores build metadata and rejects malformed versions', () => {
    expect(compareVersions('1.0.0-beta.1+desktop', '1.0.0-beta.1+worker')).toBe(0)
    expect(compareVersions('beta.1', '1.0.0')).toBeNull()
  })
})

describe('update dialog', () => {
  it('shows the real unsupported reason instead of claiming the app is current', () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    const app = new AuthApp(root, auth.service)
    const state = app as unknown as {
      activeDialog: 'update'
      render(): void
      updateState: {
        message: string
        status: 'not_available'
        supported: false
      }
    }

    state.activeDialog = 'update'
    state.updateState = {
      message: 'A versão Portátil não pode se atualizar sozinha.',
      status: 'not_available',
      supported: false,
    }
    state.render()

    expect(root.innerHTML).toContain('A versão Portátil não pode se atualizar sozinha.')
    expect(root.innerHTML).not.toContain('Você já está usando a versão mais recente.')
  })
})

function createRoot(): HTMLElement {
  return {
    innerHTML: '',
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  } as unknown as HTMLElement
}

class AcceptanceClassList {
  private readonly values = new Set<string>()

  add(...tokens: string[]): void {
    tokens.forEach((token) => this.values.add(token))
  }

  contains(token: string): boolean {
    return this.values.has(token)
  }

  toggle(token: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(token)

    if (enabled) {
      this.values.add(token)
    } else {
      this.values.delete(token)
    }

    return enabled
  }
}

class AcceptanceElement {
  readonly attributes = new Map<string, string>()
  readonly children: AcceptanceElement[] = []
  readonly classList = new AcceptanceClassList()
  readonly dataset: Record<string, string | undefined> = {}
  readonly styles = new Map<string, string>()
  readonly style = {
    setProperty: (name: string, value: string) => {
      this.styles.set(name, value)
    },
  }
  disabled = false
  isConnected = true
  parent: AcceptanceElement | null = null
  textContent: string | null = ''
  bounds = { height: 720, width: 1280, x: 0, y: 0 }
  private readonly listeners = new Map<string, Array<() => void>>()
  private readonly queries = new Map<string, AcceptanceElement>()
  private readonly queryLists = new Map<string, AcceptanceElement[]>()

  get parentElement(): AcceptanceElement | null {
    return this.parent
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  append(...nodes: AcceptanceElement[]): void {
    nodes.forEach((node) => {
      node.remove()
      node.parent = this
      this.children.push(node)
    })
  }

  click(): void {
    this.listeners.get('click')?.forEach((listener) => listener())
  }

  closest(): null {
    return null
  }

  contains(node: AcceptanceElement): boolean {
    return node === this || this.children.some((child) => child.contains(node))
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  getBoundingClientRect(): DOMRect {
    const { height, width, x, y } = this.bounds
    return {
      bottom: y + height,
      height,
      left: x,
      right: x + width,
      toJSON: () => ({}),
      top: y,
      width,
      x,
      y,
    }
  }

  querySelector(selector: string): AcceptanceElement | null {
    return this.queries.get(selector) ?? null
  }

  querySelectorAll(selector: string): AcceptanceElement[] {
    return this.queryLists.get(selector) ?? []
  }

  remove(): void {
    if (!this.parent) {
      return
    }

    const index = this.parent.children.indexOf(this)
    if (index >= 0) {
      this.parent.children.splice(index, 1)
    }
    this.parent = null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  setQuery(selector: string, element: AcceptanceElement): void {
    this.queries.set(selector, element)
  }

  setQueryAll(selector: string, elements: AcceptanceElement[]): void {
    this.queryLists.set(selector, elements)
  }

  toggleAttribute(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.attributes.has(name)

    if (enabled) {
      this.attributes.set(name, '')
    } else {
      this.attributes.delete(name)
    }

    return enabled
  }
}

function asHtmlElement(element: AcceptanceElement): HTMLElement {
  return element as unknown as HTMLElement
}

function installBrowser(href: string, startsOnline = true) {
  let online = startsOnline
  const listeners = new Map<string, () => void>()
  const url = new URL(href)
  const navigatorStub = {}

  Object.defineProperty(navigatorStub, 'onLine', {
    configurable: true,
    get: () => online,
  })

  vi.stubGlobal('navigator', navigatorStub)
  vi.stubGlobal('window', {
    addEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.set(type, listener)
    }),
    history: { replaceState: vi.fn() },
    location: {
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
    },
    matchMedia: vi.fn(() => ({ matches: false })),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type)
    }),
  })

  return {
    setOnline(value: boolean): void {
      online = value
      listeners.get(value ? 'online' : 'offline')?.()
    },
  }
}

function createAuthServiceDouble() {
  let listener: AuthStateListener | null = null
  const unsubscribe = vi.fn()
  const methods = {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn((nextListener: AuthStateListener) => {
      listener = nextListener
      return unsubscribe
    }),
    signOut: vi.fn(),
    updatePassword: vi.fn(),
  }

  return {
    emit(event: AuthChangeEvent, nextSession: Session | null): void {
      listener?.(event, nextSession)
    },
    getSession: methods.getSession,
    service: methods as unknown as AuthService,
    signOut: methods.signOut,
    unsubscribe,
    updatePassword: methods.updatePassword,
  }
}

function currentView(app: AuthApp): string {
  return (app as unknown as { currentView: string }).currentView
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthApp session lifecycle', () => {
  it('keeps the in-app updater accessible before login', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(null)
    const app = new AuthApp(root, auth.service)

    await app.start()

    expect(currentView(app)).toBe('login')
    expect(root.innerHTML).toContain('data-open-update')
    app.destroy()
  })

  it('keeps Chat and notifications in the workspace header without duplicate settings', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const chat = new ChatService({
      getChatChannels: vi.fn().mockResolvedValue({ channels: [] }),
      getChatMessages: vi.fn().mockResolvedValue({
        messages: [],
        pagination: { has_more: false, next_before: null },
      }),
      getChatStatus: vi.fn().mockResolvedValue({
        status: { banned: false, muted_until: null, reason: null },
      }),
      reportChatMessage: vi.fn(),
      sendChatMessage: vi.fn(),
    }, null, null)
    const app = new AuthApp(root, auth.service, { chatService: chat })

    await app.start()

    await vi.waitFor(() => {
      expect(root.innerHTML.match(/data-open-chat/g)).toHaveLength(1)
      expect(root.innerHTML).toContain('header-chat-button')
      expect(root.innerHTML).toContain('header-utility-actions')
      expect(root.innerHTML.indexOf('data-open-chat')).toBeLessThan(
        root.innerHTML.indexOf('notification-menu'),
      )
      expect(root.innerHTML.indexOf('notification-menu')).toBeLessThan(
        root.innerHTML.indexOf('data-open-dialog="settings"'),
      )
      expect(root.innerHTML).not.toContain('chat-fab')
    })
    app.destroy()
  })

  it('shows remote game artwork in chat and a dedicated Global icon', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const channels = [
      { game_id: null, id: 'global-channel', name: 'Global', type: 'global' as const },
      { game_id: 'game-huntera', id: 'huntera-channel', name: 'Huntera', type: 'game' as const },
    ]
    const getChatMessages = vi.fn(async (channelId: string) => ({
      messages: [{
        channel_id: channelId,
        created_at: '2026-08-27T00:00:00.000Z',
        display_name: 'Caco',
        edited_at: null,
        founder_number: null,
        id: `message-${channelId}`,
        message: 'Olá, AltGrid!',
        plan: 'FREE' as const,
        user_id: 'another-user',
      }],
      pagination: { has_more: false, next_before: null },
    }))
    const chat = new ChatService({
      getChatChannels: vi.fn().mockResolvedValue({ channels }),
      getChatMessages,
      getChatStatus: vi.fn().mockResolvedValue({
        status: { banned: false, muted_until: null, reason: null },
      }),
      reportChatMessage: vi.fn(),
      sendChatMessage: vi.fn(),
    }, null, null)
    const app = new AuthApp(root, auth.service, { chatService: chat })
    const harness = app as unknown as {
      games: PublicGame[]
      render(): void
      renderChatChannelIcon(channel: ChatChannel | undefined): string
    }

    await app.start()
    harness.games = [{
      developer_referral_url: null,
      icon_url: 'https://cdn.example.com/huntera.png',
      id: 'game-huntera',
      launch_url: 'https://huntera.example.com/game',
      metadata: {},
      name: 'Huntera',
      slug: 'huntera',
      sort_order: 1,
    }]
    harness.render()
    await chat.open('game-huntera')

    await vi.waitFor(() => {
      expect(root.innerHTML).toContain('data-chat-channel-type="global"')
      expect(root.innerHTML).toContain('data-chat-channel-type="game"')
      expect(root.innerHTML).toContain('chat-panel__game-icon')
      expect(root.innerHTML).toContain('chat-message__avatar')
      expect(root.innerHTML).toContain('src="https://cdn.example.com/huntera.png"')
      expect(harness.renderChatChannelIcon(channels[1])).toContain(
        'src="https://cdn.example.com/huntera.png"',
      )
    })

    harness.games.push({
      developer_referral_url: null,
      icon_url: 'javascript:alert(1)',
      id: 'game-dangerous',
      launch_url: 'https://safe.example.com/game',
      metadata: {},
      name: 'Dangerous',
      slug: 'dangerous',
      sort_order: 2,
    })
    const unsafeIcon = harness.renderChatChannelIcon({
      game_id: 'game-dangerous',
      id: 'dangerous-channel',
      name: 'Dangerous',
      type: 'game',
    })
    expect(unsafeIcon).not.toContain('<img')
    expect(unsafeIcon).toContain('DA')
    expect(harness.renderChatChannelIcon({
      game_id: 'missing-game',
      id: 'missing-channel',
      name: 'Desconhecido',
      type: 'game',
    })).toContain('<path')

    await chat.selectChannel('global-channel')
    await vi.waitFor(() => {
      expect(root.innerHTML).toContain('<circle cx="12" cy="12" r="9"')
      expect(root.innerHTML).toContain('data-chat-message-channel="global-channel"')
    })

    app.destroy()
  })

  it('links the profile menu to the protected administrative route', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const app = new AuthApp(root, auth.service)

    await app.start()

    await vi.waitFor(() => {
      expect(root.innerHTML).toContain('Painel administrativo')
      expect(root.innerHTML).toContain('href="/admin"')
      expect(root.innerHTML).not.toContain('data-grant-admin')
    })
    app.destroy()
  })

  it('keeps configured accounts in the header while rendering only open sessions', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const accounts = new ConfiguredAccountService({
      createId: (() => {
        let nextId = 0
        return () => `header-account-${++nextId}`
      })(),
      storage: null,
    })
    const configured = ['Conta A', 'Conta B', 'Conta C'].map((displayName) =>
      accounts.add(user.id, { displayName, gameSlug: 'huntera' }))
    const permissions = new PermissionService()
    const chat = new ChatService({
      getChatChannels: vi.fn().mockResolvedValue({ channels: [] }),
      getChatMessages: vi.fn().mockResolvedValue({
        messages: [],
        pagination: { has_more: false, next_before: null },
      }),
      getChatStatus: vi.fn().mockResolvedValue({
        status: { banned: false, muted_until: null, reason: null },
      }),
      reportChatMessage: vi.fn(),
      sendChatMessage: vi.fn(),
    }, null, null)
    const app = new AuthApp(root, auth.service, {
      accountService: accounts,
      chatService: chat,
      permissionService: permissions,
    })

    await app.start()
    await permissions.openSession(configured[0]!.id, () => undefined)
    ;(app as unknown as { render(): void }).render()

    expect(root.innerHTML.match(/data-account-tab\b/g)).toHaveLength(3)
    configured.forEach((account) => {
      expect(root.innerHTML).toContain(`data-account-id="${account.id}"`)
    })
    expect(root.innerHTML.match(/data-session-card\b/g)).toHaveLength(1)
    expect(root.innerHTML).toContain('data-toggle-grid')
    expect(root.innerHTML).toContain('data-toggle-screens-only')
    expect(root.innerHTML.match(/data-open-chat\b/g)).toHaveLength(1)
    expect(root.innerHTML).not.toContain('data-plan-indicator')
    expect(root.innerHTML).not.toContain('profile-header-menu')
    expect(root.innerHTML).toContain('sidebar-profile-menu')
    expect(root.innerHTML).toContain('1 aberta · Huntera 3 / demais 2')
    expect(root.innerHTML.match(/id="logout-button"/g)).toHaveLength(1)
    expect(root.innerHTML).not.toContain('chat-fab')

    app.destroy()
  })

  it('preserves the receiver of a stateful desktop session launcher', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(null)

    class StatefulLauncher {
      readonly calls: string[] = []

      open(): void {
        this.calls.push('open')
      }

      registerEscapeHandler(): () => void {
        this.calls.push('escape')
        return () => undefined
      }

      registerStatusHandler(): () => void {
        this.calls.push('status')
        return () => undefined
      }
    }

    const launcher = new StatefulLauncher()
    const app = new AuthApp(root, auth.service, {
      sessionLauncher: launcher,
    })

    await expect(app.start()).resolves.toBeUndefined()
    await (app as unknown as {
      sessionLauncher: {
        open(account: ConfiguredAccount, target: null): Promise<void> | void
      }
    }).sessionLauncher.open({
      createdAt: '2026-08-25T12:00:00.000Z',
      displayName: 'Conta Huntera',
      gameSlug: 'huntera',
      id: 'account-huntera',
    }, null)

    expect(launcher.calls).toEqual(['escape', 'status', 'open'])
    app.destroy()
  })

  it('does not authorize password recovery from the query marker alone', async () => {
    installBrowser('https://app.example.com/?auth=recovery')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const app = new AuthApp(root, auth.service)

    await app.start()

    expect(currentView(app)).toBe('authenticated')
    expect(root.innerHTML).not.toContain('id="reset-form"')
    expect(auth.updatePassword).not.toHaveBeenCalled()

    auth.emit('PASSWORD_RECOVERY', session)
    await Promise.resolve()

    expect(currentView(app)).toBe('reset')
    expect(root.innerHTML).toContain('id="reset-form"')
    app.destroy()
  })

  it('does not overwrite an auth event received while getSession is pending', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    const pendingSession = deferred<Session | null>()
    auth.getSession.mockReturnValue(pendingSession.promise)
    const app = new AuthApp(root, auth.service)

    const starting = app.start()
    auth.emit('SIGNED_IN', session)
    await Promise.resolve()
    pendingSession.resolve(null)
    await starting

    expect(currentView(app)).toBe('authenticated')
    expect(root.innerHTML).toContain('Minhas contas')
    app.destroy()
  })

  it('keeps checking after an offline session failure and retries on reconnect', async () => {
    const browser = installBrowser('https://app.example.com/', false)
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession
      .mockRejectedValueOnce(new AuthServiceError('offline'))
      .mockResolvedValueOnce(session)
    const app = new AuthApp(root, auth.service)

    await app.start()

    expect(currentView(app)).toBe('checking')
    expect(root.innerHTML).toContain('Verificando sua sessão')
    expect(root.innerHTML).not.toContain('id="login-form"')

    browser.setOnline(true)

    await vi.waitFor(() => {
      expect(auth.getSession).toHaveBeenCalledTimes(2)
      expect(currentView(app)).toBe('authenticated')
    })
    expect(root.innerHTML).toContain('Minhas contas')
    app.destroy()
  })

  it('shows a friendly retry state when the session endpoint is unreachable online', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockRejectedValue(new AuthServiceError('connection_failed'))
    const app = new AuthApp(root, auth.service)

    await app.start()

    expect(currentView(app)).toBe('checking')
    expect(root.innerHTML).toContain(
      'Não foi possível conectar. Tente novamente em instantes.',
    )
    expect(root.innerHTML).toContain('data-retry-session')
    expect(root.innerHTML).not.toContain('id="login-form"')
    app.destroy()
  })

  it('loads startup health, config, me, entitlements and games once after login', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const entitlements = {
      account_limit: 10,
      expires_at: null,
      features: { advanced_grids: true },
      founder_number: null,
      lifetime: false,
      plan: 'PRO' as const,
    }
    const backend = {
      getAppConfig: vi.fn().mockResolvedValue({
        config: {
          latest_version: '2.0.0',
          maintenance: false,
          minimum_version: '2.0.0',
        },
      }),
      getEntitlements: vi.fn().mockResolvedValue(entitlements),
      getGames: vi.fn().mockResolvedValue({ games: [] }),
      getHealth: vi.fn().mockResolvedValue({
        ok: true,
        service: 'altgrid-api',
      }),
      getMe: vi.fn().mockResolvedValue({
        ...entitlements,
        license: null,
        profile: {
          created_at: '2026-08-25T12:00:00.000Z',
          display_name: null,
          id: user.id,
          referral_code: 'HUNT-ABCD2345',
          updated_at: '2026-08-25T12:00:00.000Z',
        },
        user: {
          created_at: user.created_at,
          email: user.email,
          email_confirmed_at: null,
          id: user.id,
          last_sign_in_at: null,
        },
      }),
    }
    const app = new AuthApp(root, auth.service, { backendApi: backend })

    await app.start()

    await vi.waitFor(() => {
      expect(backend.getMe).toHaveBeenCalledOnce()
      expect(backend.getEntitlements).toHaveBeenCalledOnce()
      expect(backend.getGames).toHaveBeenCalledOnce()
      expect(backend.getHealth).toHaveBeenCalledOnce()
      expect(backend.getAppConfig).toHaveBeenCalledOnce()
      expect(root.innerHTML).toContain('sidebar-profile-popover__plan')
      expect(root.innerHTML).toContain('<strong>PRO</strong>')
      expect(root.innerHTML).toContain('0/10 sessões abertas')
      expect(root.innerHTML).not.toContain('data-grid-locked="true"')
    })
    app.destroy()
  })

  it('shows server maintenance and minimum-version policy without blocking the shell', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const free = {
      account_limit: 2,
      expires_at: null,
      features: {},
      founder_number: null,
      lifetime: false,
      plan: 'FREE' as const,
    }
    const backend = {
      getAppConfig: vi.fn().mockResolvedValue({
        config: {
          latest_version: '99.0.0',
          maintenance: true,
          minimum_version: '99.0.0',
        },
      }),
      getEntitlements: vi.fn().mockResolvedValue(free),
      getGames: vi.fn().mockResolvedValue({ games: [] }),
      getHealth: vi.fn().mockResolvedValue({
        ok: true,
        service: 'altgrid-api',
      }),
      getMe: vi.fn().mockResolvedValue({
        ...free,
        license: null,
        profile: {
          created_at: user.created_at,
          display_name: null,
          id: user.id,
          referral_code: 'HUNT-ABCD2345',
          updated_at: user.created_at,
        },
        user: {
          created_at: user.created_at,
          email: user.email,
          email_confirmed_at: null,
          id: user.id,
          last_sign_in_at: null,
        },
      }),
    }
    const app = new AuthApp(root, auth.service, { backendApi: backend })

    await app.start()

    await vi.waitFor(() => {
      expect(root.innerHTML).toContain('Serviços em manutenção')
      expect(root.innerHTML).toContain(
        'Atualização necessária: instale a versão 99.0.0 ou superior.',
      )
      expect(currentView(app)).toBe('authenticated')
      expect((app as unknown as { serviceStatus: string }).serviceStatus)
        .toBe('online')
    })
    app.destroy()
  })

  it('keeps launch, referral, and custom URLs in their distinct flows', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    const openExternalUrl = vi.fn()
    const app = new AuthApp(root, auth.service, { openExternalUrl })
    const huntera = {
      developer_referral_url: 'https://accounts.example.com/huntera-ref',
      icon_url: 'https://cdn.example.com/huntera.png',
      id: 'game-huntera',
      launch_url: 'https://play.example.com/huntera',
      metadata: { region: 'br' },
      name: 'Huntera',
      slug: 'huntera',
      sort_order: 1,
    }
    const gameWithoutReferral = {
      ...huntera,
      developer_referral_url: null,
      icon_url: null,
      id: 'game-two',
      launch_url: 'https://play.example.com/game-two',
      name: 'Jogo 2',
      slug: 'game-two',
      sort_order: 2,
    }
    const presetAccount: ConfiguredAccount = {
      createdAt: '2026-08-25T12:00:00.000Z',
      displayName: 'Conta Huntera',
      gameSlug: 'huntera',
      id: 'account-huntera',
    }
    const customAccount: ConfiguredAccount = {
      createdAt: '2026-08-25T12:00:00.000Z',
      customLaunchUrl: 'https://custom.example.com/play',
      displayName: 'Conta custom',
      gameSlug: CUSTOM_GAME_SLUG,
      id: 'account-custom',
    }
    const harness = app as unknown as {
      activeDialog: 'add-account'
      games: Array<typeof huntera | typeof gameWithoutReferral>
      openDeveloperReferral(
        slug: string,
        button: HTMLButtonElement,
      ): Promise<void>
      renderDialog(): string
      resolveSessionLaunchTarget(
        account: ConfiguredAccount,
      ): {
        kind: 'custom' | 'preset'
        launchUrl: string
      } | null
    }
    harness.activeDialog = 'add-account'
    harness.games = [huntera, gameWithoutReferral]

    const dialog = harness.renderDialog()
    expect(dialog).toContain('Escolha um jogo')
    expect(dialog).toContain('Huntera')
    expect(dialog).toContain('Jogo 2')
    expect(dialog).toContain('URL personalizada')
    expect(dialog.match(/Ainda não possui conta\?/g)).toHaveLength(1)
    expect(dialog).toContain('Link de indicação do desenvolvedor')
    expect(dialog).not.toContain(huntera.developer_referral_url)

    expect(harness.resolveSessionLaunchTarget(presetAccount)).toMatchObject({
      kind: 'preset',
      launchUrl: huntera.launch_url,
    })
    expect(harness.resolveSessionLaunchTarget(customAccount)).toEqual({
      game: null,
      kind: 'custom',
      launchUrl: 'https://custom.example.com/play',
    })
    expect(harness.resolveSessionLaunchTarget({
      ...customAccount,
      customLaunchUrl: 'javascript:alert(1)',
    })).toBeNull()

    await harness.openDeveloperReferral(
      huntera.slug,
      { disabled: false, isConnected: true } as HTMLButtonElement,
    )
    expect(openExternalUrl).toHaveBeenCalledOnce()
    expect(openExternalUrl).toHaveBeenCalledWith(
      huntera.developer_referral_url,
    )
  })

  it('stops loading and keeps a retryable authenticated UI when the API is offline', async () => {
    installBrowser('https://app.example.com/', false)
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const offline = new BackendApiError(
      'offline',
      'Sem conexão. Suas contas continuam salvas.',
      0,
    )
    const backend = {
      getEntitlements: vi.fn().mockRejectedValue(offline),
      getGames: vi.fn().mockRejectedValue(offline),
      getMe: vi.fn().mockRejectedValue(offline),
    }
    const accounts = new ConfiguredAccountService({
      createId: () => 'offline-account',
      storage: null,
    })
    accounts.add(user.id, {
      displayName: 'Conta preservada',
      gameSlug: 'huntera',
    })
    const app = new AuthApp(root, auth.service, {
      accountService: accounts,
      backendApi: backend,
    })

    await app.start()

    await vi.waitFor(() => {
      expect(root.innerHTML).toContain(
        'Sem conexão. Suas contas continuam salvas.',
      )
      expect(root.innerHTML).toContain('data-retry-backend')
      expect(root.innerHTML).not.toContain('Carregando plano e jogos')
      expect(currentView(app)).toBe('authenticated')
      expect(root.innerHTML).toContain('Conta preservada')
    })
    app.destroy()
  })

  it('opens three Huntera sessions on FREE, blocks the fourth, shows plan details, and closes active sessions on sign-out', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const accounts = new ConfiguredAccountService({
      createId: (() => {
        let id = 0
        return () => 'account-' + ++id
      })(),
      storage: null,
    })
    const configured = ['Conta 1', 'Conta 2', 'Conta 3', 'Conta 4'].map((displayName) =>
      accounts.add(user.id, { displayName, gameSlug: 'huntera' }))
    const free = {
      account_limit: 2,
      expires_at: null,
      features: {},
      founder_number: null,
      lifetime: false,
      plan: 'FREE' as const,
    }
    const backend = {
      getEntitlements: vi.fn().mockResolvedValue(free),
      getGames: vi.fn().mockResolvedValue({
        games: [{
          developer_referral_url: null,
          icon_url: null,
          id: '00000000-0000-4000-8000-000000000010',
          launch_url: 'https://game.example.com',
          metadata: {},
          name: 'Huntera',
          slug: 'huntera',
          sort_order: 1,
        }],
      }),
      getMe: vi.fn().mockResolvedValue({
        ...free,
        license: null,
        profile: {
          created_at: '2026-08-25T12:00:00.000Z',
          display_name: null,
          id: user.id,
          referral_code: 'HUNT-ABCD2345',
          updated_at: '2026-08-25T12:00:00.000Z',
        },
        user: {
          created_at: user.created_at,
          email: user.email,
          email_confirmed_at: null,
          id: user.id,
          last_sign_in_at: null,
        },
      }),
    }
    const permissions = new PermissionService(free)
    const launcher = {
      close: vi.fn(),
      open: vi.fn(),
    }
    const app = new AuthApp(root, auth.service, {
      accountService: accounts,
      backendApi: backend,
      permissionService: permissions,
      sessionLauncher: launcher,
    })
    const harness = app as unknown as {
      activeDialog: 'free-limit' | 'plans' | null
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
      render(): void
      workspaceMode: 'account' | 'grid'
    }

    await app.start()
    await vi.waitFor(() => expect(root.innerHTML).toContain('Conta 4'))
    harness.workspaceMode = 'grid'
    harness.render()
    expect(root.innerHTML.match(/data-grid-locked="true"/g)).toHaveLength(2)

    const button = () => ({
      disabled: false,
      textContent: 'Abrir',
    }) as HTMLButtonElement

    await harness.openConfiguredAccount(configured[0]!.id, button())
    await harness.openConfiguredAccount(configured[1]!.id, button())
    await harness.openConfiguredAccount(configured[2]!.id, button())
    await harness.openConfiguredAccount(configured[3]!.id, button())

    expect(launcher.open).toHaveBeenCalledTimes(3)
    expect(permissions.getActiveSessionCount()).toBe(3)
    expect(root.innerHTML).toContain('3 abertas · Huntera 3 / demais 2')
    expect(root.innerHTML).toContain('Limite da versão gratuita')
    expect(root.innerHTML).toContain(
      'O plano FREE permite até 3 contas simultâneas ao abrir Huntera.',
    )
    expect(root.innerHTML).toContain(
      'Suas contas e configurações continuam salvas.',
    )
    expect(root.innerHTML).toContain('Conhecer PRO')
    expect(root.innerHTML).toContain('Agora não')

    harness.activeDialog = 'plans'
    harness.render()
    expect(root.innerHTML).toContain('Planos AltGrid')
    expect(root.innerHTML).toContain('FREE')
    expect(root.innerHTML).toContain('Huntera: 3 · demais jogos: 2')
    expect(root.innerHTML).toContain('PRO')
    expect(root.innerHTML).toContain('Até o limite configurado')
    expect(root.innerHTML).toContain('FOUNDER')
    expect(root.innerHTML).toContain('Benefícios especiais')
    expect(root.innerHTML).not.toContain('checkout')
    expect(root.innerHTML).not.toContain('Pix')

    auth.emit('SIGNED_OUT', null)
    await vi.waitFor(() => expect(launcher.close).toHaveBeenCalledTimes(3))
    expect(permissions.getActiveSessionCount()).toBe(0)
    app.destroy()
  })

  it('hides native game views behind the FREE limit dialog and restores them with ESC', async () => {
    installBrowser('https://app.example.com/')

    const frame = new AcceptanceElement()
    const shell = new AcceptanceElement()
    const workspace = new AcceptanceElement()
    const grid = new AcceptanceElement()
    const rootElement = new AcceptanceElement()
    workspace.bounds = { height: 680, width: 1260, x: 10, y: 10 }
    rootElement.setQuery('.app-frame', frame)
    rootElement.setQuery('[data-authenticated-shell]', shell)
    rootElement.setQueryAll('button[data-grid-mode]', [])
    shell.setQuery('[data-session-workspace]', workspace)
    shell.setQuery('[data-session-grid]', grid)

    const manager = new SessionSurfaceManager(asHtmlElement(grid), {
      createCard: () => asHtmlElement(new AcceptanceElement()),
      createSurface: (accountId) => {
        const surface = new AcceptanceElement()
        surface.bounds = {
          height: 680,
          width: 620,
          x: accountId.endsWith('1') ? 10 : 640,
          y: 10,
        }
        return asHtmlElement(surface)
      },
    })
    const accounts = new ConfiguredAccountService({
      createId: (() => {
        let nextId = 0
        return () => `dialog-account-${++nextId}`
      })(),
      storage: null,
    })
    const configured = ['Conta 1', 'Conta 2'].map((displayName) =>
      accounts.add(user.id, { displayName, gameSlug: 'huntera' }))
    configured.push(accounts.add(user.id, {
      displayName: 'Conta 3',
      gameSlug: 'tibia',
    }))
    manager.ensure(configured[0]!.id)
    manager.ensure(configured[1]!.id)
    const permissions = new PermissionService({
      account_limit: 2,
      expires_at: null,
      features: {},
      founder_number: null,
      lifetime: false,
      plan: 'FREE',
    })
    await permissions.openSession(configured[0]!.id, () => undefined)
    await permissions.openSession(configured[1]!.id, () => undefined)
    const appliedLayouts: GridLayout[] = []
    const applyLayout = vi.fn((layout: GridLayout) => {
      appliedLayouts.push(layout)
    })
    const open = vi.fn()
    const auth = createAuthServiceDouble()
    const app = new AuthApp(asHtmlElement(rootElement), auth.service, {
      accountService: accounts,
      permissionService: permissions,
      sessionLauncher: { applyLayout, open, reload: vi.fn() },
    })
    const harness = app as unknown as {
      activeDialog: 'add-account' | 'free-limit' | null
      applyWorkspacePresentation(): void
      completeAddedAccount(account: ConfiguredAccount): void
      configuredAccounts: ConfiguredAccount[]
      currentView: 'authenticated'
      handleSessionEscape(): void
      render: ReturnType<typeof vi.fn>
      session: Session | null
      sessionSurfaceManager: SessionSurfaceManager
      workspaceMode: 'grid'
    }
    harness.currentView = 'authenticated'
    harness.session = session
    harness.configuredAccounts = configured
    harness.sessionSurfaceManager = manager
    harness.workspaceMode = 'grid'
    harness.activeDialog = 'add-account'
    harness.render = vi.fn(() => harness.applyWorkspacePresentation())

    harness.completeAddedAccount(configured[2]!)
    expect(harness.activeDialog).toBe('free-limit')
    await vi.waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(1))
    expect(appliedLayouts[0]!.slots).toEqual([])
    expect(appliedLayouts[0]!.overflowSessionIds).toEqual([
      configured[0]!.id,
      configured[1]!.id,
    ])
    expect(open).not.toHaveBeenCalled()

    harness.handleSessionEscape()
    expect(harness.activeDialog).toBeNull()
    await vi.waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(2))
    expect(appliedLayouts[1]!.slots.map((slot) => slot.sessionId)).toEqual([
      configured[0]!.id,
      configured[1]!.id,
    ])
    expect(manager.get(configured[0]!.id)).not.toBeNull()
    expect(manager.get(configured[1]!.id)).not.toBeNull()
    expect(open).not.toHaveBeenCalled()

    app.destroy()
  })

  it('does not let a pending launcher overwrite a restarted app root', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const accounts = new ConfiguredAccountService({
      createId: () => 'pending-account',
      storage: null,
    })
    const configured = accounts.add(user.id, {
      displayName: 'Conta pendente',
      gameSlug: 'huntera',
    })
    let finishOpening!: () => void
    const openingGate = new Promise<void>((resolve) => {
      finishOpening = resolve
    })
    const close = vi.fn()
    const app = new AuthApp(root, auth.service, {
      accountService: accounts,
      sessionLauncher: {
        close,
        open: () => openingGate,
      },
    })

    await app.start()
    const harness = app as unknown as {
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
    }
    const opening = harness.openConfiguredAccount(
      configured.id,
      { disabled: false, textContent: 'Abrir' } as HTMLButtonElement,
    )

    app.destroy()
    root.innerHTML = 'NOVO APLICATIVO'
    finishOpening()
    await opening

    expect(close).toHaveBeenCalledOnce()
    expect(root.innerHTML).toBe('NOVO APLICATIVO')
  })

  it('accepts ESC forwarded by the session host one presentation layer at a time', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    let forwardEscape: () => void = () => undefined
    const unsubscribe = vi.fn()
    const app = new AuthApp(root, auth.service, {
      sessionLauncher: {
        registerEscapeHandler(handler) {
          forwardEscape = handler
          return unsubscribe
        },
      },
    })

    await app.start()
    const harness = app as unknown as {
      maximizedAccountId: string | null
      screensOnly: boolean
    }
    harness.screensOnly = true
    harness.maximizedAccountId = 'account-1'

    forwardEscape()
    expect(harness.maximizedAccountId).toBeNull()
    expect(harness.screensOnly).toBe(true)
    forwardEscape()
    expect(harness.screensOnly).toBe(false)

    app.destroy()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('waits for an opening session before deleting its configuration', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const accounts = new ConfiguredAccountService({
      createId: () => 'account-race',
      storage: null,
    })
    const configured = accounts.add(user.id, {
      displayName: 'Conta em abertura',
      gameSlug: 'huntera',
    })
    const openingGate = deferred<void>()
    const close = vi.fn()
    const permissions = new PermissionService()
    const app = new AuthApp(root, auth.service, {
      accountService: accounts,
      permissionService: permissions,
      sessionLauncher: {
        close,
        open: () => openingGate.promise,
      },
    })

    await app.start()
    const harness = app as unknown as {
      deleteConfiguredAccount(button: HTMLButtonElement): Promise<void>
      dialogAccountId: string | null
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
    }
    const opening = harness.openConfiguredAccount(
      configured.id,
      { disabled: false, textContent: 'Abrir' } as HTMLButtonElement,
    )
    harness.dialogAccountId = configured.id
    const deleting = harness.deleteConfiguredAccount(
      { disabled: false, textContent: 'Excluir' } as HTMLButtonElement,
    )

    openingGate.resolve()
    await Promise.all([opening, deleting])

    expect(close).toHaveBeenCalledOnce()
    expect(permissions.getActiveSessionCount()).toBe(0)
    expect(accounts.list(user.id)).toEqual([])
    app.destroy()
  })

  it('waits for a pending opening and its compensating close during logout', async () => {
    installBrowser('https://app.example.com/')
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const openingGate = deferred<void>()
    const close = vi.fn()
    let clickLogout!: () => Promise<void>
    const logoutButton = {
      addEventListener: vi.fn((event: string, listener: () => Promise<void>) => {
        if (event === 'click') {
          clickLogout = listener
        }
      }),
      dataset: {},
      disabled: false,
      textContent: 'Sair da conta',
    } as unknown as HTMLButtonElement
    const root = {
      innerHTML: '',
      querySelector: vi.fn((selector: string) =>
        selector === '#logout-button' ? logoutButton : null),
      querySelectorAll: vi.fn(() => []),
    } as unknown as HTMLElement
    const accounts = new ConfiguredAccountService({
      createId: () => 'account-logout-race',
      storage: null,
    })
    const configured = accounts.add(user.id, {
      displayName: 'Conta em abertura',
      gameSlug: 'huntera',
    })
    const permissions = new PermissionService()
    const app = new AuthApp(root, auth.service, {
      accountService: accounts,
      permissionService: permissions,
      sessionLauncher: {
        close,
        open: () => openingGate.promise,
      },
    })

    await app.start()
    const harness = app as unknown as {
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
    }
    const opening = harness.openConfiguredAccount(
      configured.id,
      { disabled: false, textContent: 'Abrir' } as HTMLButtonElement,
    )
    let logoutSettled = false
    const logout = clickLogout().then(() => {
      logoutSettled = true
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(auth.signOut).toHaveBeenCalledOnce()
    expect(logoutSettled).toBe(false)

    openingGate.resolve()
    await Promise.all([opening, logout])

    expect(close).toHaveBeenCalledOnce()
    expect(permissions.getActiveSessionIds()).toEqual([])
    expect(currentView(app)).toBe('login')
    app.destroy()
  })

  it('waits for a pending opening and its compensating close before password recovery', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const openingGate = deferred<void>()
    const close = vi.fn()
    const accounts = new ConfiguredAccountService({
      createId: () => 'account-recovery-race',
      storage: null,
    })
    const configured = accounts.add(user.id, {
      displayName: 'Conta em abertura',
      gameSlug: 'huntera',
    })
    const permissions = new PermissionService()
    const app = new AuthApp(root, auth.service, {
      accountService: accounts,
      permissionService: permissions,
      sessionLauncher: {
        close,
        open: () => openingGate.promise,
      },
    })

    await app.start()
    const harness = app as unknown as {
      handleAuthStateChange(
        event: AuthChangeEvent,
        nextSession: Session | null,
      ): Promise<void>
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
    }
    const opening = harness.openConfiguredAccount(
      configured.id,
      { disabled: false, textContent: 'Abrir' } as HTMLButtonElement,
    )
    let recoverySettled = false
    const recovery = harness
      .handleAuthStateChange('PASSWORD_RECOVERY', session)
      .then(() => {
        recoverySettled = true
      })

    await Promise.resolve()
    await Promise.resolve()
    expect(recoverySettled).toBe(false)
    expect(currentView(app)).toBe('authenticated')

    openingGate.resolve()
    await Promise.all([opening, recovery])

    expect(close).toHaveBeenCalledOnce()
    expect(permissions.getActiveSessionIds()).toEqual([])
    expect(currentView(app)).toBe('reset')
    app.destroy()
  })

  it('shares concurrent cleanup and reports the same close failure to every caller', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const accounts = new ConfiguredAccountService({
      createId: () => 'account-cleanup-race',
      storage: null,
    })
    const configured = accounts.add(user.id, {
      displayName: 'Conta ativa',
      gameSlug: 'huntera',
    })
    const permissions = new PermissionService()
    const close = vi.fn().mockRejectedValue(new Error('close failed'))
    const app = new AuthApp(root, auth.service, {
      accountService: accounts,
      permissionService: permissions,
      sessionLauncher: { close },
    })

    await app.start()
    await permissions.openSession(configured.id, vi.fn())
    const harness = app as unknown as {
      releaseTrackedSessions(): Promise<boolean>
    }

    const firstCleanup = harness.releaseTrackedSessions()
    const secondCleanup = harness.releaseTrackedSessions()

    await expect(Promise.all([firstCleanup, secondCleanup])).resolves.toEqual([
      false,
      false,
    ])
    expect(close).toHaveBeenCalledOnce()
    app.destroy()
  })

  it('hides again after a deferred opening cannot be closed when cleanup cancels it', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const accounts = new ConfiguredAccountService({
      createId: () => 'account-rehide-race',
      storage: null,
    })
    const configured = accounts.add(user.id, {
      displayName: 'Conta em abertura',
      gameSlug: 'huntera',
    })
    const openingGate = deferred<void>()
    const applyLayout = vi.fn((_layout: GridLayout) => undefined)
    const close = vi.fn().mockRejectedValue(new Error('native close failed'))
    const app = new AuthApp(root, auth.service, {
      accountService: accounts,
      sessionLauncher: {
        applyLayout,
        close,
        open: () => openingGate.promise,
      },
    })

    await app.start()
    const harness = app as unknown as {
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
      releaseTrackedSessions(): Promise<boolean>
    }
    const opening = harness.openConfiguredAccount(
      configured.id,
      { disabled: false, textContent: 'Abrir' } as HTMLButtonElement,
    )
    const cleanup = harness.releaseTrackedSessions()

    await vi.waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(1))
    expect(applyLayout.mock.calls[0]![0].slots).toEqual([])
    expect(applyLayout.mock.calls[0]![0].overflowSessionIds).toEqual([
      configured.id,
    ])
    expect(close).not.toHaveBeenCalled()

    openingGate.resolve()
    await opening
    await expect(cleanup).resolves.toBe(false)

    expect(close).toHaveBeenCalledOnce()
    expect(applyLayout).toHaveBeenCalledTimes(2)
    expect(applyLayout.mock.calls[1]![0].slots).toEqual([])
    expect(applyLayout.mock.calls[1]![0].overflowSessionIds).toEqual([
      configured.id,
    ])

    app.destroy()
  })

  it('does not enqueue a visible presentation from resize work during cleanup', async () => {
    installBrowser('https://app.example.com/')

    const frame = new AcceptanceElement()
    const shell = new AcceptanceElement()
    const workspace = new AcceptanceElement()
    const grid = new AcceptanceElement()
    const rootElement = new AcceptanceElement()
    rootElement.setQuery('.app-frame', frame)
    rootElement.setQuery('[data-authenticated-shell]', shell)
    rootElement.setQueryAll('button[data-grid-mode]', [])
    shell.setQuery('[data-session-workspace]', workspace)
    shell.setQuery('[data-session-grid]', grid)

    const surfaceElement = new AcceptanceElement()
    surfaceElement.bounds = { height: 680, width: 1260, x: 10, y: 10 }
    const manager = new SessionSurfaceManager(asHtmlElement(grid), {
      createCard: () => asHtmlElement(new AcceptanceElement()),
      createSurface: () => asHtmlElement(surfaceElement),
    })
    const accounts = new ConfiguredAccountService({
      createId: () => 'account-cleanup-resize',
      storage: null,
    })
    const account = accounts.add(user.id, {
      displayName: 'Conta visível',
      gameSlug: 'huntera',
    })
    manager.ensure(account.id)

    const permissions = new PermissionService()
    await permissions.openSession(account.id, vi.fn())
    const closeGate = deferred<void>()
    const applyLayout = vi.fn((_layout: GridLayout) => undefined)
    const auth = createAuthServiceDouble()
    const app = new AuthApp(asHtmlElement(rootElement), auth.service, {
      accountService: accounts,
      permissionService: permissions,
      sessionLauncher: {
        applyLayout,
        close: () => closeGate.promise,
      },
    })
    const harness = app as unknown as {
      applyWorkspacePresentation(): void
      configuredAccounts: Array<typeof account>
      currentView: 'authenticated'
      gridMode: '1x1'
      releaseTrackedSessions(): Promise<boolean>
      render(): void
      scheduleWorkspaceLayout(): void
      session: Session | null
      sessionLayoutQueue: Promise<void>
      sessionSurfaceManager: SessionSurfaceManager
    }
    harness.currentView = 'authenticated'
    harness.session = session
    harness.configuredAccounts = [account]
    harness.gridMode = '1x1'
    harness.sessionSurfaceManager = manager
    harness.render = vi.fn()

    harness.applyWorkspacePresentation()
    await vi.waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(1))
    expect(applyLayout.mock.calls[0]![0].slots).toHaveLength(1)

    const cleanup = harness.releaseTrackedSessions()
    await vi.waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(2))
    expect(applyLayout.mock.calls[1]![0].slots).toEqual([])
    expect(applyLayout.mock.calls[1]![0].overflowSessionIds).toEqual([
      account.id,
    ])

    surfaceElement.bounds = { height: 680, width: 1260, x: 80, y: 10 }
    harness.applyWorkspacePresentation()
    harness.scheduleWorkspaceLayout()
    await Promise.resolve()
    await Promise.resolve()

    expect(applyLayout).toHaveBeenCalledTimes(2)

    closeGate.resolve()
    await expect(cleanup).resolves.toBe(true)
    await Promise.resolve()
    await harness.sessionLayoutQueue

    expect(applyLayout).toHaveBeenCalledTimes(2)
    expect(applyLayout.mock.calls.at(-1)![0].slots).toEqual([])
    expect(applyLayout.mock.calls.at(-1)![0].overflowSessionIds).toEqual([
      account.id,
    ])

    app.destroy()
  })

  it('resumes with the newly active session after cleanup finishes', async () => {
    installBrowser('https://app.example.com/')

    const frame = new AcceptanceElement()
    const shell = new AcceptanceElement()
    const workspace = new AcceptanceElement()
    const grid = new AcceptanceElement()
    const rootElement = new AcceptanceElement()
    rootElement.setQuery('.app-frame', frame)
    rootElement.setQuery('[data-authenticated-shell]', shell)
    rootElement.setQueryAll('button[data-grid-mode]', [])
    shell.setQuery('[data-session-workspace]', workspace)
    shell.setQuery('[data-session-grid]', grid)

    const surfaces = new Map<string, AcceptanceElement>()
    const manager = new SessionSurfaceManager(asHtmlElement(grid), {
      createCard: () => asHtmlElement(new AcceptanceElement()),
      createSurface: (accountId) => {
        const surface = new AcceptanceElement()
        surface.bounds = { height: 680, width: 1260, x: 20, y: 10 }
        surfaces.set(accountId, surface)
        return asHtmlElement(surface)
      },
    })
    const accounts = new ConfiguredAccountService({
      createId: (() => {
        let nextId = 0
        return () => `cleanup-generation-${++nextId}`
      })(),
      storage: null,
    })
    const oldAccount = accounts.add(user.id, {
      displayName: 'Conta antiga',
      gameSlug: 'huntera',
    })
    const newAccount = accounts.add(user.id, {
      displayName: 'Conta nova',
      gameSlug: 'huntera',
    })
    manager.ensure(oldAccount.id)
    manager.ensure(newAccount.id)

    const permissions = new PermissionService()
    await permissions.openSession(oldAccount.id, vi.fn())
    const closeGate = deferred<void>()
    const applyLayout = vi.fn((_layout: GridLayout) => undefined)
    const open = vi.fn()
    const reload = vi.fn()
    const auth = createAuthServiceDouble()
    const app = new AuthApp(asHtmlElement(rootElement), auth.service, {
      accountService: accounts,
      permissionService: permissions,
      sessionLauncher: {
        applyLayout,
        close: () => closeGate.promise,
        open,
        reload,
      },
    })
    const harness = app as unknown as {
      applyWorkspacePresentation(): void
      configuredAccounts: Array<typeof oldAccount>
      currentView: 'authenticated'
      gridMode: '1x1'
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
      releaseTrackedSessions(): Promise<boolean>
      render(): void
      scheduleWorkspaceLayout(): void
      session: Session | null
      sessionLayoutQueue: Promise<void>
      sessionSurfaceManager: SessionSurfaceManager
    }
    harness.currentView = 'authenticated'
    harness.session = session
    harness.configuredAccounts = [oldAccount, newAccount]
    harness.gridMode = '1x1'
    harness.sessionSurfaceManager = manager
    harness.render = vi.fn()

    harness.applyWorkspacePresentation()
    await vi.waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(1))
    expect(applyLayout.mock.calls[0]![0].slots[0]!.sessionId).toBe(oldAccount.id)

    const cleanup = harness.releaseTrackedSessions()
    await vi.waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(2))
    expect(applyLayout.mock.calls[1]![0].slots).toEqual([])

    await harness.openConfiguredAccount(
      newAccount.id,
      { disabled: false, textContent: 'Abrir' } as HTMLButtonElement,
    )
    harness.applyWorkspacePresentation()
    harness.scheduleWorkspaceLayout()
    await Promise.resolve()
    await Promise.resolve()

    expect(applyLayout).toHaveBeenCalledTimes(2)
    expect(permissions.getActiveSessionIds()).toEqual([newAccount.id])

    closeGate.resolve()
    await expect(cleanup).resolves.toBe(true)
    await vi.waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(3))
    await harness.sessionLayoutQueue

    expect(applyLayout.mock.calls[2]![0].slots.map((slot) => slot.sessionId)).toEqual([
      newAccount.id,
    ])
    expect(applyLayout.mock.calls[2]![0].overflowSessionIds).toEqual([])
    expect(surfaces.get(newAccount.id)).toBeDefined()
    expect(open).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()

    app.destroy()
  })

  it('retries a failed compensating close before reopening the same account', async () => {
    installBrowser('https://app.example.com/')
    const root = createRoot()
    const auth = createAuthServiceDouble()
    auth.getSession.mockResolvedValue(session)
    const accounts = new ConfiguredAccountService({
      createId: () => 'account-orphan-retry',
      storage: null,
    })
    const configured = accounts.add(user.id, {
      displayName: 'Conta protegida',
      gameSlug: 'huntera',
    })
    const openingGate = deferred<void>()
    const close = vi.fn()
      .mockRejectedValueOnce(new Error('native close failed'))
      .mockResolvedValue(undefined)
    const open = vi.fn()
      .mockImplementationOnce(() => openingGate.promise)
      .mockResolvedValue(undefined)
    const app = new AuthApp(root, auth.service, {
      accountService: accounts,
      sessionLauncher: { close, open },
    })

    await app.start()
    const harness = app as unknown as {
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
      releaseTrackedSessions(): Promise<boolean>
    }
    const button = () => ({
      disabled: false,
      textContent: 'Abrir',
    }) as HTMLButtonElement
    const firstOpening = harness.openConfiguredAccount(configured.id, button())
    const cleanup = harness.releaseTrackedSessions()

    openingGate.resolve()
    await firstOpening
    await expect(cleanup).resolves.toBe(false)
    expect(close).toHaveBeenCalledTimes(1)

    await harness.openConfiguredAccount(configured.id, button())

    expect(close).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledTimes(2)
    app.destroy()
  })

  it('keeps six PRO surfaces alive in the continuous scrolling grid', async () => {
    installBrowser('https://app.example.com/')

    class AcceptanceKeyboardEvent {
      defaultPrevented = false
      readonly key: string

      constructor(_type: string, init: { key?: string } = {}) {
        this.key = init.key ?? ''
      }

      preventDefault(): void {
        this.defaultPrevented = true
      }
    }

    vi.stubGlobal('KeyboardEvent', AcceptanceKeyboardEvent)
    const frame = new AcceptanceElement()
    const shell = new AcceptanceElement()
    const workspace = new AcceptanceElement()
    const grid = new AcceptanceElement()
    const pagination = new AcceptanceElement()
    const pageStatus = new AcceptanceElement()
    const previousPage = new AcceptanceElement()
    const nextPage = new AcceptanceElement()
    const grid3x2 = new AcceptanceElement()
    const grid2x2 = new AcceptanceElement()
    const gridModeLabel = new AcceptanceElement()
    const profileLabel = new AcceptanceElement()
    const rootElement = new AcceptanceElement()
    previousPage.dataset.gridPage = 'previous'
    nextPage.dataset.gridPage = 'next'
    grid3x2.dataset.gridMode = '3x2'
    grid2x2.dataset.gridMode = '2x2'
    profileLabel.textContent = 'Minha conta'
    rootElement.setQuery('.app-frame', frame)
    rootElement.setQuery('[data-authenticated-shell]', shell)
    rootElement.setQuery('[data-grid-mode-label]', gridModeLabel)
    rootElement.setQuery('[data-toolbar-menu] summary small', profileLabel)
    rootElement.setQueryAll('button[data-grid-mode]', [grid3x2, grid2x2])
    rootElement.setQueryAll('[data-grid-page]', [previousPage, nextPage])
    shell.setQuery('[data-session-workspace]', workspace)
    shell.setQuery('[data-session-grid]', grid)
    shell.setQuery('[data-session-pagination]', pagination)
    pagination.setQuery('[data-grid-page-status]', pageStatus)
    pagination.setQuery('[data-grid-page="previous"]', previousPage)
    pagination.setQuery('[data-grid-page="next"]', nextPage)

    const factory: SessionSurfaceElementFactory = {
      createCard: () => asHtmlElement(new AcceptanceElement()),
      createSurface: (accountId) => {
        const surface = new AcceptanceElement()
        const index = Number(accountId.split('-').at(-1) ?? 1) - 1
        surface.bounds = {
          height: 320,
          width: 380,
          x: (index % 3) * 390,
          y: Math.floor(index / 3) * 330,
        }
        return asHtmlElement(surface)
      },
    }
    const manager = new SessionSurfaceManager(asHtmlElement(grid), factory)
    const accounts = new ConfiguredAccountService({
      createId: (() => {
        let nextId = 0
        return () => `account-${++nextId}`
      })(),
      storage: null,
    })
    const configured = Array.from({ length: 6 }, (_, index) =>
      accounts.add(user.id, {
        displayName: `Conta ${index + 1}`,
        gameSlug: 'huntera',
      }))
    configured.forEach((account) => manager.ensure(account.id))
    const permissions = new PermissionService({
      account_limit: 10,
      expires_at: null,
      features: { advanced_grids: true },
      founder_number: null,
      lifetime: false,
      plan: 'PRO',
    })
    const launcher = {
      applyLayout: vi.fn(),
      open: vi.fn(),
      reload: vi.fn(),
    }
    const auth = createAuthServiceDouble()
    const app = new AuthApp(asHtmlElement(rootElement), auth.service, {
      accountService: accounts,
      permissionService: permissions,
      sessionLauncher: launcher,
    })
    const harness = app as unknown as {
      applyWorkspacePresentation(): void
      bindAuthenticatedActions(): void
      configuredAccounts: typeof configured
      currentView: 'authenticated'
      gridMode: 'auto' | '1x1' | '1x2' | '2x1' | '2x2' | '3x2' | '3x3'
      handleKeyDown(event: KeyboardEvent): void
      maximizedAccountId: string | null
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
      render(): void
      screensOnly: boolean
      session: Session | null
      sessionSurfaceManager: SessionSurfaceManager
      workspaceMode: 'account' | 'grid'
    }
    harness.currentView = 'authenticated'
    harness.session = session
    harness.configuredAccounts = configured
    harness.sessionSurfaceManager = manager
    harness.workspaceMode = 'grid'
    harness.render = vi.fn()

    for (const account of configured) {
      await harness.openConfiguredAccount(
        account.id,
        { disabled: false, textContent: 'Abrir' } as HTMLButtonElement,
      )
    }

    expect(launcher.open).toHaveBeenCalledTimes(6)
    const firstSurface = manager.get(configured[0]!.id)!.surface
    firstSurface.setAttribute('data-login-state', 'authenticated')
    harness.bindAuthenticatedActions()

    grid3x2.click()
    expect(harness.gridMode).toBe('3x2')
    expect(gridModeLabel.textContent).toBe('3x2')
    expect(profileLabel.textContent).toBe('Minha conta')
    expect(pageStatus.textContent).toBe('1/1')
    expect(pagination.getAttribute('hidden')).toBe('')

    grid2x2.click()
    expect(harness.gridMode).toBe('2x2')
    expect(pageStatus.textContent).toBe('1/1')
    expect(pagination.getAttribute('hidden')).toBe('')
    expect(
      (manager.get(configured[0]!.id)!.card as unknown as AcceptanceElement)
        .classList.contains('is-suppressed'),
    ).toBe(false)
    expect(
      (manager.get(configured[5]!.id)!.card as unknown as AcceptanceElement)
        .classList.contains('is-suppressed'),
    ).toBe(false)

    expect(manager.get(configured[0]!.id)!.surface).toBe(firstSurface)
    expect(firstSurface.getAttribute('data-login-state')).toBe('authenticated')
    expect(launcher.open).toHaveBeenCalledTimes(6)
    expect(launcher.reload).not.toHaveBeenCalled()

    harness.screensOnly = true
    harness.maximizedAccountId = configured[0]!.id
    harness.applyWorkspacePresentation()
    const firstEscape = new KeyboardEvent('keydown', { key: 'Escape' })
    harness.handleKeyDown(firstEscape)
    expect(harness.maximizedAccountId).toBeNull()
    expect(harness.screensOnly).toBe(true)
    expect(firstEscape.defaultPrevented).toBe(true)

    const secondEscape = new KeyboardEvent('keydown', { key: 'Escape' })
    harness.handleKeyDown(secondEscape)
    expect(harness.screensOnly).toBe(false)
    expect(secondEscape.defaultPrevented).toBe(true)
    expect(manager.get(configured[0]!.id)!.surface).toBe(firstSurface)
    expect(launcher.open).toHaveBeenCalledTimes(6)
    expect(launcher.reload).not.toHaveBeenCalled()
  })

  it('keeps a second account in the continuous 1x1 scrolling grid', async () => {
    installBrowser('https://app.example.com/')

    const frame = new AcceptanceElement()
    const shell = new AcceptanceElement()
    const workspace = new AcceptanceElement()
    const grid = new AcceptanceElement()
    const rootElement = new AcceptanceElement()
    rootElement.setQuery('.app-frame', frame)
    rootElement.setQuery('[data-authenticated-shell]', shell)
    rootElement.setQueryAll('button[data-grid-mode]', [])
    shell.setQuery('[data-session-workspace]', workspace)
    shell.setQuery('[data-session-grid]', grid)

    const factory: SessionSurfaceElementFactory = {
      createCard: () => asHtmlElement(new AcceptanceElement()),
      createSurface: () => {
        const surface = new AcceptanceElement()
        surface.bounds = { height: 680, width: 1260, x: 10, y: 10 }
        return asHtmlElement(surface)
      },
    }
    const manager = new SessionSurfaceManager(asHtmlElement(grid), factory)
    const accounts = new ConfiguredAccountService({
      createId: (() => {
        let nextId = 0
        return () => `manual-account-${++nextId}`
      })(),
      storage: null,
    })
    const accountA = accounts.add(user.id, {
      displayName: 'Conta A',
      gameSlug: 'huntera',
    })
    const accountB = accounts.add(user.id, {
      displayName: 'Conta B',
      gameSlug: 'huntera',
    })
    manager.ensure(accountA.id)
    manager.ensure(accountB.id)

    const permissions = new PermissionService({
      account_limit: 2,
      expires_at: null,
      features: { advanced_grids: false },
      founder_number: null,
      lifetime: false,
      plan: 'FREE',
    })
    const launcher = {
      applyLayout: vi.fn(),
      open: vi.fn(),
      reload: vi.fn(),
    }
    const auth = createAuthServiceDouble()
    const app = new AuthApp(asHtmlElement(rootElement), auth.service, {
      accountService: accounts,
      permissionService: permissions,
      sessionLauncher: launcher,
    })
    const harness = app as unknown as {
      applyWorkspacePresentation(): void
      configuredAccounts: typeof accountA[]
      currentView: 'authenticated'
      gridMode: '1x1'
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
      render(): void
      session: Session | null
      sessionSurfaceManager: SessionSurfaceManager
      workspaceMode: 'account' | 'grid'
    }
    harness.currentView = 'authenticated'
    harness.session = session
    harness.configuredAccounts = [accountA, accountB]
    harness.gridMode = '1x1'
    harness.sessionSurfaceManager = manager
    harness.workspaceMode = 'grid'
    harness.render = vi.fn()

    const surfaceA = manager.get(accountA.id)!.surface
    const surfaceB = manager.get(accountB.id)!.surface
    await harness.openConfiguredAccount(
      accountA.id,
      { disabled: false, textContent: 'Abrir' } as HTMLButtonElement,
    )
    harness.applyWorkspacePresentation()
    await vi.waitFor(() => expect(launcher.applyLayout).toHaveBeenCalledTimes(1))

    expect(launcher.applyLayout.mock.calls[0]![0].overflowSessionIds).toEqual([])

    await harness.openConfiguredAccount(
      accountB.id,
      { disabled: false, textContent: 'Abrir' } as HTMLButtonElement,
    )
    harness.applyWorkspacePresentation()
    await vi.waitFor(() => expect(launcher.applyLayout).toHaveBeenCalledTimes(2))

    expect(launcher.applyLayout.mock.calls[1]![0].overflowSessionIds).toEqual([])
    expect(manager.get(accountA.id)!.surface).toBe(surfaceA)
    expect(manager.get(accountB.id)!.surface).toBe(surfaceB)
    expect(launcher.open).toHaveBeenCalledTimes(2)
    expect(launcher.reload).not.toHaveBeenCalled()

    app.destroy()
  })

  it('does not send an empty native layout or show an alert with zero active sessions', async () => {
    installBrowser('https://app.example.com/')

    const frame = new AcceptanceElement()
    const shell = new AcceptanceElement()
    const workspace = new AcceptanceElement()
    const grid = new AcceptanceElement()
    const alert = new AcceptanceElement()
    const rootElement = new AcceptanceElement()
    rootElement.setQuery('.app-frame', frame)
    rootElement.setQuery('[data-authenticated-shell]', shell)
    rootElement.setQuery('#session-alert', alert)
    rootElement.setQueryAll('button[data-grid-mode]', [])
    shell.setQuery('[data-session-workspace]', workspace)
    shell.setQuery('[data-session-grid]', grid)

    const applyLayout = vi.fn().mockRejectedValue(new Error('IPC unavailable'))
    const auth = createAuthServiceDouble()
    const app = new AuthApp(asHtmlElement(rootElement), auth.service, {
      sessionLauncher: { applyLayout },
    })
    const harness = app as unknown as {
      applyWorkspacePresentation(): void
      currentView: 'authenticated'
      session: Session | null
      sessionSurfaceManager: SessionSurfaceManager
    }
    harness.currentView = 'authenticated'
    harness.session = session
    harness.sessionSurfaceManager = new SessionSurfaceManager(asHtmlElement(grid))

    harness.applyWorkspacePresentation()
    await Promise.resolve()
    await Promise.resolve()

    expect(applyLayout).not.toHaveBeenCalled()
    expect(alert.textContent).toBe('')

    app.destroy()
  })

  it('serializes rapid presentations and queues the cleanup layout behind them', async () => {
    installBrowser('https://app.example.com/')

    const frame = new AcceptanceElement()
    const shell = new AcceptanceElement()
    const workspace = new AcceptanceElement()
    const grid = new AcceptanceElement()
    const rootElement = new AcceptanceElement()
    rootElement.setQuery('.app-frame', frame)
    rootElement.setQuery('[data-authenticated-shell]', shell)
    rootElement.setQueryAll('button[data-grid-mode]', [])
    shell.setQuery('[data-session-workspace]', workspace)
    shell.setQuery('[data-session-grid]', grid)

    const surfaceElement = new AcceptanceElement()
    surfaceElement.bounds = { height: 680, width: 1260, x: 10, y: 10 }
    const manager = new SessionSurfaceManager(asHtmlElement(grid), {
      createCard: () => asHtmlElement(new AcceptanceElement()),
      createSurface: () => asHtmlElement(surfaceElement),
    })
    const accounts = new ConfiguredAccountService({
      createId: () => 'queued-account',
      storage: null,
    })
    const account = accounts.add(user.id, {
      displayName: 'Conta em fila',
      gameSlug: 'huntera',
    })
    manager.ensure(account.id)

    const firstLayoutGate = deferred<void>()
    const secondLayoutGate = deferred<void>()
    const appliedLayouts: GridLayout[] = []
    const applyLayout = vi.fn((layout: GridLayout) => {
      appliedLayouts.push(layout)

      if (appliedLayouts.length === 1) {
        return firstLayoutGate.promise
      }
      if (appliedLayouts.length === 2) {
        return secondLayoutGate.promise
      }

      return undefined
    })
    const close = vi.fn()
    const reload = vi.fn()
    const permissions = new PermissionService({
      account_limit: 2,
      expires_at: null,
      features: { advanced_grids: false },
      founder_number: null,
      lifetime: false,
      plan: 'FREE',
    })
    const auth = createAuthServiceDouble()
    const app = new AuthApp(asHtmlElement(rootElement), auth.service, {
      accountService: accounts,
      permissionService: permissions,
      sessionLauncher: {
        applyLayout,
        close,
        open: vi.fn(),
        reload,
      },
    })
    const harness = app as unknown as {
      applyWorkspacePresentation(): void
      configuredAccounts: typeof account[]
      currentView: 'authenticated'
      gridMode: '1x1'
      openConfiguredAccount(
        accountId: string,
        button: HTMLButtonElement,
      ): Promise<void>
      releaseTrackedSessions(): Promise<boolean>
      render(): void
      session: Session | null
      sessionSurfaceManager: SessionSurfaceManager
    }
    harness.currentView = 'authenticated'
    harness.session = session
    harness.configuredAccounts = [account]
    harness.gridMode = '1x1'
    harness.sessionSurfaceManager = manager
    harness.render = vi.fn()

    await harness.openConfiguredAccount(
      account.id,
      { disabled: false, textContent: 'Abrir' } as HTMLButtonElement,
    )
    harness.applyWorkspacePresentation()
    await vi.waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(1))
    expect(appliedLayouts[0]!.slots[0]!.bounds.x).toBe(10)

    surfaceElement.bounds = { height: 680, width: 1260, x: 40, y: 10 }
    harness.applyWorkspacePresentation()
    const cleanup = harness.releaseTrackedSessions()
    await Promise.resolve()

    expect(applyLayout).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()

    firstLayoutGate.resolve()
    await vi.waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(2))

    expect(appliedLayouts[1]!.slots[0]!.bounds.x).toBe(40)
    expect(appliedLayouts[1]!.overflowSessionIds).toEqual([])
    expect(close).not.toHaveBeenCalled()

    secondLayoutGate.resolve()
    await expect(cleanup).resolves.toBe(true)

    expect(applyLayout).toHaveBeenCalledTimes(3)
    expect(appliedLayouts[2]!.slots).toEqual([])
    expect(appliedLayouts[2]!.overflowSessionIds).toEqual([account.id])
    expect(close).toHaveBeenCalledOnce()
    expect(manager.get(account.id)!.surface).toBe(asHtmlElement(surfaceElement))
    expect(reload).not.toHaveBeenCalled()

    app.destroy()
  })
})
