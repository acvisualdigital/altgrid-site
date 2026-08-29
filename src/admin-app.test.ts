import type { Session, User } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { AdminApp } from './admin-app'
import { AuthService } from './services/auth-service'
import { BackendApi, BackendApiError } from './services/backend-api'

const user = {
  aud: 'authenticated',
  created_at: '2026-08-26T12:00:00.000Z',
  email: 'admin@altgrid.local',
  id: '10000000-0000-4000-8000-000000000001',
  role: 'authenticated',
} as User

const session = {
  access_token: 'admin-access-token',
  expires_in: 3600,
  refresh_token: 'admin-refresh-token',
  token_type: 'bearer',
  user,
} as Session

function rootDouble(): HTMLElement {
  return {
    innerHTML: '',
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  } as unknown as HTMLElement
}

function authDouble(current: Session | null = session): AuthService {
  return {
    getSession: vi.fn().mockResolvedValue(current),
    onAuthStateChange: vi.fn(() => vi.fn()),
    signOut: vi.fn(),
  } as unknown as AuthService
}

function backendDouble(overrides: Partial<Record<keyof BackendApi, unknown>> = {}): BackendApi {
  return {
    activateAdminLifetime: vi.fn(),
    clearAdminChatRestriction: vi.fn(),
    createAdminAnnouncement: vi.fn(),
    createAdminGame: vi.fn(),
    deleteAdminAnnouncement: vi.fn(),
    deleteAdminChatMessage: vi.fn(),
    getAdminAnnouncements: vi.fn().mockResolvedValue({ announcements: [] }),
    getAdminAudit: vi.fn().mockResolvedValue({
      entries: [],
      pagination: { has_more: false, page: 1, page_size: 50, total: 0 },
    }),
    getAdminChatReports: vi.fn().mockResolvedValue({
      pagination: { has_more: false, page: 1, page_size: 50, total: 0 },
      reports: [],
    }),
    getAdminConfig: vi.fn().mockResolvedValue({ config: [] }),
    getAdminGames: vi.fn().mockResolvedValue({ games: [] }),
    getAdminProducts: vi.fn().mockResolvedValue({ products: [] }),
    getAdminSession: vi.fn().mockResolvedValue({
      admin: { role: 'admin', user_id: user.id },
    }),
    getAdminUser: vi.fn(),
    grantAdminProDays: vi.fn(),
    resetAdminDevice: vi.fn(),
    reviewAdminChatReport: vi.fn(),
    revokeAdminDevice: vi.fn(),
    revokeAdminLicense: vi.fn(),
    searchAdminUsers: vi.fn().mockResolvedValue({
      pagination: { has_more: false, page: 1, page_size: 50, total: 1 },
      users: [{
        created_at: user.created_at,
        display_name: null,
        email: user.email,
        expires_at: null,
        founder_number: null,
        id: user.id,
        license_status: 'active',
        lifetime: true,
        plan: 'PRO',
        referral_code: 'HUNT-ABCD2345',
      }],
    }),
    setAdminChatRestriction: vi.fn(),
    setAdminPlan: vi.fn(),
    updateAdminAnnouncement: vi.fn(),
    updateAdminConfig: vi.fn(),
    updateAdminGame: vi.fn(),
    updateAdminProduct: vi.fn(),
    ...overrides,
  } as unknown as BackendApi
}

describe('AdminApp', () => {
  it('fails closed when an authenticated common user requests the admin panel', async () => {
    const root = rootDouble()
    const searchAdminUsers = vi.fn()
    const backend = backendDouble({
      getAdminSession: vi.fn().mockRejectedValue(
        new BackendApiError(
          'admin_required',
          'Acesso administrativo necessário.',
          403,
        ),
      ),
      searchAdminUsers,
    })
    const app = new AdminApp(root, authDouble(), backend)

    await app.start()

    expect(root.innerHTML).toContain('Acesso não autorizado')
    expect(root.innerHTML).not.toContain('data-admin-tab="users"')
    expect(searchAdminUsers).not.toHaveBeenCalled()
    app.destroy()
  })

  it('renders the minimal panel only after the protected backend authorizes the admin', async () => {
    const root = rootDouble()
    const backend = backendDouble()
    const app = new AdminApp(root, authDouble(), backend)

    await app.start()

    expect(backend.getAdminSession).toHaveBeenCalledOnce()
    expect(backend.searchAdminUsers).toHaveBeenCalledWith('', 1, 50)
    expect(root.innerHTML).toContain('Administração')
    expect(root.innerHTML).toContain('Usuários')
    expect(root.innerHTML).toContain('Jogos')
    expect(root.innerHTML).toContain('Configuração')
    expect(root.innerHTML).toContain('Produtos')
    expect(root.innerHTML).toContain('Avisos')
    expect(root.innerHTML).toContain('Chat')
    expect(root.innerHTML).toContain('Auditoria')
    expect(root.innerHTML).toContain('admin@altgrid.local')
    expect(root.innerHTML).toContain('HUNT-ABCD2345')
    expect(root.innerHTML).toContain('E-mail, user ID ou referral code')
    expect(root.innerHTML).not.toContain('<canvas')
    app.destroy()
  })

  it('renders referral code and referral details with status, IDs and dates', async () => {
    const root = rootDouble()
    const backend = backendDouble({
      getAdminUser: vi.fn().mockResolvedValue({
        user: {
          chat_status: { banned: false, muted_until: null, reason: null },
          created_at: user.created_at,
          devices: [],
          display_name: null,
          email: user.email,
          expires_at: null,
          founder_number: null,
          id: user.id,
          license_status: 'active',
          licenses: [],
          lifetime: false,
          payments: [],
          plan: 'PRO',
          referral_code: 'HUNT-ABCD2345',
          referrals: [{
            created_at: '2026-08-20T12:00:00.000Z',
            id: 'referral-record-id',
            qualification_reason: 'Pagamento confirmado',
            qualified_at: '2026-08-21T12:00:00.000Z',
            referred_user_id: 'referred-user-id',
            referrer_user_id: user.id,
            rewarded_at: '2026-08-22T12:00:00.000Z',
            status: 'rewarded',
          }],
        },
      }),
    })
    const app = new AdminApp(root, authDouble(), backend)
    const loadUser = (userId: string): Promise<void> =>
      (app as unknown as { loadUser(id: string): Promise<void> })
        .loadUser(userId)

    await app.start()
    await loadUser(user.id)

    expect(root.innerHTML).toContain('Referral code')
    expect(root.innerHTML).toContain('HUNT-ABCD2345')
    expect(root.innerHTML).toContain('Indicações')
    expect(root.innerHTML).toContain('rewarded')
    expect(root.innerHTML).toContain('referral-record-id')
    expect(root.innerHTML).toContain('referred-user-id')
    expect(root.innerHTML).toContain('Pagamento confirmado')
    expect(root.innerHTML).toContain('Qualificada')
    expect(root.innerHTML).toContain('Recompensada')
    expect(root.innerHTML.match(/value="PRO_PLUS"/g)).toHaveLength(2)
    app.destroy()
  })

  it('renders announcement management and chat moderation data from protected calls', async () => {
    const root = rootDouble()
    const backend = backendDouble({
      getAdminAnnouncements: vi.fn().mockResolvedValue({
        announcements: [{
          created_at: '2026-08-26T12:00:00.000Z',
          enabled: true,
          expires_at: '2026-08-27T12:00:00.000Z',
          id: 'announcement-id',
          message: 'O serviço ficará indisponível por dez minutos.',
          published_at: '2026-08-26T12:00:00.000Z',
          title: 'Manutenção programada',
          type: 'maintenance',
          updated_at: '2026-08-26T12:00:00.000Z',
        }],
      }),
      getAdminChatReports: vi.fn().mockResolvedValue({
        pagination: { has_more: false, page: 1, page_size: 50, total: 1 },
        reports: [{
          created_at: '2026-08-26T12:00:00.000Z',
          id: 'report-id',
          message: {
            channel_id: 'general',
            created_at: '2026-08-26T11:59:00.000Z',
            deleted_at: null,
            id: 'message-id',
            message: '<script>alert("xss")</script>',
            user_id: 'reported-user-id',
          },
          message_id: 'message-id',
          reason: 'Spam repetido',
          reported_by: 'reporter-user-id',
          reviewed_at: null,
          reviewed_by: null,
          status: 'pending',
        }],
      }),
    })
    const app = new AdminApp(root, authDouble(), backend)
    const loadTab = (tab: 'announcements' | 'chat'): Promise<void> =>
      (app as unknown as { loadTab(next: typeof tab): Promise<void> })
        .loadTab(tab)

    await app.start()
    await loadTab('announcements')

    expect(backend.getAdminAnnouncements).toHaveBeenCalledOnce()
    expect(root.innerHTML).toContain('Publicar aviso')
    expect(root.innerHTML).toContain('Manutenção programada')
    expect(root.innerHTML).toContain('data-edit-announcement="announcement-id"')
    expect(root.innerHTML).toContain('data-delete-announcement="announcement-id"')

    await loadTab('chat')

    expect(backend.getAdminChatReports).toHaveBeenCalledWith('pending', 1, 50)
    expect(root.innerHTML).toContain('Spam repetido')
    expect(root.innerHTML).toContain('reported-user-id')
    expect(root.innerHTML).toContain('data-review-chat-report="report-id"')
    expect(root.innerHTML).toContain('data-delete-chat-message="message-id"')
    expect(root.innerHTML).toContain('data-chat-restriction')
    expect(root.innerHTML).toContain('data-clear-chat-restriction="reported-user-id"')
    expect(root.innerHTML).not.toContain('<script>alert("xss")</script>')
    expect(root.innerHTML).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    app.destroy()
  })

  it('renders the complete compact configuration form and keeps the developer game URL', async () => {
    const root = rootDouble()
    const backend = backendDouble({
      getAdminConfig: vi.fn().mockResolvedValue({
        config: [
          { key: 'referral_referrer_days', updated_at: user.created_at, value: 7 },
          { key: 'referral_referred_days', updated_at: user.created_at, value: 7 },
          { key: 'founder_max_sales', updated_at: user.created_at, value: 100 },
          { key: 'maintenance', updated_at: user.created_at, value: true },
          { key: 'minimum_version', updated_at: user.created_at, value: '0.9.0-beta.1' },
          { key: 'latest_version', updated_at: user.created_at, value: '0.9.0-beta.2' },
          { key: 'update_channel', updated_at: user.created_at, value: 'stable' },
        ],
      }),
      getAdminGames: vi.fn().mockResolvedValue({ games: [] }),
    })
    const app = new AdminApp(root, authDouble(), backend)
    const loadTab = (tab: 'config' | 'games'): Promise<void> =>
      (app as unknown as { loadTab(next: typeof tab): Promise<void> })
        .loadTab(tab)

    await app.start()
    await loadTab('config')

    expect(root.innerHTML).toContain('founder_max_sales')
    expect(root.innerHTML).toContain('referral_referrer_days')
    expect(root.innerHTML).toContain('referral_referred_days')
    expect(root.innerHTML).toContain('name="maintenance"')
    expect(root.innerHTML).toContain('name="minimum_version"')
    expect(root.innerHTML).toContain('name="latest_version"')
    expect(root.innerHTML).toContain('name="update_channel"')
    expect(root.innerHTML).toContain('value="stable" selected')
    expect(root.innerHTML).not.toContain('<canvas')

    await loadTab('games')

    expect(root.innerHTML).toContain('name="developer_referral_url"')
    expect(root.innerHTML).toContain('URL de indicação do desenvolvedor')
    app.destroy()
  })

  it('renders Founder upgrade with the other administrable lifetime products', async () => {
    const root = rootDouble()
    const product = (code: string, name: string, price: number) => ({
      id: `product-${code.toLowerCase()}`,
      code,
      name,
      price_amount: price,
      currency: 'BRL',
      enabled: true,
      lifetime: true,
      updated_at: user.created_at,
    })
    const backend = backendDouble({
      getAdminProducts: vi.fn().mockResolvedValue({
        products: [
          product('PRO_LIFETIME', 'PRO Lifetime', 24.99),
          product('FOUNDER_LIFETIME', 'Founder Lifetime', 99.99),
          product('FOUNDER_UPGRADE', 'Founder Upgrade', 75),
        ],
      }),
    })
    const app = new AdminApp(root, authDouble(), backend)
    const loadTab = (tab: 'products'): Promise<void> =>
      (app as unknown as { loadTab(next: typeof tab): Promise<void> })
        .loadTab(tab)

    await app.start()
    await loadTab('products')

    expect(root.innerHTML).toContain('PRO_LIFETIME')
    expect(root.innerHTML).toContain('FOUNDER_LIFETIME')
    expect(root.innerHTML).toContain('FOUNDER_UPGRADE')
    app.destroy()
  })

  it('saves each configuration value with its expected JSON type', async () => {
    const root = rootDouble()
    const updateAdminConfig = vi.fn().mockResolvedValue({ config: {} })
    const backend = backendDouble({ updateAdminConfig })
    const app = new AdminApp(root, authDouble(), backend)
    const values: Record<string, string> = {
      founder_max_sales: '250',
      latest_version: '0.9.0-beta.2',
      maintenance: 'on',
      minimum_version: '0.9.0-beta.1',
      referral_referred_days: '5',
      referral_referrer_days: '10',
      update_channel: 'beta',
    }
    class FormDataDouble {
      get(key: string): string | null {
        return values[key] ?? null
      }
    }
    vi.stubGlobal('FormData', FormDataDouble)

    try {
      await app.start()
      await (app as unknown as {
        saveConfig(form: HTMLFormElement): Promise<void>
      }).saveConfig({} as HTMLFormElement)

      expect(updateAdminConfig.mock.calls).toEqual([
        ['referral_referrer_days', 10],
        ['referral_referred_days', 5],
        ['founder_max_sales', 250],
        ['minimum_version', '0.9.0-beta.1'],
        ['latest_version', '0.9.0-beta.2'],
        ['maintenance', true],
        ['update_channel', 'beta'],
      ])
    } finally {
      vi.unstubAllGlobals()
    }
    app.destroy()
  })

  it('asks unauthenticated users to sign in without calling an admin endpoint', async () => {
    const root = rootDouble()
    const backend = backendDouble()
    const app = new AdminApp(root, authDouble(null), backend)

    await app.start()

    expect(root.innerHTML).toContain('Entre primeiro')
    expect(backend.getAdminSession).not.toHaveBeenCalled()
    app.destroy()
  })
})
