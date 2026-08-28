import type { Session } from '@supabase/supabase-js'

import altgridLogoUrl from './assets/altgrid-mark.png'
import { AuthService } from './services/auth-service'
import { BackendApi, BackendApiError } from './services/backend-api'
import { validateSafeGameUrl } from './services/game-preset-service'
import type {
  AdminAnnouncement,
  AdminAnnouncementInput,
  AdminAnnouncementType,
  AdminAuditEntry,
  AdminChatReport,
  AdminChatReportStatus,
  AdminChatRestrictionInput,
  AdminConfigEntry,
  AdminGame,
  AdminProduct,
  AdminPaymentLog,
  AdminUserDetail,
  AdminUserSummary,
} from './types/admin-api'
import type { Json, PlanCode } from './types/database'

type AdminTab =
  | 'announcements'
  | 'audit'
  | 'chat'
  | 'config'
  | 'games'
  | 'products'
  | 'payments'
  | 'users'
type AdminView = 'checking' | 'denied' | 'error' | 'ready' | 'signed-out'

type AdminBackend = Pick<
  BackendApi,
  | 'activateAdminLifetime'
  | 'clearAdminChatRestriction'
  | 'createAdminAnnouncement'
  | 'createAdminGame'
  | 'deleteAdminAnnouncement'
  | 'deleteAdminChatMessage'
  | 'clearAdminChat'
  | 'getAdminAnnouncements'
  | 'getAdminAudit'
  | 'getAdminChatReports'
  | 'getAdminConfig'
  | 'getAdminGames'
  | 'getAdminProducts'
  | 'getAdminPaymentLogs'
  | 'getAdminSession'
  | 'getAdminUser'
  | 'grantAdminProDays'
  | 'resetAdminDevice'
  | 'reconcileAdminPayment'
  | 'reviewAdminChatReport'
  | 'revokeAdminDevice'
  | 'revokeAdminLicense'
  | 'searchAdminUsers'
  | 'setAdminChatRestriction'
  | 'setAdminPlan'
  | 'updateAdminAnnouncement'
  | 'updateAdminConfig'
  | 'updateAdminGame'
  | 'updateAdminProduct'
>

const INTEGER_CONFIG_FIELDS = [
  { key: 'referral_referrer_days', maximum: 3_650, minimum: 0 },
  { key: 'referral_referred_days', maximum: 3_650, minimum: 0 },
  { key: 'founder_max_sales', maximum: 1_000_000, minimum: 1 },
] as const

const VERSION_CONFIG_KEYS = ['minimum_version', 'latest_version'] as const
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>'"]/g,
    (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#039;',
      '"': '&quot;',
    })[character] ?? character,
  )
}

function formatDate(value: string | null): string {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      currency,
      style: 'currency',
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function toDatetimeLocal(value: string | null): string {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function adminErrorMessage(error: unknown): string {
  if (error instanceof BackendApiError) {
    return error.message
  }

  return 'Não foi possível concluir a operação administrativa.'
}

function jsonPreview(value: Json | null): string {
  if (value === null) {
    return '—'
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return 'Conteúdo indisponível'
  }
}

export class AdminApp {
  private view: AdminView = 'checking'
  private session: Session | null = null
  private activeTab: AdminTab = 'users'
  private loading = false
  private error: string | null = null
  private notice: string | null = null
  private searchQuery = ''
  private users: AdminUserSummary[] = []
  private usersPage = 1
  private usersHasMore = false
  private usersTotal = 0
  private selectedUser: AdminUserDetail | null = null
  private games: AdminGame[] = []
  private editingGameId: string | null = null
  private config: AdminConfigEntry[] = []
  private products: AdminProduct[] = []
  private paymentLogs: AdminPaymentLog[] = []
  private paymentPage = 1
  private paymentHasMore = false
  private paymentTotal = 0
  private announcements: AdminAnnouncement[] = []
  private editingAnnouncementId: string | null = null
  private chatReports: AdminChatReport[] = []
  private chatReportStatus: AdminChatReportStatus | null = 'pending'
  private auditEntries: AdminAuditEntry[] = []
  private auditPage = 1
  private auditHasMore = false
  private auditTotal = 0
  private revision = 0
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly root: HTMLElement,
    private readonly authService: AuthService,
    private readonly backend: AdminBackend,
  ) {}

  async start(): Promise<void> {
    // Retrying initialization must replace the listener instead of stacking
    // multiple auth subscriptions on the same admin view.
    this.unsubscribe?.()
    this.unsubscribe = null
    this.render()
    this.unsubscribe = this.authService.onAuthStateChange((_event, session) => {
      if (!session) {
        this.revision += 1
        this.session = null
        this.view = 'signed-out'
        this.clearData()
        this.render()
        return
      }

      if (session.user.id !== this.session?.user.id) {
        void this.authorize(session)
      } else {
        this.session = session
      }
    })

    try {
      const session = await this.authService.getSession()

      if (!session) {
        this.view = 'signed-out'
        this.render()
        return
      }

      await this.authorize(session)
    } catch (error) {
      this.view = 'error'
      this.error = adminErrorMessage(error)
      this.render()
    }
  }

  destroy(): void {
    this.revision += 1
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private async authorize(session: Session): Promise<void> {
    const revision = ++this.revision
    this.session = session
    this.view = 'checking'
    this.error = null
    this.clearData()
    this.render()

    try {
      await this.backend.getAdminSession()

      if (revision !== this.revision) {
        return
      }

      this.view = 'ready'
      this.render()
      await this.loadTab('users', revision)
    } catch (error) {
      if (revision !== this.revision) {
        return
      }

      this.view = error instanceof BackendApiError && error.status === 403
        ? 'denied'
        : 'error'
      this.error = adminErrorMessage(error)
      this.render()
    }
  }

  private clearData(): void {
    this.loading = false
    this.error = null
    this.notice = null
    this.users = []
    this.usersPage = 1
    this.usersHasMore = false
    this.usersTotal = 0
    this.selectedUser = null
    this.games = []
    this.editingGameId = null
    this.config = []
    this.products = []
    this.announcements = []
    this.editingAnnouncementId = null
    this.chatReports = []
    this.chatReportStatus = 'pending'
    this.auditEntries = []
    this.auditPage = 1
    this.auditHasMore = false
    this.auditTotal = 0
  }

  private async loadTab(
    tab: AdminTab,
    expectedRevision = this.revision,
  ): Promise<void> {
    this.activeTab = tab
    this.loading = true
    this.error = null
    this.render()

    try {
      if (tab === 'users') {
        const response = await this.backend.searchAdminUsers(
          this.searchQuery,
          this.usersPage,
          50,
        )
        if (expectedRevision === this.revision) {
          this.users = response.users
          this.usersPage = response.pagination.page
          this.usersHasMore = response.pagination.has_more
          this.usersTotal = response.pagination.total
        }
      } else if (tab === 'games') {
        const response = await this.backend.getAdminGames()
        if (expectedRevision === this.revision) {
          this.games = response.games
        }
      } else if (tab === 'config') {
        const response = await this.backend.getAdminConfig()
        if (expectedRevision === this.revision) {
          this.config = response.config
        }
      } else if (tab === 'products') {
        const response = await this.backend.getAdminProducts()
        if (expectedRevision === this.revision) {
          this.products = response.products
        }
      } else if (tab === 'payments') {
        const response = await this.backend.getAdminPaymentLogs(this.paymentPage, 50)
        if (expectedRevision === this.revision) {
          this.paymentLogs = response.payments
          this.paymentPage = response.pagination.page
          this.paymentHasMore = response.pagination.has_more
          this.paymentTotal = response.pagination.total
        }
      } else if (tab === 'announcements') {
        const response = await this.backend.getAdminAnnouncements()
        if (expectedRevision === this.revision) {
          this.announcements = response.announcements
        }
      } else if (tab === 'chat') {
        const response = await this.backend.getAdminChatReports(
          this.chatReportStatus,
          1,
          50,
        )
        if (expectedRevision === this.revision) {
          this.chatReports = response.reports
        }
      } else {
        const response = await this.backend.getAdminAudit(this.auditPage, 50)
        if (expectedRevision === this.revision) {
          this.auditEntries = response.entries
          this.auditPage = response.pagination.page
          this.auditHasMore = response.pagination.has_more
          this.auditTotal = response.pagination.total
        }
      }
    } catch (error) {
      if (expectedRevision === this.revision) {
        this.error = adminErrorMessage(error)
      }
    } finally {
      if (expectedRevision === this.revision) {
        this.loading = false
        this.render()
      }
    }
  }

  private async loadUser(userId: string): Promise<void> {
    const revision = this.revision
    this.loading = true
    this.error = null
    this.render()

    try {
      const response = await this.backend.getAdminUser(userId)
      if (revision === this.revision) {
        this.selectedUser = response.user
      }
    } catch (error) {
      if (revision === this.revision) {
        this.error = adminErrorMessage(error)
      }
    } finally {
      if (revision === this.revision) {
        this.loading = false
        this.render()
      }
    }
  }

  private render(): void {
    if (this.view !== 'ready') {
      this.root.innerHTML = this.renderGate()
      this.bindGateActions()
      return
    }

    this.root.innerHTML = `
      <div class="app-frame admin-frame">
        <header class="topbar admin-topbar">
          <a class="brand admin-brand" href="/" aria-label="AltGrid">
            <img class="brand__logo" src="${altgridLogoUrl}" alt="" />
            <span class="brand__name">AltGrid</span>
            <span class="admin-badge">Admin</span>
          </a>
          <div class="admin-topbar__actions">
            <a class="text-button" href="/">Voltar às contas</a>
            <button class="text-button" data-admin-sign-out type="button">Sair</button>
          </div>
        </header>
        <main class="admin-stage">
          <section class="admin-panel" aria-labelledby="admin-title">
            <div class="admin-panel__heading">
              <div>
                <p class="eyebrow">Operações internas</p>
                <h1 id="admin-title">Administração</h1>
              </div>
              <span class="admin-actor">${escapeHtml(this.session?.user.email ?? this.session?.user.id)}</span>
            </div>
            <nav class="admin-tabs" aria-label="Seções administrativas" role="tablist">
              ${this.renderTab('users', 'Usuários')}
              ${this.renderTab('games', 'Jogos')}
              ${this.renderTab('config', 'Configuração')}
              ${this.renderTab('products', 'Produtos')}
              ${this.renderTab('payments', 'Pagamentos')}
              ${this.renderTab('announcements', 'Avisos')}
              ${this.renderTab('chat', 'Chat')}
              ${this.renderTab('audit', 'Auditoria')}
            </nav>
            <div class="admin-feedback" aria-live="polite">
              ${this.loading ? '<span class="spinner spinner--green" aria-hidden="true"></span> Carregando…' : ''}
              ${this.error ? `<span class="admin-feedback--error">${escapeHtml(this.error)}</span>` : ''}
              ${this.notice ? `<span class="admin-feedback--success">${escapeHtml(this.notice)}</span>` : ''}
            </div>
            <div class="admin-content" role="tabpanel">
              ${this.renderActiveTab()}
            </div>
          </section>
        </main>
      </div>
    `
    this.bindAdminActions()
  }

  private renderGate(): string {
    const content = this.view === 'checking'
      ? `
          <span class="spinner spinner--green" aria-hidden="true"></span>
          <p class="eyebrow">Administração</p>
          <h1>Validando acesso</h1>
          <p class="auth-card__subtitle">Verificando sua autorização no servidor…</p>
        `
      : this.view === 'signed-out'
        ? `
            <span class="message-icon message-icon--warning" aria-hidden="true">!</span>
            <p class="eyebrow">Administração</p>
            <h1>Entre primeiro</h1>
            <p class="auth-card__subtitle">Faça login no AltGrid antes de acessar o painel.</p>
            <a class="button button--primary" href="/">Ir para o login</a>
          `
        : this.view === 'denied'
          ? `
              <span class="message-icon message-icon--warning" aria-hidden="true">!</span>
              <p class="eyebrow">Acesso protegido</p>
              <h1>Acesso não autorizado</h1>
              <p class="auth-card__subtitle">Sua conta não possui permissão administrativa.</p>
              <a class="button button--secondary" href="/">Voltar ao AltGrid</a>
            `
          : `
              <span class="message-icon message-icon--warning" aria-hidden="true">!</span>
              <p class="eyebrow">Administração</p>
              <h1>Serviço indisponível</h1>
              <p class="auth-card__subtitle">${escapeHtml(this.error ?? 'Tente novamente em instantes.')}</p>
              <button class="button button--secondary" data-admin-retry type="button">Tentar novamente</button>
            `

    return `
      <div class="app-frame">
        <header class="topbar">
          <a class="brand admin-brand" href="/" aria-label="AltGrid">
            <img class="brand__logo" src="${altgridLogoUrl}" alt="" />
            <span class="brand__name">AltGrid</span>
          </a>
        </header>
        <main class="auth-stage">
          <section class="auth-card auth-card--message">${content}</section>
        </main>
      </div>
    `
  }

  private renderTab(tab: AdminTab, label: string): string {
    const active = tab === this.activeTab
    return `
      <button
        class="admin-tab ${active ? 'is-active' : ''}"
        data-admin-tab="${tab}"
        type="button"
        role="tab"
        aria-selected="${active}"
      >${label}</button>
    `
  }

  private renderActiveTab(): string {
    if (this.activeTab === 'users') {
      return this.renderUsers()
    }
    if (this.activeTab === 'games') {
      return this.renderGames()
    }
    if (this.activeTab === 'config') {
      return this.renderConfig()
    }
    if (this.activeTab === 'products') {
      return this.renderProducts()
    }
    if (this.activeTab === 'payments') {
      return this.renderPaymentLogs()
    }
    if (this.activeTab === 'announcements') {
      return this.renderAnnouncements()
    }
    if (this.activeTab === 'chat') {
      return this.renderChatReports()
    }
    return this.renderAudit()
  }

  private renderUsers(): string {
    return `
      <form class="admin-search" id="admin-user-search">
        <label class="visually-hidden" for="admin-search-query">Buscar usuário</label>
        <input
          id="admin-search-query"
          name="query"
          value="${escapeHtml(this.searchQuery)}"
          placeholder="E-mail, user ID ou referral code"
        />
        <button class="button button--secondary button--compact" type="submit">Buscar</button>
      </form>
      <div class="admin-split">
        <div class="admin-list-column">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead><tr><th>Usuário</th><th>Plano</th><th>Licença</th><th></th></tr></thead>
              <tbody>
                ${this.users.length > 0
                  ? this.users.map((user) => this.renderUserRow(user)).join('')
                  : '<tr><td colspan="4" class="admin-empty">Nenhum usuário encontrado.</td></tr>'}
              </tbody>
            </table>
          </div>
          ${this.renderPagination('users', this.usersPage, this.usersHasMore, this.usersTotal)}
        </div>
        ${this.selectedUser ? this.renderUserDetail(this.selectedUser) : `
          <aside class="admin-detail admin-detail--empty">
            <p>Selecione um usuário para ver licenças, dispositivos, chat e pagamentos.</p>
          </aside>
        `}
      </div>
    `
  }

  private renderUserRow(user: AdminUserSummary): string {
    return `
      <tr>
        <td>
          <strong>${escapeHtml(user.email ?? 'Sem e-mail')}</strong>
          <small>${escapeHtml(user.id)}</small>
          <small>Referral code: ${escapeHtml(user.referral_code)}</small>
        </td>
        <td><span class="admin-plan">${escapeHtml(user.plan)}</span></td>
        <td>${escapeHtml(user.license_status ?? 'FREE')}</td>
        <td><button class="text-button text-button--strong" data-admin-user="${escapeHtml(user.id)}" type="button">Detalhes</button></td>
      </tr>
    `
  }

  private renderUserDetail(user: AdminUserDetail): string {
    const activeLicenses = user.licenses.filter((license) => license.status === 'active')
    const chatRestricted = user.chat_status.banned || Boolean(user.chat_status.muted_until)
    return `
      <aside class="admin-detail" aria-label="Detalhes de ${escapeHtml(user.email ?? user.id)}">
        <div class="admin-detail__heading">
          <div>
            <strong>${escapeHtml(user.email ?? 'Sem e-mail')}</strong>
            <small>${escapeHtml(user.id)}</small>
          </div>
          <span class="admin-plan">${escapeHtml(user.plan)}</span>
        </div>
        <dl class="admin-facts">
          <div><dt>Status</dt><dd>${escapeHtml(user.license_status ?? 'FREE')}</dd></div>
          <div><dt>Expira</dt><dd>${escapeHtml(formatDate(user.expires_at))}</dd></div>
          <div><dt>Lifetime</dt><dd>${user.lifetime ? 'Sim' : 'Não'}</dd></div>
          <div><dt>Founder</dt><dd>${escapeHtml(user.founder_number ?? '—')}</dd></div>
          <div><dt>Cadastro</dt><dd>${escapeHtml(formatDate(user.created_at))}</dd></div>
          <div><dt>Referral code</dt><dd>${escapeHtml(user.referral_code)}</dd></div>
        </dl>
        <div class="admin-action-grid">
          <form data-user-action="grant-days" data-user-id="${escapeHtml(user.id)}">
            <label>Dias de PRO <input name="days" type="number" min="1" max="3650" value="30" required /></label>
            <button class="button button--secondary button--compact" type="submit">Conceder</button>
          </form>
          <form data-user-action="set-plan" data-user-id="${escapeHtml(user.id)}">
            <label>Plano <select name="plan">${this.renderPlanOptions(user.plan, true)}</select></label>
            <label>Expira <input name="expires_at" type="datetime-local" value="${escapeHtml(toDatetimeLocal(user.expires_at))}" /></label>
            <label>Nº Founder <input name="founder_number" type="number" min="1" max="1000000" value="${escapeHtml(user.founder_number ?? '')}" /></label>
            <small>Plano temporário sem data recebe 30 dias.</small>
            <button class="button button--secondary button--compact" type="submit">Trocar</button>
          </form>
          <form data-user-action="lifetime" data-user-id="${escapeHtml(user.id)}">
            <label>Lifetime <select name="plan">${this.renderPlanOptions('PRO', false)}</select></label>
            <label>Nº Founder <input name="founder_number" type="number" min="1" max="1000000" value="${escapeHtml(user.founder_number ?? '')}" /></label>
            <button class="button button--secondary button--compact" type="submit">Ativar</button>
          </form>
        </div>
        <section class="admin-detail-section">
          <h3>Licenças</h3>
          ${activeLicenses.length > 0
            ? activeLicenses.map((license) => `
                <div class="admin-record">
                  <span>${escapeHtml(license.plan)} · ${escapeHtml(license.status)} · ${escapeHtml(formatDate(license.expires_at))}</span>
                  <button class="text-button admin-danger" data-revoke-license="${escapeHtml(license.id)}" type="button">Revogar</button>
                </div>
              `).join('')
            : '<p class="admin-empty">Nenhuma licença ativa.</p>'}
        </section>
        <section class="admin-detail-section">
          <h3>Devices</h3>
          ${user.devices.length > 0
            ? user.devices.map((device) => `
                <div class="admin-record">
                  <span>${escapeHtml(device.display_name ?? device.platform ?? 'Dispositivo')} · ${escapeHtml(formatDate(device.last_seen_at))}${device.revoked_at ? ' · revogado' : ''}</span>
                  <span>
                    ${device.revoked_at ? '' : `<button class="text-button admin-danger" data-revoke-device="${escapeHtml(device.id)}" type="button">Revogar</button>`}
                    <button class="text-button" data-reset-device="${escapeHtml(device.id)}" type="button">Resetar</button>
                  </span>
                </div>
              `).join('')
            : '<p class="admin-empty">Nenhum device.</p>'}
        </section>
        <section class="admin-detail-section">
          <h3>Indicações</h3>
          ${user.referrals.length > 0
            ? user.referrals.map((referral) => `
                <article class="admin-referral-record">
                  <div class="admin-referral-record__heading">
                    <strong>${escapeHtml(referral.status)}</strong>
                    <small>ID ${escapeHtml(referral.id)}</small>
                  </div>
                  <dl class="admin-referral-facts">
                    <div><dt>Quem indicou</dt><dd>${escapeHtml(referral.referrer_user_id)}</dd></div>
                    <div><dt>Usuário indicado</dt><dd>${escapeHtml(referral.referred_user_id)}</dd></div>
                    <div><dt>Criada</dt><dd>${escapeHtml(formatDate(referral.created_at))}</dd></div>
                    <div><dt>Qualificada</dt><dd>${escapeHtml(formatDate(referral.qualified_at))}</dd></div>
                    <div><dt>Recompensada</dt><dd>${escapeHtml(formatDate(referral.rewarded_at))}</dd></div>
                    ${referral.qualification_reason
                      ? `<div><dt>Motivo</dt><dd>${escapeHtml(referral.qualification_reason)}</dd></div>`
                      : ''}
                  </dl>
                </article>
              `).join('')
            : '<p class="admin-empty">Nenhuma indicação encontrada.</p>'}
        </section>
        <section class="admin-detail-section">
          <h3>Moderação do chat</h3>
          <div class="admin-record admin-record--stacked">
            <span>${user.chat_status.banned
              ? 'Banido'
              : user.chat_status.muted_until
                ? `Silenciado até ${escapeHtml(formatDate(user.chat_status.muted_until))}`
                : 'Sem restrição ativa'}${user.chat_status.reason
                  ? ` · ${escapeHtml(user.chat_status.reason)}`
                  : ''}</span>
          </div>
          ${this.renderChatRestrictionForm(user.id, chatRestricted)}
        </section>
        <section class="admin-detail-section">
          <h3>Pagamentos</h3>
          ${user.payments.length > 0
            ? user.payments.map((payment) => `
                <div class="admin-record"><span>${escapeHtml(payment.product_code)} · ${escapeHtml(formatMoney(payment.amount, payment.currency))} · ${escapeHtml(payment.status)}</span><small>${escapeHtml(formatDate(payment.created_at))}</small></div>
              `).join('')
            : '<p class="admin-empty">Nenhum pagamento.</p>'}
        </section>
      </aside>
    `
  }

  private renderPlanOptions(selected: PlanCode, includeFree: boolean): string {
    return (includeFree ? ['FREE', 'PRO', 'FOUNDER'] : ['PRO', 'FOUNDER'])
      .map((plan) => `<option value="${plan}" ${plan === selected ? 'selected' : ''}>${plan}</option>`)
      .join('')
  }

  private renderChatRestrictionForm(
    userId: string,
    canClear: boolean,
    suggestedReason = '',
  ): string {
    const muteUntil = toDatetimeLocal(
      new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    )
    return `
      <form class="admin-moderation-form" data-chat-restriction data-user-id="${escapeHtml(userId)}">
        <label>Ação
          <select name="kind">
            <option value="mute">Silenciar</option>
            <option value="ban">Banir</option>
          </select>
        </label>
        <label>Motivo
          <input name="reason" maxlength="500" value="${escapeHtml(suggestedReason)}" required />
        </label>
        <label>Silenciar até
          <input name="expires_at" type="datetime-local" value="${escapeHtml(muteUntil)}" />
        </label>
        <div class="admin-moderation-form__actions">
          <button class="button button--secondary button--compact" type="submit">Aplicar restrição</button>
          ${canClear
            ? `<button class="text-button" data-clear-chat-restriction="${escapeHtml(userId)}" type="button">Limpar restrição</button>`
            : ''}
        </div>
      </form>
    `
  }

  private renderGames(): string {
    const editing = this.games.find((game) => game.id === this.editingGameId) ?? null
    return `
      <form class="admin-editor" id="admin-game-form">
        <div class="admin-editor__heading">
          <h2>${editing ? 'Editar jogo' : 'Adicionar jogo'}</h2>
          ${editing ? '<button class="text-button" data-cancel-game-edit type="button">Cancelar edição</button>' : ''}
        </div>
        <div class="admin-form-grid">
          ${this.renderAdminField('name', 'Nome', editing?.name ?? '', true)}
          ${this.renderAdminField('slug', 'Slug', editing?.slug ?? '', true)}
          ${this.renderAdminField('launch_url', 'Launch URL', editing?.launch_url ?? '', true, 'url')}
          ${this.renderAdminField('developer_referral_url', 'URL de indicação do desenvolvedor', editing?.developer_referral_url ?? '', false, 'url')}
          ${this.renderAdminField('icon_url', 'Icon URL', editing?.icon_url ?? '', false, 'url')}
          ${this.renderAdminField('sort_order', 'Ordem', String(editing?.sort_order ?? 0), true, 'number')}
        </div>
        <label class="admin-checkbox"><input name="enabled" type="checkbox" ${editing?.enabled === false ? '' : 'checked'} /> Ativo</label>
        <button class="button button--primary button--compact" type="submit">${editing ? 'Salvar alterações' : 'Adicionar jogo'}</button>
      </form>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Jogo</th><th>Slug</th><th>Ordem</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${this.games.length > 0
              ? this.games.map((game) => `
                  <tr>
                    <td><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml(game.launch_url)}</small></td>
                    <td>${escapeHtml(game.slug)}</td>
                    <td>${game.sort_order}</td>
                    <td>${game.enabled ? 'Ativo' : 'Desativado'}</td>
                    <td class="admin-row-actions">
                      <button class="text-button" data-edit-game="${escapeHtml(game.id)}" type="button">Editar</button>
                      <button class="text-button ${game.enabled ? 'admin-danger' : 'text-button--strong'}" data-toggle-game="${escapeHtml(game.id)}" data-enabled="${String(!game.enabled)}" type="button">${game.enabled ? 'Desativar' : 'Ativar'}</button>
                    </td>
                  </tr>
                `).join('')
              : '<tr><td colspan="5" class="admin-empty">Nenhum jogo cadastrado.</td></tr>'}
          </tbody>
        </table>
      </div>
    `
  }

  private renderAdminField(
    name: string,
    label: string,
    value: string,
    required: boolean,
    type = 'text',
    step?: string,
  ): string {
    return `
      <label>${escapeHtml(label)}
        <input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" ${step ? `step="${escapeHtml(step)}"` : ''} ${required ? 'required' : ''} />
      </label>
    `
  }

  private renderConfig(): string {
    const rawValueFor = (key: string): Json | undefined =>
      this.config.find((entry) => entry.key === key)?.value
    const valueFor = (key: string): string => {
      const value = rawValueFor(key)
      return value === null || value === undefined ? '' : String(value)
    }
    const updateChannel = valueFor('update_channel') === 'stable'
      ? 'stable'
      : 'beta'

    return `
      <form class="admin-editor" id="admin-config-form">
        <div class="admin-editor__heading">
          <div>
            <h2>Configuração</h2>
            <small>Parâmetros gerais do aplicativo e das indicações.</small>
          </div>
        </div>
        <div class="admin-form-grid admin-config-grid">
          ${this.renderAdminField('referral_referrer_days', 'Dias para quem indicou', valueFor('referral_referrer_days'), true, 'number')}
          ${this.renderAdminField('referral_referred_days', 'Dias para o usuário indicado', valueFor('referral_referred_days'), true, 'number')}
          ${this.renderAdminField('founder_max_sales', 'Máximo de vendas Founder', valueFor('founder_max_sales'), false, 'number')}
          ${this.renderAdminField('minimum_version', 'Versão mínima', valueFor('minimum_version'), true)}
          ${this.renderAdminField('latest_version', 'Versão mais recente', valueFor('latest_version'), true)}
          <label>Canal de atualização
            <select name="update_channel">
              <option value="beta" ${updateChannel === 'beta' ? 'selected' : ''}>Beta</option>
              <option value="stable" ${updateChannel === 'stable' ? 'selected' : ''}>Estável</option>
            </select>
          </label>
        </div>
        <label class="admin-checkbox admin-config-maintenance">
          <input name="maintenance" type="checkbox" ${rawValueFor('maintenance') === true ? 'checked' : ''} />
          Modo de manutenção
        </label>
        <button class="button button--primary button--compact" type="submit">Salvar configuração</button>
      </form>
    `
  }

  private renderProducts(): string {
    const allowed = this.products.filter((product) =>
      ['PRO_LIFETIME', 'PRO_PLUS_LIFETIME', 'PRO_PLUS_UPGRADE', 'FOUNDER_LIFETIME', 'FOUNDER_UPGRADE', 'PLUS_FOUNDER_UPGRADE'].includes(product.code))
    return `
      <div class="admin-product-list">
        ${allowed.length > 0
          ? allowed.map((product) => `
              <form class="admin-editor admin-product" data-admin-product="${escapeHtml(product.id)}">
                <div class="admin-editor__heading">
                  <div><h2>${escapeHtml(product.code)}</h2><small>${escapeHtml(product.name)}</small></div>
                  <span>${product.enabled ? 'Ativo' : 'Desativado'}</span>
                </div>
                <div class="admin-form-grid admin-form-grid--product">
                  ${this.renderAdminField('price_amount', 'Preço', product.price_amount === null ? '' : String(product.price_amount), false, 'number', '0.01')}
                  ${this.renderAdminField('currency', 'Moeda', product.currency, true)}
                </div>
                <label class="admin-checkbox"><input name="enabled" type="checkbox" ${product.enabled ? 'checked' : ''} /> Disponível</label>
                <button class="button button--primary button--compact" type="submit">Salvar produto</button>
              </form>
            `).join('')
          : '<p class="admin-empty">Produtos lifetime não encontrados.</p>'}
      </div>
    `
  }

  private renderAnnouncements(): string {
    const editing = this.announcements.find(
      (announcement) => announcement.id === this.editingAnnouncementId,
    ) ?? null
    const publishedAt = editing?.published_at ?? new Date().toISOString()

    return `
      <form class="admin-editor" id="admin-announcement-form">
        <div class="admin-editor__heading">
          <h2>${editing ? 'Editar aviso' : 'Publicar aviso'}</h2>
          ${editing
            ? '<button class="text-button" data-cancel-announcement-edit type="button">Cancelar edição</button>'
            : ''}
        </div>
        <div class="admin-form-grid">
          <label>Título
            <input name="title" maxlength="160" value="${escapeHtml(editing?.title ?? '')}" required />
          </label>
          <label>Tipo
            <select name="type">
              ${this.renderAnnouncementTypeOptions(editing?.type ?? 'info')}
            </select>
          </label>
          <label>Publicar em
            <input name="published_at" type="datetime-local" value="${escapeHtml(toDatetimeLocal(publishedAt))}" required />
          </label>
          <label>Expirar em
            <input name="expires_at" type="datetime-local" value="${escapeHtml(toDatetimeLocal(editing?.expires_at ?? null))}" />
          </label>
          <label class="admin-form-field--wide">Mensagem
            <textarea name="message" maxlength="4000" rows="5" required>${escapeHtml(editing?.message ?? '')}</textarea>
          </label>
        </div>
        <label class="admin-checkbox"><input name="enabled" type="checkbox" ${editing?.enabled === false ? '' : 'checked'} /> Visível no aplicativo</label>
        <button class="button button--primary button--compact" type="submit">${editing ? 'Salvar aviso' : 'Publicar aviso'}</button>
      </form>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Aviso</th><th>Tipo</th><th>Publicação</th><th>Expiração</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${this.announcements.length > 0
              ? this.announcements.map((announcement) => `
                  <tr>
                    <td><strong>${escapeHtml(announcement.title)}</strong><small>${escapeHtml(announcement.message)}</small></td>
                    <td>${escapeHtml(this.announcementTypeLabel(announcement.type))}</td>
                    <td>${escapeHtml(formatDate(announcement.published_at))}</td>
                    <td>${escapeHtml(formatDate(announcement.expires_at))}</td>
                    <td>${announcement.enabled ? 'Ativo' : 'Desativado'}</td>
                    <td class="admin-row-actions">
                      <button class="text-button" data-edit-announcement="${escapeHtml(announcement.id)}" type="button">Editar</button>
                      <button class="text-button ${announcement.enabled ? 'admin-danger' : 'text-button--strong'}" data-toggle-announcement="${escapeHtml(announcement.id)}" data-enabled="${String(!announcement.enabled)}" type="button">${announcement.enabled ? 'Desativar' : 'Ativar'}</button>
                      <button class="text-button admin-danger" data-delete-announcement="${escapeHtml(announcement.id)}" type="button">Excluir</button>
                    </td>
                  </tr>
                `).join('')
              : '<tr><td colspan="6" class="admin-empty">Nenhum aviso cadastrado.</td></tr>'}
          </tbody>
        </table>
      </div>
    `
  }

  private renderAnnouncementTypeOptions(selected: AdminAnnouncementType): string {
    return (['info', 'warning', 'maintenance'] as const)
      .map((type) => `
        <option value="${type}" ${type === selected ? 'selected' : ''}>${escapeHtml(this.announcementTypeLabel(type))}</option>
      `)
      .join('')
  }

  private announcementTypeLabel(type: AdminAnnouncementType): string {
    return ({
      info: 'Informação',
      maintenance: 'Manutenção',
      warning: 'Alerta',
    })[type]
  }

  private renderChatReports(): string {
    return `
      <div class="admin-content__toolbar">
        <div><strong>Moderação do chat</strong><small>O conteúdo será ocultado para todos os usuários.</small></div>
        <button class="button button--secondary admin-danger" data-clear-chat type="button">Limpar todo o chat</button>
      </div>
      <form class="admin-search" id="admin-chat-filter">
        <label>Status
          <select name="status">
            ${this.renderChatStatusOption(null, 'Todos')}
            ${this.renderChatStatusOption('pending', 'Pendentes')}
            ${this.renderChatStatusOption('reviewed', 'Revisados')}
            ${this.renderChatStatusOption('dismissed', 'Dispensados')}
            ${this.renderChatStatusOption('actioned', 'Com ação aplicada')}
          </select>
        </label>
        <button class="button button--secondary button--compact" type="submit">Filtrar</button>
      </form>
      <div class="admin-report-list">
        ${this.chatReports.length > 0
          ? this.chatReports.map((report) => this.renderChatReport(report)).join('')
          : '<p class="admin-empty">Nenhuma denúncia encontrada.</p>'}
      </div>
    `
  }

  private renderChatStatusOption(
    status: AdminChatReportStatus | null,
    label: string,
  ): string {
    return `<option value="${status ?? ''}" ${status === this.chatReportStatus ? 'selected' : ''}>${escapeHtml(label)}</option>`
  }

  private renderChatReport(report: AdminChatReport): string {
    const message = report.message
    const targetUserId = message?.user_id ?? null
    const reviewActions: Array<{
      label: string
      status: Exclude<AdminChatReportStatus, 'pending'>
    }> = [
      { label: 'Marcar revisado', status: 'reviewed' },
      { label: 'Dispensar', status: 'dismissed' },
      { label: 'Registrar ação', status: 'actioned' },
    ]

    return `
      <article class="admin-report">
        <div class="admin-report__heading">
          <div>
            <strong>Denúncia ${escapeHtml(report.id)}</strong>
            <small>${escapeHtml(formatDate(report.created_at))} · status: ${escapeHtml(report.status)}</small>
          </div>
          <span class="admin-plan">${escapeHtml(report.status)}</span>
        </div>
        <dl class="admin-facts admin-facts--report">
          <div><dt>Denunciante</dt><dd>${escapeHtml(report.reported_by)}</dd></div>
          <div><dt>Autor</dt><dd>${escapeHtml(targetUserId ?? 'Mensagem indisponível')}</dd></div>
          <div><dt>Canal</dt><dd>${escapeHtml(message?.channel_id ?? '—')}</dd></div>
        </dl>
        <div class="admin-report__reason"><strong>Motivo</strong><p>${escapeHtml(report.reason)}</p></div>
        <blockquote class="admin-report__message ${message?.deleted_at ? 'is-deleted' : ''}">
          ${message
            ? escapeHtml(message.deleted_at ? 'Mensagem já excluída.' : message.message)
            : 'A mensagem não está mais disponível.'}
        </blockquote>
        <div class="admin-report__actions">
          ${reviewActions
            .filter((action) => action.status !== report.status)
            .map((action) => `
              <button class="text-button" data-review-chat-report="${escapeHtml(report.id)}" data-status="${action.status}" type="button">${action.label}</button>
            `).join('')}
          ${message && !message.deleted_at
            ? `<button class="text-button admin-danger" data-delete-chat-message="${escapeHtml(message.id)}" type="button">Excluir mensagem</button>`
            : ''}
        </div>
        ${targetUserId
          ? this.renderChatRestrictionForm(
              targetUserId,
              true,
              `Denúncia: ${report.reason}`.slice(0, 500),
            )
          : ''}
      </article>
    `
  }

  private renderPaymentLogs(): string {
    return `
      <div class="admin-list-column">
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>Quando</th><th>Usuário</th><th>Produto</th><th>Valor</th><th>Status</th><th>Pago em</th><th>Ativado em</th><th>Falha</th><th>Ação</th></tr></thead>
            <tbody>
              ${this.paymentLogs.length > 0
                ? this.paymentLogs.map((payment) => `
                    <tr>
                      <td>${escapeHtml(formatDate(payment.created_at))}</td>
                      <td><small>${escapeHtml(payment.user_id)}</small></td>
                      <td>${escapeHtml(payment.product_code)}</td>
                      <td>${escapeHtml(formatMoney(payment.amount, payment.currency))}</td>
                      <td><strong>${escapeHtml(payment.status)}</strong></td>
                      <td>${payment.paid_at ? escapeHtml(formatDate(payment.paid_at)) : '—'}</td>
                      <td>${payment.fulfilled_at ? escapeHtml(formatDate(payment.fulfilled_at)) : '—'}</td>
                      <td>${escapeHtml(payment.failure_reason ?? '—')}</td>
                      <td>${payment.provider_payment_id && ['pending', 'in_process'].includes(payment.status)
                        ? `<button class="text-button" data-reconcile-payment="${escapeHtml(payment.id)}" type="button">Consultar Mercado Pago</button>`
                        : '—'}</td>
                    </tr>
                  `).join('')
                : '<tr><td colspan="9" class="admin-empty">Nenhum pagamento registrado.</td></tr>'}
            </tbody>
          </table>
        </div>
        ${this.renderPagination('payments', this.paymentPage, this.paymentHasMore, this.paymentTotal)}
      </div>
    `
  }

  private renderAudit(): string {
    return `
      <div class="admin-list-column">
        <div class="admin-table-wrap">
          <table class="admin-table admin-table--audit">
            <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th><th>Alterações</th></tr></thead>
            <tbody>
              ${this.auditEntries.length > 0
                ? this.auditEntries.map((entry) => `
                    <tr>
                      <td>${escapeHtml(formatDate(entry.created_at))}</td>
                      <td><small>${escapeHtml(entry.actor_user_id)}</small></td>
                      <td>${escapeHtml(entry.action)}</td>
                      <td>${escapeHtml(entry.target_type)}<small>${escapeHtml(entry.target_id ?? '')}</small></td>
                      <td>
                        <details><summary>Ver</summary><pre>${escapeHtml(`Antes:\n${jsonPreview(entry.before_data)}\n\nDepois:\n${jsonPreview(entry.after_data)}`)}</pre></details>
                      </td>
                    </tr>
                  `).join('')
                : '<tr><td colspan="5" class="admin-empty">Nenhuma ação registrada.</td></tr>'}
            </tbody>
          </table>
        </div>
        ${this.renderPagination('audit', this.auditPage, this.auditHasMore, this.auditTotal)}
      </div>
    `
  }

  private renderPagination(
    scope: 'audit' | 'payments' | 'users',
    page: number,
    hasMore: boolean,
    total: number,
  ): string {
    return `
      <div class="admin-pagination" aria-label="Paginação">
        <span>Página ${page} · ${total} ${scope === 'users' ? 'usuários' : scope === 'payments' ? 'pagamentos' : 'registros'}</span>
        <div>
          <button class="text-button" data-admin-page="${scope}-previous" type="button" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
          <button class="text-button" data-admin-page="${scope}-next" type="button" ${hasMore ? '' : 'disabled'}>Próxima</button>
        </div>
      </div>
    `
  }

  private bindGateActions(): void {
    this.root.querySelector<HTMLButtonElement>('[data-admin-retry]')
      ?.addEventListener('click', () => {
        if (this.session) {
          void this.authorize(this.session)
        } else {
          void this.start()
        }
      })
  }

  private bindAdminActions(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-admin-tab]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const tab = button.dataset.adminTab as AdminTab | undefined
          if (tab && tab !== this.activeTab) {
            this.notice = null
            void this.loadTab(tab)
          }
        })
      })

    this.root.querySelector<HTMLButtonElement>('[data-admin-sign-out]')
      ?.addEventListener('click', () => {
        void this.authService.signOut().catch((error) => {
          this.error = adminErrorMessage(error)
          this.render()
        })
      })

    this.root.querySelector<HTMLFormElement>('#admin-user-search')
      ?.addEventListener('submit', (event) => {
        event.preventDefault()
        const form = event.currentTarget as HTMLFormElement
        this.searchQuery = String(new FormData(form).get('query') ?? '').trim()
        this.usersPage = 1
        this.selectedUser = null
        void this.loadTab('users')
      })

    this.root.querySelectorAll<HTMLButtonElement>('[data-admin-page]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.dataset.adminPage
          if (action === 'users-previous' && this.usersPage > 1) {
            this.usersPage -= 1
            void this.loadTab('users')
          } else if (action === 'users-next' && this.usersHasMore) {
            this.usersPage += 1
            void this.loadTab('users')
          } else if (action === 'audit-previous' && this.auditPage > 1) {
            this.auditPage -= 1
            void this.loadTab('audit')
          } else if (action === 'audit-next' && this.auditHasMore) {
            this.auditPage += 1
            void this.loadTab('audit')
          } else if (action === 'payments-previous' && this.paymentPage > 1) {
            this.paymentPage -= 1
            void this.loadTab('payments')
          } else if (action === 'payments-next' && this.paymentHasMore) {
            this.paymentPage += 1
            void this.loadTab('payments')
          }
        })
      })

    this.root.querySelectorAll<HTMLButtonElement>('[data-admin-user]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          if (button.dataset.adminUser) {
            void this.loadUser(button.dataset.adminUser)
          }
        })
      })

    this.root.querySelectorAll<HTMLFormElement>('[data-user-action]')
      .forEach((form) => {
        form.addEventListener('submit', (event) => {
          event.preventDefault()
          void this.performUserAction(form)
        })
      })

    this.bindMutationButtons('[data-revoke-license]', async (button) => {
      await this.backend.revokeAdminLicense(button.dataset.revokeLicense!)
      await this.refreshSelectedUser('Licença revogada.')
    })
    this.bindMutationButtons('[data-revoke-device]', async (button) => {
      await this.backend.revokeAdminDevice(button.dataset.revokeDevice!)
      await this.refreshSelectedUser('Device revogado.')
    })
    this.bindMutationButtons('[data-reset-device]', async (button) => {
      await this.backend.resetAdminDevice(button.dataset.resetDevice!)
      await this.refreshSelectedUser('Device resetado.')
    })
    this.bindMutationButtons('[data-reconcile-payment]', async (button) => {
      const result = await this.backend.reconcileAdminPayment(
        button.dataset.reconcilePayment!,
      )
      this.notice = `Pagamento consultado: ${result.payment.status}.`
      await this.loadTab('payments')
    })
    this.root.querySelectorAll<HTMLFormElement>('[data-chat-restriction]')
      .forEach((form) => {
        form.addEventListener('submit', (event) => {
          event.preventDefault()
          void this.saveChatRestriction(form)
        })
      })
    this.bindMutationButtons('[data-clear-chat-restriction]', async (button) => {
      const userId = button.dataset.clearChatRestriction
      if (!userId) {
        return
      }
      await this.backend.clearAdminChatRestriction(userId)
      await this.refreshModerationSurface('Restrição de chat removida.')
    })

    this.root.querySelector<HTMLFormElement>('#admin-game-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault()
        void this.saveGame(event.currentTarget as HTMLFormElement)
      })
    this.root.querySelector<HTMLButtonElement>('[data-cancel-game-edit]')
      ?.addEventListener('click', () => {
        this.editingGameId = null
        this.render()
      })
    this.root.querySelectorAll<HTMLButtonElement>('[data-edit-game]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          this.editingGameId = button.dataset.editGame ?? null
          this.error = null
          this.render()
        })
      })
    this.bindMutationButtons('[data-toggle-game]', async (button) => {
      await this.backend.updateAdminGame(button.dataset.toggleGame!, {
        enabled: button.dataset.enabled === 'true',
      })
      this.notice = 'Status do jogo atualizado.'
      await this.loadTab('games')
    })

    this.root.querySelector<HTMLFormElement>('#admin-config-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault()
        void this.saveConfig(event.currentTarget as HTMLFormElement)
      })

    this.root.querySelectorAll<HTMLFormElement>('[data-admin-product]')
      .forEach((form) => {
        form.addEventListener('submit', (event) => {
          event.preventDefault()
          void this.saveProduct(form)
        })
      })

    this.root.querySelector<HTMLFormElement>('#admin-announcement-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault()
        void this.saveAnnouncement(event.currentTarget as HTMLFormElement)
      })
    this.root.querySelector<HTMLButtonElement>('[data-cancel-announcement-edit]')
      ?.addEventListener('click', () => {
        this.editingAnnouncementId = null
        this.error = null
        this.render()
      })
    this.root.querySelectorAll<HTMLButtonElement>('[data-edit-announcement]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          this.editingAnnouncementId = button.dataset.editAnnouncement ?? null
          this.error = null
          this.render()
        })
      })
    this.bindMutationButtons('[data-toggle-announcement]', async (button) => {
      await this.backend.updateAdminAnnouncement(
        button.dataset.toggleAnnouncement!,
        { enabled: button.dataset.enabled === 'true' },
      )
      this.notice = 'Status do aviso atualizado.'
      await this.loadTab('announcements')
    })
    this.bindMutationButtons('[data-delete-announcement]', async (button) => {
      if (!this.confirmAction('Excluir este aviso permanentemente?')) {
        return
      }
      const announcementId = button.dataset.deleteAnnouncement!
      await this.backend.deleteAdminAnnouncement(announcementId)
      if (this.editingAnnouncementId === announcementId) {
        this.editingAnnouncementId = null
      }
      this.notice = 'Aviso excluído.'
      await this.loadTab('announcements')
    })

    this.root.querySelector<HTMLFormElement>('#admin-chat-filter')
      ?.addEventListener('submit', (event) => {
        event.preventDefault()
        const value = String(
          new FormData(event.currentTarget as HTMLFormElement).get('status') ?? '',
        )
        this.chatReportStatus = value
          ? value as AdminChatReportStatus
          : null
        void this.loadTab('chat')
      })
    this.bindMutationButtons('[data-review-chat-report]', async (button) => {
      const status = button.dataset.status
      if (!status || !['reviewed', 'dismissed', 'actioned'].includes(status)) {
        return
      }
      await this.backend.reviewAdminChatReport(
        button.dataset.reviewChatReport!,
        status as Exclude<AdminChatReportStatus, 'pending'>,
      )
      this.notice = 'Denúncia atualizada.'
      await this.loadTab('chat')
    })
    this.bindMutationButtons('[data-delete-chat-message]', async (button) => {
      if (!this.confirmAction('Excluir esta mensagem do chat?')) {
        return
      }
      await this.backend.deleteAdminChatMessage(button.dataset.deleteChatMessage!)
      this.notice = 'Mensagem excluída.'
      await this.loadTab('chat')
    })
    this.bindMutationButtons('[data-clear-chat]', async () => {
      if (!this.confirmAction('Limpar todas as mensagens do chat? Esta ação oculta o histórico para todos os usuários.')) return
      await this.backend.clearAdminChat()
      this.notice = 'Chat limpo.'
      await this.loadTab('chat')
    })
  }

  private confirmAction(message: string): boolean {
    return typeof globalThis.confirm !== 'function' || globalThis.confirm(message)
  }

  private bindMutationButtons(
    selector: string,
    action: (button: HTMLButtonElement) => Promise<void>,
  ): void {
    this.root.querySelectorAll<HTMLButtonElement>(selector).forEach((button) => {
      button.addEventListener('click', () => {
        button.disabled = true
        void action(button).catch((error) => {
          this.error = adminErrorMessage(error)
          this.render()
        }).finally(() => {
          if (button.isConnected) {
            button.disabled = false
          }
        })
      })
    })
  }

  private async performUserAction(form: HTMLFormElement): Promise<void> {
    const action = form.dataset.userAction
    const userId = form.dataset.userId
    if (!action || !userId) {
      return
    }

    const data = new FormData(form)
    this.error = null
    form.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.disabled = true
    })

    try {
      if (action === 'grant-days') {
        const days = Number(data.get('days'))
        if (!Number.isInteger(days) || days < 1 || days > 3650) {
          throw new Error('invalid days')
        }
        await this.backend.grantAdminProDays(userId, days)
        await this.refreshSelectedUser(`${days} dias de PRO concedidos.`)
      } else if (action === 'set-plan') {
        const plan = String(data.get('plan')) as PlanCode
        if (!['FREE', 'PRO', 'FOUNDER'].includes(plan)) {
          throw new Error('invalid plan')
        }
        const rawExpiration = String(data.get('expires_at') ?? '').trim()
        const rawFounder = String(data.get('founder_number') ?? '').trim()
        const founderNumber = rawFounder ? Number(rawFounder) : undefined
        if (founderNumber !== undefined && (!Number.isInteger(founderNumber) || founderNumber < 1)) {
          throw new Error('invalid founder number')
        }
        if (plan !== 'FOUNDER' && founderNumber !== undefined) {
          throw new Error('founder number requires founder plan')
        }
        const expiration = rawExpiration
          ? new Date(rawExpiration).toISOString()
          : undefined
        await this.backend.setAdminPlan(userId, {
          plan,
          ...(expiration ? { expires_at: expiration } : {}),
          ...(founderNumber === undefined ? {} : { founder_number: founderNumber }),
        })
        await this.refreshSelectedUser('Plano atualizado.')
      } else {
        const plan = String(data.get('plan')) as 'FOUNDER' | 'PRO'
        if (!['PRO', 'FOUNDER'].includes(plan)) {
          throw new Error('invalid lifetime plan')
        }
        const rawFounder = String(data.get('founder_number') ?? '').trim()
        const founderNumber = rawFounder ? Number(rawFounder) : undefined
        if (founderNumber !== undefined && (!Number.isInteger(founderNumber) || founderNumber < 1)) {
          throw new Error('invalid founder number')
        }
        if (plan !== 'FOUNDER' && founderNumber !== undefined) {
          throw new Error('founder number requires founder lifetime')
        }
        await this.backend.activateAdminLifetime(userId, {
          plan,
          ...(founderNumber === undefined ? {} : { founder_number: founderNumber }),
        })
        await this.refreshSelectedUser('Plano lifetime ativado.')
      }
    } catch (error) {
      this.error = error instanceof BackendApiError
        ? error.message
        : 'Revise os valores informados.'
      this.render()
    }
  }

  private async refreshSelectedUser(notice: string): Promise<void> {
    const userId = this.selectedUser?.id
    if (!userId) {
      return
    }
    const response = await this.backend.getAdminUser(userId)
    this.selectedUser = response.user
    this.notice = notice
    this.error = null
    this.render()
  }

  private async refreshModerationSurface(notice: string): Promise<void> {
    if (this.activeTab === 'users' && this.selectedUser) {
      await this.refreshSelectedUser(notice)
      return
    }

    this.notice = notice
    await this.loadTab('chat')
  }

  private async saveChatRestriction(form: HTMLFormElement): Promise<void> {
    const userId = form.dataset.userId
    if (!userId) {
      return
    }

    const data = new FormData(form)
    const kind = String(data.get('kind'))
    const reason = String(data.get('reason') ?? '').trim()
    const rawExpiration = String(data.get('expires_at') ?? '').trim()

    if (!['mute', 'ban'].includes(kind) || !reason || reason.length > 500) {
      this.error = 'Informe uma ação e um motivo de até 500 caracteres.'
      this.render()
      return
    }

    let expiresAt: string | null = null
    if (kind === 'mute') {
      const expiration = Date.parse(rawExpiration)
      if (!rawExpiration || !Number.isFinite(expiration) || expiration <= Date.now()) {
        this.error = 'Defina uma data futura para encerrar o silêncio.'
        this.render()
        return
      }
      expiresAt = new Date(expiration).toISOString()
    }

    const input: AdminChatRestrictionInput = {
      expires_at: expiresAt,
      kind: kind as AdminChatRestrictionInput['kind'],
      reason,
    }
    form.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.disabled = true
    })

    try {
      await this.backend.setAdminChatRestriction(userId, input)
      await this.refreshModerationSurface(
        kind === 'ban' ? 'Usuário banido do chat.' : 'Usuário silenciado no chat.',
      )
    } catch (error) {
      this.error = adminErrorMessage(error)
      this.render()
    }
  }

  private async saveAnnouncement(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form)
    const title = String(data.get('title') ?? '').trim()
    const message = String(data.get('message') ?? '').trim()
    const type = String(data.get('type'))
    const rawPublishedAt = String(data.get('published_at') ?? '').trim()
    const rawExpiresAt = String(data.get('expires_at') ?? '').trim()
    const publishedTimestamp = Date.parse(rawPublishedAt)
    const expiresTimestamp = rawExpiresAt ? Date.parse(rawExpiresAt) : null

    if (
      !title
      || title.length > 160
      || !message
      || message.length > 4_000
      || !['info', 'warning', 'maintenance'].includes(type)
      || !Number.isFinite(publishedTimestamp)
      || (expiresTimestamp !== null && !Number.isFinite(expiresTimestamp))
      || (expiresTimestamp !== null && expiresTimestamp <= publishedTimestamp)
    ) {
      this.error = 'Revise título, mensagem, tipo e período do aviso.'
      this.render()
      return
    }

    const input: AdminAnnouncementInput = {
      enabled: data.get('enabled') === 'on',
      expires_at: expiresTimestamp === null
        ? null
        : new Date(expiresTimestamp).toISOString(),
      message,
      published_at: new Date(publishedTimestamp).toISOString(),
      title,
      type: type as AdminAnnouncementType,
    }
    form.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.disabled = true
    })

    try {
      if (this.editingAnnouncementId) {
        await this.backend.updateAdminAnnouncement(
          this.editingAnnouncementId,
          input,
        )
        this.notice = 'Aviso atualizado.'
      } else {
        await this.backend.createAdminAnnouncement(input)
        this.notice = 'Aviso publicado.'
      }
      this.editingAnnouncementId = null
      await this.loadTab('announcements')
    } catch (error) {
      this.error = adminErrorMessage(error)
      this.render()
    }
  }

  private async saveGame(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form)
    const launch = validateSafeGameUrl(data.get('launch_url'))
    const referralValue = String(data.get('developer_referral_url') ?? '').trim()
    const iconValue = String(data.get('icon_url') ?? '').trim()
    const referral = referralValue ? validateSafeGameUrl(referralValue) : null
    const icon = iconValue ? validateSafeGameUrl(iconValue) : null

    if (!launch.ok || (referral && !referral.ok) || (icon && !icon.ok)) {
      this.error = 'Use URLs HTTPS válidas. HTTP é aceito somente em localhost.'
      this.render()
      return
    }

    const sortOrder = Number(data.get('sort_order'))
    const input = {
      developer_referral_url: referral?.ok ? referral.url : null,
      enabled: data.get('enabled') === 'on',
      icon_url: icon?.ok ? icon.url : null,
      launch_url: launch.url,
      name: String(data.get('name') ?? '').trim(),
      slug: String(data.get('slug') ?? '').trim().toLocaleLowerCase(),
      sort_order: Number.isInteger(sortOrder) ? sortOrder : 0,
    }

    if (!input.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
      this.error = 'Informe nome e slug válido para o jogo.'
      this.render()
      return
    }

    try {
      if (this.editingGameId) {
        await this.backend.updateAdminGame(this.editingGameId, input)
        this.notice = 'Jogo atualizado.'
      } else {
        await this.backend.createAdminGame(input)
        this.notice = 'Jogo adicionado.'
      }
      this.editingGameId = null
      await this.loadTab('games')
    } catch (error) {
      this.error = adminErrorMessage(error)
      this.render()
    }
  }

  private async saveConfig(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form)

    try {
      const updates: Array<readonly [string, Json]> = []

      for (const { key, maximum, minimum } of INTEGER_CONFIG_FIELDS) {
        const raw = String(data.get(key) ?? '').trim()
        const nullable = key === 'founder_max_sales'
        const value = raw === '' && nullable ? null : Number(raw)

        if (
          (value === null && !nullable)
          || (value !== null && (
            !Number.isInteger(value)
            || value < minimum
            || value > maximum
          ))
        ) {
          throw new Error('invalid numeric config')
        }

        updates.push([key, value])
      }

      for (const key of VERSION_CONFIG_KEYS) {
        const value = String(data.get(key) ?? '').trim()
        if (!SEMVER_PATTERN.test(value)) {
          throw new Error('invalid version config')
        }
        updates.push([key, value])
      }

      const updateChannel = String(data.get('update_channel') ?? '')
      if (updateChannel !== 'beta' && updateChannel !== 'stable') {
        throw new Error('invalid update channel')
      }
      updates.push(
        ['maintenance', data.get('maintenance') === 'on'],
        ['update_channel', updateChannel],
      )

      for (const [key, value] of updates) {
        await this.backend.updateAdminConfig(key, value)
      }

      this.notice = 'Configuração atualizada.'
      await this.loadTab('config')
    } catch (error) {
      this.error = error instanceof BackendApiError
        ? error.message
        : 'Revise os dias, limites, versões e o canal de atualização.'
      this.render()
    }
  }

  private async saveProduct(form: HTMLFormElement): Promise<void> {
    const productId = form.dataset.adminProduct
    if (!productId) {
      return
    }

    const data = new FormData(form)
    const rawPrice = String(data.get('price_amount') ?? '').trim()
    const price = rawPrice ? Number(rawPrice) : null
    const currency = String(data.get('currency') ?? '').trim().toLocaleUpperCase()

    if ((price !== null && (!Number.isFinite(price) || price < 0)) || !/^[A-Z]{3}$/.test(currency)) {
      this.error = 'Informe preço não negativo e moeda com três letras.'
      this.render()
      return
    }

    try {
      await this.backend.updateAdminProduct(productId, {
        currency,
        enabled: data.get('enabled') === 'on',
        price_amount: price,
      })
      this.notice = 'Produto atualizado.'
      await this.loadTab('products')
    } catch (error) {
      this.error = adminErrorMessage(error)
      this.render()
    }
  }
}
