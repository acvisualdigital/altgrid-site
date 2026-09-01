import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import altgridLogoUrl from './assets/altgrid-mark.png'
import planFounderBadgeUrl from './assets/plans/plan-founder.png'
import planFreeBadgeUrl from './assets/plans/plan-free.png'
import planProBadgeUrl from './assets/plans/plan-pro.png'
import planProPlusBadgeUrl from './assets/plans/plan-pro-plus.png'
import { getBundledGameIconUrl } from './game-icon-assets'

import {
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  normalizeReferralCode,
  validateReferralCode,
} from './lib/auth-validation'
import {
  AuthService,
  AuthServiceError,
  parsePasswordRecoveryCallback,
  type SignUpResult,
} from './services/auth-service'
import {
  BackendApi,
  BackendApiError,
} from './services/backend-api'
import {
  CUSTOM_GAME_SLUG,
  ConfiguredAccountService,
  type ConfiguredAccount,
} from './services/configured-account-service'
import {
  GamePresetService,
  normalizeSafeGameUrl,
  validateSafeGameUrl,
} from './services/game-preset-service'
import {
  PermissionService,
  SAFE_FREE_ENTITLEMENTS,
  SessionCancellationCleanupError,
} from './services/permission-service'
import { UNLIMITED_ACCOUNT_LIMIT } from './types/backend-api'
import {
  GRID_MODES,
  GridLayoutService,
  type ConcreteGridMode,
  type GridLayout,
  type GridMode,
} from './services/grid-layout-service'
import {
  GridWorkspaceService,
  type SavedGridWorkspace,
} from './services/grid-workspace-service'
import { SessionSurfaceManager } from './services/session-surface-manager'
import { parseProxyLine } from './services/proxy-line-parser'
import { ChatService, type ChatState } from './services/chat-service'
import { NotificationCenterService } from './services/notification-center-service'
import {
  ADMIN_PUSH_EVENT,
  type AdminPushEventDetail,
} from './services/admin-push-notification-service'
import type {
  OfflineLicenseService,
  OfflineLicenseSource,
} from './services/license-snapshot-service'
import type {
  AppMetricsResponse,
  CreateAppAdRequestInput,
  MeResponse,
  PixPayment,
  PublicAnnouncement,
  PublicAppAd,
  PublicAppAdPlan,
  PublicConfigResponse,
  PublicGame,
  PublicProduct,
  ReferralProgramResponse,
  ResolvedEntitlements,
  UserAppAdRequest,
} from './types/backend-api'
import type { AdminPaymentLog, AdminUserDetail } from './types/admin-api'
import type { PlanCode } from './types/database'
import type {
  SessionExtensionSummary,
  SessionProxyInput,
  SessionProxySummary,
  SessionProxyTestResult,
  SessionResourceUsage,
} from '../electron/contracts'

type AuthView =
  | 'authenticated'
  | 'checking'
  | 'confirm-email'
  | 'forgot'
  | 'forgot-sent'
  | 'login'
  | 'password-updated'
  | 'reset'
  | 'signup'

interface FieldErrors {
  [fieldName: string]: string | null
}

type ActiveDialog =
  | 'add-account'
  | 'about'
  | 'advertise'
  | 'delete-account'
  | 'chat-nickname'
  | 'free-limit'
  | 'extension'
  | 'grid-manager'
  | 'more-games'
  | 'my-plan'
  | 'payment'
  | 'plans'
  | 'copy-proxy'
  | 'proxy'
  | 'rename-account'
  | 'referrals'
  | 'settings'
  | 'sponsored'
  | 'shortcuts'
  | 'update'
  | null
type BackendLoadStatus = 'error' | 'idle' | 'loading' | 'ready'
type ServiceStatus = 'checking' | 'offline' | 'online' | 'unknown'
type WorkspaceMode = 'account' | 'grid'

interface PlanPresentation {
  benefits: readonly string[]
  capacity: string
  displayName: string
  summary: string
  tierLabel: string
}

const PLAN_ORDER: readonly PlanCode[] = ['FREE', 'PRO', 'PRO_PLUS', 'FOUNDER']
const PLAN_RANK: Record<PlanCode, number> = {
  FREE: 0,
  PRO: 1,
  PRO_PLUS: 2,
  FOUNDER: 3,
}

const DEFAULT_APP_AD_PLANS: readonly PublicAppAdPlan[] = [
  {
    code: 'sidebar',
    name: 'Vitrine lateral',
    description: 'Cartão patrocinado fixo; jogos aprovados recebem destaque no catálogo do app.',
    placement: 'sidebar',
    min_days: 7,
    max_days: 90,
    price_per_day: 3,
    currency: 'BRL',
    popup_enabled: false,
  },
  {
    code: 'spotlight',
    name: 'Destaque FREE',
    description: 'Vitrine lateral, destaque no catálogo e pop-up controlado para usuários FREE.',
    placement: 'sidebar_popup',
    min_days: 7,
    max_days: 60,
    price_per_day: 5,
    currency: 'BRL',
    popup_enabled: true,
  },
  {
    code: 'impact',
    name: 'Campanha impacto',
    description: 'Maior prioridade na lateral, no catálogo e no pop-up para usuários FREE.',
    placement: 'sidebar_popup',
    min_days: 7,
    max_days: 30,
    price_per_day: 8,
    currency: 'BRL',
    popup_enabled: true,
  },
]

const LOCAL_APP_AD_PREVIEW_ID = 'local-app-ad-preview'
const LOCAL_AD_TEST_MODE = import.meta.env.DEV
const HOUSE_APP_AD_ID = 'altgrid-house-ad'
const HOUSE_APP_AD: PublicAppAd = {
  id: HOUSE_APP_AD_ID,
  category: 'site',
  game_slug: null,
  advertiser_name: 'AltGrid para anunciantes',
  title: 'Seu jogo pode aparecer aqui',
  description: 'Divulgue seu jogo idle, produto ou site para uma comunidade que já joga em múltiplas contas.',
  destination_url: 'https://altgrid.com.br/games.html#anunciar',
  image_url: null,
  cta_label: 'Anuncie no AltGrid',
  placement: 'sidebar_popup',
  popup_enabled: true,
  starts_at: '2026-01-01T00:00:00.000Z',
  ends_at: '2099-12-31T23:59:59.000Z',
}
const LOCAL_APP_AD_PREVIEW: PublicAppAd = {
  id: LOCAL_APP_AD_PREVIEW_ID,
  category: 'game',
  game_slug: 'huntera',
  advertiser_name: 'IdleForge Studio',
  title: 'Uma nova aventura idle espera por você',
  description: 'Evolua mesmo offline, monte sua equipe e descubra eventos especiais todos os dias.',
  destination_url: 'https://altgrid.com.br/games.html',
  image_url: null,
  cta_label: 'Conhecer o jogo',
  placement: 'sidebar_popup',
  popup_enabled: true,
  starts_at: '2026-09-01T00:00:00.000Z',
  ends_at: '2099-12-31T23:59:59.000Z',
}

function localAppAdPreviewEnabled(): boolean {
  return import.meta.env.DEV
    && typeof navigator !== 'undefined'
    && /Electron/i.test(navigator.userAgent)
}

export const EXTENSION_ACCOUNT_LIMITS: Readonly<Record<PlanCode, number>> = {
  FREE: 0,
  PRO: 3,
  PRO_PLUS: 9,
  FOUNDER: UNLIMITED_ACCOUNT_LIMIT,
}

export function extensionAccountLimitForPlan(plan: PlanCode): number {
  return EXTENSION_ACCOUNT_LIMITS[plan]
}

const PLAN_PRESENTATION: Record<PlanCode, PlanPresentation> = {
  FREE: {
    benefits: [
      'Grades básicas para organizar suas telas',
      'Tela cheia e modo Somente telas',
      'Presets de jogos e contas isoladas',
      'Dados e logins dos jogos mantidos localmente',
    ],
    capacity: '3 sessões no Huntera · 2 nos demais jogos',
    displayName: 'FREE',
    summary: 'O essencial para começar a organizar suas contas sem custo.',
    tierLabel: 'Grátis para sempre',
  },
  PRO: {
    benefits: [
      'Tudo o que está disponível no FREE',
      'Até 6 sessões abertas ao mesmo tempo',
      'Grades avançadas e personalizadas',
      'Eco Mode para limitar FPS e reduzir consumo',
      'Extensão isolada em até 3 contas no computador',
    ],
    capacity: 'Até 6 contas simultâneas',
    displayName: 'PRO',
    summary: 'Mais controle e economia de recursos para quem usa várias contas.',
    tierLabel: 'Plano avançado',
  },
  PRO_PLUS: {
    benefits: [
      'Tudo o que está disponível no PRO',
      'Até 10 sessões abertas ao mesmo tempo',
      'Grades avançadas para operações maiores',
      'Eco Mode para limitar FPS e reduzir consumo',
      'Extensão isolada em até 9 contas no computador',
      'Mais capacidade sem perder a organização',
    ],
    capacity: 'Até 10 contas simultâneas',
    displayName: 'PLUS',
    summary: 'A melhor capacidade para quem gerencia muitas contas todos os dias.',
    tierLabel: 'Melhor custo-benefício',
  },
  FOUNDER: {
    benefits: [
      'Tudo o que está disponível no PLUS',
      'Contas simultâneas ilimitadas',
      'Proxy exclusivo, salvo e ativado por conta no computador',
      'Extensões ilimitadas, isoladas por conta no computador',
      'Acesso aos recursos beta do AltGrid',
      'Badge e número Founder no chat',
    ],
    capacity: 'Contas simultâneas ilimitadas',
    displayName: 'FOUNDER',
    summary: 'O nível máximo do AltGrid, com recursos exclusivos e sem limite de contas.',
    tierLabel: 'Plano máximo',
  },
}

const CHAT_GAME_SELECTION_STORAGE_KEY = 'altgrid.chat.visible-game-channels.v1'
const SELECTED_GRID_STORAGE_KEY = 'altgrid.selected-grid.v1'
const CHAT_BOTTOM_THRESHOLD_PX = 48
const RMT_DISCORD_URL = 'https://discord.gg/jqbWgSPVe'
export interface ChatScrollSnapshot {
  channelId: string
  clientHeight: number
  loadingMore: boolean
  scrollHeight: number
  scrollTop: number
}

export function resolveChatScrollTop(
  previous: ChatScrollSnapshot | null,
  current: Pick<ChatScrollSnapshot, 'channelId' | 'clientHeight' | 'loadingMore' | 'scrollHeight'>,
): number {
  const maximum = Math.max(0, current.scrollHeight - current.clientHeight)

  if (!previous || previous.channelId !== current.channelId) {
    return maximum
  }

  const distanceFromBottom = Math.max(
    0,
    previous.scrollHeight - previous.clientHeight - previous.scrollTop,
  )

  if (previous.loadingMore && !current.loadingMore) {
    return Math.min(
      maximum,
      Math.max(0, previous.scrollTop + current.scrollHeight - previous.scrollHeight),
    )
  }

  if (distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX) {
    return maximum
  }

  return Math.min(maximum, Math.max(0, previous.scrollTop))
}

type ApplicationBackend = Pick<BackendApi, 'getEntitlements' | 'getGames' | 'getMe'>
  & Partial<Pick<
    BackendApi,
    | 'createAppAdRequest'
    | 'createAppAdPixPayment'
    | 'createPixPayment'
    | 'getAppConfig'
    | 'getAppMetrics'
    | 'getAnnouncements'
    | 'getAppAds'
    | 'getAppAdPlans'
    | 'getAppAdPayment'
    | 'getMyAppAdRequests'
    | 'getHealth'
    | 'getAdminSession'
    | 'getAdminPaymentLogs'
    | 'getAdminAppAdRequests'
    | 'getAdminChatReports'
    | 'getAdminUser'
    | 'getPayment'
    | 'getProducts'
    | 'getReferralProgram'
    | 'recordAppAdEvent'
    | 'sendPresenceHeartbeat'
    | 'updateProfile'
  >>

interface SessionReleaseSnapshot {
  activeAccounts: ConfiguredAccount[]
  closingOperations: ReadonlyMap<string, Promise<void>>
  openingOperations: Array<readonly [string, Promise<boolean>]>
  sessionsNeedingHide: string[]
}

export interface AccountSessionLauncher {
  readonly mobileNative?: boolean
  readonly maxConcurrentSessions?: number
  applyLayout(layout: GridLayout): Promise<void> | void
  clearData(account: ConfiguredAccount): Promise<void> | void
  close(account: ConfiguredAccount): Promise<void> | void
  chooseExtension?(account: ConfiguredAccount): Promise<SessionExtensionSummary | null>
  copyExtension?(source: ConfiguredAccount, target: ConfiguredAccount): Promise<SessionExtensionSummary | null>
  copyProxy?(
    source: ConfiguredAccount,
    target: ConfiguredAccount,
  ): Promise<SessionProxySummary | null>
  focus(account: ConfiguredAccount): Promise<void> | void
  getExtension?(account: ConfiguredAccount): Promise<SessionExtensionSummary | null>
  getProxy?(account: ConfiguredAccount): Promise<SessionProxySummary | null>
  getResourceUsage?(): Promise<SessionResourceUsage[]>
  open(
    account: ConfiguredAccount,
    target: AccountSessionLaunchTarget | null,
  ): Promise<void> | void
  registerEscapeHandler(handler: () => void): (() => void) | void
  registerStatusHandler(
    handler: (event: AccountSessionStatusEvent) => void,
  ): (() => void) | void
  reload(account: ConfiguredAccount): Promise<void> | void
  removeExtension?(account: ConfiguredAccount): Promise<boolean>
  removeProxy?(account: ConfiguredAccount): Promise<boolean>
  setEcoMode(enabled: boolean, backgroundFps: EcoBackgroundFps): Promise<boolean> | boolean
  setFrameRate(account: ConfiguredAccount, fps: number): Promise<void> | void
  setInterfaceScale?(
    account: ConfiguredAccount,
    scale: number | null,
  ): Promise<void> | void
  setFullscreen?(enabled: boolean): Promise<void> | void
  setMuted(account: ConfiguredAccount, muted: boolean): Promise<void> | void
  setExtensionEnabled?(account: ConfiguredAccount, enabled: boolean): Promise<SessionExtensionSummary>
  setProxy?(
    account: ConfiguredAccount,
    input: SessionProxyInput,
  ): Promise<SessionProxySummary>
  testProxy?(account: ConfiguredAccount): Promise<SessionProxyTestResult>
}

export interface AccountSessionStatusEvent {
  accountId: string
  detail?: string
  type:
    | 'closed'
    | 'crashed'
    | 'focused'
    | 'load-failed'
    | 'loading'
    | 'ready'
}

export interface AccountSessionLaunchTarget {
  allowExtension: boolean
  allowProxy: boolean
  kind: 'custom' | 'preset'
  launchUrl: string
  game: PublicGame | null
}

export interface AuthAppOptions {
  accountService?: ConfiguredAccountService
  gridWorkspaceService?: GridWorkspaceService
  backendApi?: ApplicationBackend
  chatService?: ChatService
  gamePresetService?: GamePresetService
  openExternalUrl?: (url: string) => Promise<void> | void
  offlineLicenseService?: OfflineLicenseService
  permissionService?: PermissionService
  sessionLauncher?: Partial<AccountSessionLauncher>
  updater?: AppUpdater
}

export type AppUpdateStatus =
  | 'available'
  | 'checking'
  | 'downloaded'
  | 'downloading'
  | 'error'
  | 'idle'
  | 'not_available'

export interface AppUpdateState {
  message?: string
  percent?: number
  releaseNotes?: string
  status: AppUpdateStatus
  supported: boolean
  version?: string
}

export interface AppUpdater {
  checkForUpdates(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  getState(): Promise<AppUpdateState>
  onStateChange(listener: (state: AppUpdateState) => void): () => void
  quitAndInstall(): Promise<boolean>
}

const RECOVERY_QUERY_VALUE = 'recovery'
const OAUTH_QUERY_VALUE = 'oauth'
const APP_VERSION = __APP_VERSION__
const ECO_MODE_STORAGE_KEY = 'altgrid.preference.eco-mode.v1'
const ECO_BACKGROUND_FPS_STORAGE_KEY = 'altgrid.preference.eco-background-fps.v1'
const SESSION_FPS_STORAGE_KEY = 'altgrid.preference.session-fps.v1'
const SESSION_INTERFACE_SCALE_STORAGE_KEY = 'altgrid.preference.session-interface-scale.v1'
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'altgrid.preference.sidebar-collapsed.v1'
const UTILITY_BAR_COLLAPSED_STORAGE_KEY = 'altgrid.preference.utility-bar-collapsed.v1'
const GRID_MODE_STORAGE_KEY = 'altgrid.preference.grid-mode.v1'
const REFERRAL_CODE_STORAGE_KEY = 'altgrid.referral-code.v1'
const RESOURCE_USAGE_REFRESH_INTERVAL_MS = 12_000

function initialReferralCode(): string {
  try {
    const queryCode = normalizeReferralCode(
      new URLSearchParams(window.location.search).get('ref') ?? '',
    )
    if (validateReferralCode(queryCode) === null && queryCode) {
      localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, queryCode)
      return queryCode
    }

    const storedCode = normalizeReferralCode(
      localStorage.getItem(REFERRAL_CODE_STORAGE_KEY) ?? '',
    )
    return validateReferralCode(storedCode) === null ? storedCode : ''
  } catch {
    return ''
  }
}

export type EcoBackgroundFps = 10 | 20 | 30

type UiIconName =
  | 'add'
  | 'bell'
  | 'chat'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'close'
  | 'copy'
  | 'cpu'
  | 'edit'
  | 'gauge'
  | 'gift'
  | 'globe'
  | 'grid'
  | 'leaf'
  | 'memory'
  | 'moon'
  | 'power'
  | 'puzzle'
  | 'refresh'
  | 'route'
  | 'screens'
  | 'settings'
  | 'share'
  | 'shield'
  | 'sparkles'
  | 'star'
  | 'trash'
  | 'trophy'
  | 'user'
  | 'users'
  | 'volume'
  | 'external'

const UI_ICON_PATHS: Record<UiIconName, string> = {
  add: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  chat: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3M10 10h4v4h-4z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 14 4-4M8 18h8"/>',
  gift: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 7v14"/><path d="M12 7H7.5A2.5 2.5 0 1 1 10 4.5C10 7 12 7 12 7Zm0 0h4.5A2.5 2.5 0 1 0 14 4.5C14 7 12 7 12 7Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  leaf: '<path d="M20 4C11 4 5 7 5 13c0 3.9 3.1 7 7 7 6 0 8-7 8-16Z"/><path d="M4 20c3-4 6-7 12-9"/>',
  memory: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h2v4H7zM12 10h2v4h-2zM17 10h1v4h-1zM7 3v3M12 3v3M17 3v3M7 18v3M12 18v3M17 18v3"/>',
  moon: '<path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"/><path d="M15.5 5.5h3M17 4v3"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a8 8 0 1 1-12.8 0"/>',
  puzzle: '<path d="M19 13h-2.2a2.8 2.8 0 1 0 0-2H19V6a1 1 0 0 0-1-1h-5V3a2 2 0 1 0-4 0v2H5a1 1 0 0 0-1 1v4h2a2 2 0 1 1 0 4H4v4a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1Z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3"/>',
  screens: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>',
  share: '<circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  sparkles: '<path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  trophy: '<path d="M8 4h8v4a4 4 0 0 1-8 0Z"/><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 12v5M8 21h8M9 17h6v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  external: '<path d="M14 3h7v7M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
}

function uiIcon(name: UiIconName): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_ICON_PATHS[name]}</svg>`
}

export function passwordRecoveryRedirectUrl(
  location: Pick<Location, 'origin' | 'protocol'> = window.location,
  desktopBridgeAvailable = typeof window !== 'undefined'
    && Boolean((window as Window & { altgrid?: unknown }).altgrid),
): string {
  if (
    desktopBridgeAvailable
    || location.protocol === 'altgrid:'
    || location.origin === 'https://localhost'
    || location.origin === 'capacitor://localhost'
  ) {
    return `altgrid://app/?auth=${RECOVERY_QUERY_VALUE}`
  }

  return `${location.origin}/?auth=${RECOVERY_QUERY_VALUE}`
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      currency,
      style: 'currency',
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'Vitalício'
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(parsed)
}

export function googleAuthRedirectUrl(
  location: Pick<Location, 'origin' | 'pathname' | 'protocol'> = window.location,
  desktopBridgeAvailable = typeof window !== 'undefined'
    && Boolean((window as Window & { altgrid?: unknown }).altgrid),
): string {
  if (
    desktopBridgeAvailable
    || location.protocol === 'altgrid:'
    || location.origin === 'https://localhost'
    || location.origin === 'capacitor://localhost'
  ) {
    return `altgrid://app/?auth=${OAUTH_QUERY_VALUE}`
  }

  return `${location.origin}${location.pathname}?auth=${OAUTH_QUERY_VALUE}`
}

function formatMemoryKb(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB'
  const megabytes = value / 1_024
  return megabytes >= 1_024
    ? `${(megabytes / 1_024).toFixed(2)} GB`
    : `${Math.round(megabytes)} MB`
}

function finiteResourceValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0
}

function playAdminPaymentAlertSound(confirmed: boolean): void {
  try {
    const AudioContextConstructor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) return

    const context = new AudioContextConstructor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const startedAt = context.currentTime
    oscillator.type = confirmed ? 'sine' : 'triangle'
    oscillator.frequency.setValueAtTime(confirmed ? 880 : 560, startedAt)
    if (confirmed) {
      oscillator.frequency.setValueAtTime(1_120, startedAt + 0.12)
    }
    gain.gain.setValueAtTime(0.0001, startedAt)
    gain.gain.exponentialRampToValueAtTime(0.16, startedAt + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.32)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(startedAt)
    oscillator.stop(startedAt + 0.34)
    oscillator.addEventListener('ended', () => {
      void context.close().catch(() => undefined)
    }, { once: true })
    void context.resume().catch(() => undefined)
  } catch {
    // Sound is supplemental; notification delivery must remain reliable.
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#039;',
        '"': '&quot;',
      })[character] ?? character,
  )
}

const PLAN_BADGE_PRESENTATION: Record<PlanCode, {
  accessibleName: string
  assetUrl: string
  label: string
}> = {
  FOUNDER: {
    accessibleName: 'Founder',
    assetUrl: planFounderBadgeUrl,
    label: 'FOUNDER',
  },
  FREE: {
    accessibleName: 'Free',
    assetUrl: planFreeBadgeUrl,
    label: 'FREE',
  },
  PRO: {
    accessibleName: 'Pro',
    assetUrl: planProBadgeUrl,
    label: 'PRO',
  },
  PRO_PLUS: {
    accessibleName: 'Pro Plus',
    assetUrl: planProPlusBadgeUrl,
    label: 'PRO+',
  },
}

export function renderPlanBadge(
  plan: PlanCode,
  founderNumber: number | null = null,
): string {
  const presentation = PLAN_BADGE_PRESENTATION[plan]
  const planClass = plan.toLowerCase().replace('_', '-')
  const founderNumberText = plan === 'FOUNDER' && founderNumber !== null
    ? `#${String(founderNumber).padStart(4, '0')}`
    : ''
  const accessibleName = founderNumberText
    ? `Plano ${presentation.accessibleName}, número ${founderNumberText.slice(1)}`
    : `Plano ${presentation.accessibleName}`

  return `<span class="plan-badge plan-badge--${planClass}" aria-label="${escapeHtml(accessibleName)}"><img class="plan-badge__icon" src="${escapeHtml(presentation.assetUrl)}" alt="" aria-hidden="true" /><span class="plan-badge__text">${presentation.label}</span>${founderNumberText ? `<small class="plan-badge__number">${founderNumberText}</small>` : ''}</span>`
}

function errorMessage(error: unknown): string {
  return error instanceof AuthServiceError
    ? error.message
    : 'Não foi possível concluir a operação. Tente novamente.'
}

function shouldRetrySessionAfterReconnect(error: unknown): boolean {
  return error instanceof AuthServiceError
    && [
      'connection_failed',
      'offline',
      'rate_limited',
      'service_unavailable',
    ].includes(error.code)
}

function backendErrorMessage(error: unknown): string {
  return error instanceof BackendApiError
    ? error.message
    : 'Não foi possível carregar os dados do aplicativo.'
}

function openExternalBrowserUrl(url: string): void {
  const opened = window.open?.(url, '_blank', 'noopener,noreferrer')

  if (!opened) {
    throw new Error('The browser blocked the new window.')
  }

  try {
    opened.opener = null
  } catch {
    // noopener is already requested; some browser wrappers make opener readonly.
  }
}

function entitlementsFromMe(me: MeResponse): ResolvedEntitlements {
  return {
    account_limit: me.account_limit,
    expires_at: me.expires_at,
    features: me.features,
    founder_number: me.founder_number,
    lifetime: me.lifetime,
    plan: me.plan,
  }
}

export function compareVersions(left: string, right: string): number | null {
  interface ParsedVersion {
    core: number[]
    prerelease: string[] | null
  }

  const parse = (value: string): ParsedVersion | null => {
    const match = value.trim().match(
      /^v?(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    )

    if (!match) {
      return null
    }

    const core = match[1]!.split('.').map(Number)
    if (core.some((part) => !Number.isSafeInteger(part))) {
      return null
    }

    return {
      core,
      prerelease: match[2]?.split('.') ?? null,
    }
  }
  const leftParts = parse(left)
  const rightParts = parse(right)

  if (!leftParts || !rightParts) {
    return null
  }

  const length = Math.max(leftParts.core.length, rightParts.core.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts.core[index] ?? 0) - (rightParts.core[index] ?? 0)
    if (difference !== 0) {
      return Math.sign(difference)
    }
  }

  if (leftParts.prerelease === null || rightParts.prerelease === null) {
    return leftParts.prerelease === rightParts.prerelease
      ? 0
      : leftParts.prerelease === null
        ? 1
        : -1
  }

  const prereleaseLength = Math.max(
    leftParts.prerelease.length,
    rightParts.prerelease.length,
  )
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftIdentifier = leftParts.prerelease[index]
    const rightIdentifier = rightParts.prerelease[index]

    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier
        ? 0
        : leftIdentifier === undefined
          ? -1
          : 1
    }

    if (leftIdentifier === rightIdentifier) {
      continue
    }

    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      const leftNormalized = leftIdentifier.replace(/^0+(?=\d)/, '')
      const rightNormalized = rightIdentifier.replace(/^0+(?=\d)/, '')
      if (leftNormalized.length !== rightNormalized.length) {
        return leftNormalized.length < rightNormalized.length ? -1 : 1
      }
      return leftNormalized < rightNormalized ? -1 : 1
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    }
    return leftIdentifier < rightIdentifier ? -1 : 1
  }

  return 0
}

export class AuthApp {
  private currentView: AuthView = 'checking'
  private session: Session | null = null
  private unsubscribeFromAuth: (() => void) | null = null
  private unsubscribeFromSessionEscape: (() => void) | null = null
  private unsubscribeFromChat: (() => void) | null = null
  private unsubscribeFromSessionStatus: (() => void) | null = null
  private destroyed = false
  private initialAlert: string | null = null
  private recoveryMode = false
  private authStateRevision = 0
  private sessionCheckInFlight = false
  private sessionCheckError: string | null = null
  private retrySessionOnReconnect = false
  private readonly backendApi: ApplicationBackend | null
  private readonly gamePresetService: GamePresetService | null
  private readonly chatService: ChatService | null
  private readonly notificationCenter = new NotificationCenterService()
  private readonly openExternalUrl: (url: string) => Promise<void> | void
  private readonly permissionService: PermissionService
  private readonly offlineLicenseService: OfflineLicenseService | null
  private readonly accountService: ConfiguredAccountService
  private readonly gridWorkspaceService: GridWorkspaceService
  private readonly sessionLauncher: AccountSessionLauncher
  private readonly mobileSessionMode: boolean
  private readonly ecoModeSupported: boolean
  private readonly frameRateControlSupported: boolean
  private readonly interfaceScaleControlSupported: boolean
  private readonly updater: AppUpdater | null
  private readonly gridLayoutService: GridLayoutService
  private activeDialog: ActiveDialog = null
  private dialogError: string | null = null
  private backendLoadStatus: BackendLoadStatus = 'idle'
  private backendLoadError: string | null = null
  private serviceStatus: ServiceStatus = 'unknown'
  private appConfig: PublicConfigResponse['config'] = {}
  private offlineLicenseSource: OfflineLicenseSource | null = null
  private backendLoadInFlight: Promise<void> | null = null
  private backendStateRevision = 0
  private backendUserId: string | null = null
  private adminAccess = false
  private adminPaymentAlertTimer: ReturnType<typeof setInterval> | null = null
  private readonly adminPaymentStates = new Map<string, string>()
  private readonly adminAdRequestStates = new Map<string, string>()
  private readonly adminChatReportIds = new Set<string>()
  private adminPaymentsInitialized = false
  private adminAdRequestsInitialized = false
  private adminChatReportsInitialized = false
  private adminPaymentAlertLoading = false
  private freePlanPromptShown = false
  private configuredAccounts: ConfiguredAccount[] = []
  private savedGridWorkspaces: SavedGridWorkspace[] = []
  private selectedGridWorkspaceId: string | null = null
  private dialogGridWorkspaceId: string | null = null
  private games: PublicGame[] = []
  private gameCatalogError: string | null = null
  private me: MeResponse | null = null
  private announcements: PublicAnnouncement[] = []
  private appAds: PublicAppAd[] = []
  private appAdPlans: PublicAppAdPlan[] = [...DEFAULT_APP_AD_PLANS]
  private selectedSponsoredAdId: string | null = null
  private appAdSubmitting = false
  private appAdSuccess: string | null = null
  private myAppAdRequests: UserAppAdRequest[] = []
  private myAppAdRequestsLoading = false
  private appAdPaymentRequestId: string | null = null
  private appAdTestStage: 1 | 2 | 3 | 4 = 1
  private appAdPopupTimer: ReturnType<typeof setTimeout> | null = null
  private sponsoredPopupShownForUserId: string | null = null
  private products: PublicProduct[] = []
  private appMetrics: AppMetricsResponse | null = null
  private referralProgram: ReferralProgramResponse | null = null
  private referralLoading = false
  private referralError: string | null = null
  private signupReferralCode = initialReferralCode()
  private pendingConfirmationEmail = ''
  private confirmationResendStatus: 'idle' | 'sending' | 'sent' | 'error' = 'idle'
  private confirmationResendMessage = ''
  private presenceHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  private presenceUserId: string | null = null
  private pixPayment: PixPayment | null = null
  private paymentLoading = false
  private paymentError: string | null = null
  private paymentPollTimer: ReturnType<typeof setTimeout> | null = null
  private proxyConfig: SessionProxySummary | null = null
  private readonly accountProxyStates = new Map<string, SessionProxySummary | null>()
  private readonly proxyStateLoadingAccountIds = new Set<string>()
  private proxyLoading = false
  private proxySaving = false
  private proxyTestResult: SessionProxyTestResult | null = null
  private extensionConfig: SessionExtensionSummary | null = null
  private readonly accountExtensionStates = new Map<string, SessionExtensionSummary | null>()
  private readonly extensionStateLoadingAccountIds = new Set<string>()
  private extensionStatesReady = false
  private extensionStateRefreshInFlight: Promise<void> | null = null
  private extensionLoading = false
  private extensionSaving = false
  private resourceUsage: SessionResourceUsage[] = []
  private resourceUsageLoading = false
  private resourceUsageTimer: ReturnType<typeof setInterval> | null = null
  private sessionAlertTimer: ReturnType<typeof setTimeout> | null = null
  private readonly backgroundAccountIds = new Set<string>()
  private chatNicknameSaving = false
  private nicknameOnboarding = false
  private selectedChatGameChannelIds: Set<string> | null = null
  private accountOrderChanged = false
  private reorderedAccountId: string | null = null
  private updateState: AppUpdateState = { status: 'idle', supported: false }
  private unsubscribeFromUpdater: (() => void) | null = null
  private gridMode: GridMode = 'auto'
  private ecoModeRequested = true
  private ecoModeEffective = false
  private ecoBackgroundFps: EcoBackgroundFps = 20
  private ecoModeOperation: Promise<void> = Promise.resolve()
  private workspaceMode: WorkspaceMode = 'account'
  private gridPageIndex = 0
  private resolvedGridMode: ConcreteGridMode = '1x1'
  private previousAutoMode: ConcreteGridMode | undefined
  private screensOnly = false
  private sidebarCollapsed = false
  private utilityBarCollapsed = false
  private maximizedAccountId: string | null = null
  private dialogAccountId: string | null = null
  private workspaceResizeObserver: ResizeObserver | null = null
  private workspaceResizeFrame: number | null = null
  private lastLayoutSignature = ''
  private renderedDialogSignature = ''
  private readonly workspaceMarkupCache = new Map<string, string>()
  private sessionLayoutQueue: Promise<void> = Promise.resolve()
  private sessionLayoutSuspended = false
  private sessionCleanupInFlight: Promise<boolean> | null = null
  private readonly sessionReleaseInFlight = new Map<string, Promise<void>>()
  private readonly failedSessionReleaseIds = new Set<string>()
  private readonly sessionOpeningInFlight = new Map<string, Promise<boolean>>()
  private readonly sessionIssues = new Map<string, string>()
  private readonly mutedAccountIds = new Set<string>()
  private readonly sessionFrameRates = new Map<string, number>()
  private readonly sessionInterfaceScales = new Map<string, number>()
  private sessionSurfaceManager: SessionSurfaceManager | null = null
  private focusedAccountId: string | null = null
  private dialogReturnFocus:
    | { accountId: string; type: 'account' }
    | { type: 'add-account' }
    | null = null
  constructor(
    private readonly root: HTMLElement,
    private readonly authService: AuthService,
    options: AuthAppOptions = {},
  ) {
    this.backendApi = options.backendApi ?? null
    this.chatService = options.chatService ?? null
    this.gamePresetService = options.gamePresetService
      ?? (this.backendApi
        ? new GamePresetService({
            loader: () => this.backendApi!.getGames(),
          })
        : null)
    this.openExternalUrl = options.openExternalUrl ?? openExternalBrowserUrl
    this.permissionService = options.permissionService ?? new PermissionService()
    this.offlineLicenseService = options.offlineLicenseService ?? null
    this.accountService = options.accountService ?? new ConfiguredAccountService()
    this.gridWorkspaceService = options.gridWorkspaceService ?? new GridWorkspaceService()
    this.updater = options.updater ?? null
    const sessionLauncher = options.sessionLauncher
    this.mobileSessionMode = sessionLauncher?.mobileNative === true
    // Mobile WebViews must stay unrestricted for smooth gameplay. Android does
    // not expose the desktop frame limiter, so keep Eco Mode unavailable there
    // even if the adapter implements a compatibility no-op.
    this.ecoModeSupported = !this.mobileSessionMode
      && typeof sessionLauncher?.setEcoMode === 'function'
    this.frameRateControlSupported = !this.mobileSessionMode
      && typeof sessionLauncher?.setFrameRate === 'function'
    this.interfaceScaleControlSupported = !this.mobileSessionMode
      && typeof sessionLauncher?.setInterfaceScale === 'function'
    this.ecoModeRequested = this.readEcoModePreference()
    this.ecoBackgroundFps = this.readEcoBackgroundFpsPreference()
    this.readSessionFrameRatePreferences().forEach((fps, accountId) => {
      this.sessionFrameRates.set(accountId, fps)
    })
    this.readSessionInterfaceScalePreferences().forEach((scale, accountId) => {
      this.sessionInterfaceScales.set(accountId, scale)
    })
    try {
      this.sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
      this.utilityBarCollapsed = localStorage.getItem(
        UTILITY_BAR_COLLAPSED_STORAGE_KEY,
      ) === 'true'
    } catch {
      this.sidebarCollapsed = false
      this.utilityBarCollapsed = false
    }
    this.sessionLauncher = {
      mobileNative: sessionLauncher?.mobileNative,
      maxConcurrentSessions: sessionLauncher?.maxConcurrentSessions,
      // Keep calls attached to the supplied launcher. ElectronSessionLauncher
      // stores its API and listener registries on `this`, so copying bare class
      // methods here would make every native-session action fail at runtime.
      applyLayout: (layout) => sessionLauncher?.applyLayout?.(layout),
      clearData: (account) => sessionLauncher?.clearData?.(account),
      close: (account) => sessionLauncher?.close?.(account),
      chooseExtension: sessionLauncher?.chooseExtension
        ? (account) => sessionLauncher.chooseExtension!(account)
        : undefined,
      copyExtension: sessionLauncher?.copyExtension
        ? (source, target) => sessionLauncher.copyExtension!(source, target)
        : undefined,
      copyProxy: sessionLauncher?.copyProxy
        ? (source, target) => sessionLauncher.copyProxy!(source, target)
        : undefined,
      focus: (account) => sessionLauncher?.focus?.(account),
      getExtension: sessionLauncher?.getExtension
        ? (account) => sessionLauncher.getExtension!(account)
        : undefined,
      getProxy: sessionLauncher?.getProxy
        ? (account) => sessionLauncher.getProxy!(account)
        : undefined,
      getResourceUsage: sessionLauncher?.getResourceUsage
        ? () => sessionLauncher.getResourceUsage!()
        : undefined,
      open: (account, target) => sessionLauncher?.open?.(account, target),
      registerEscapeHandler: (handler) => (
        sessionLauncher?.registerEscapeHandler?.(handler)
      ),
      registerStatusHandler: (handler) => (
        sessionLauncher?.registerStatusHandler?.(handler)
      ),
      reload: (account) => sessionLauncher?.reload?.(account),
      removeExtension: sessionLauncher?.removeExtension
        ? (account) => sessionLauncher.removeExtension!(account)
        : undefined,
      removeProxy: sessionLauncher?.removeProxy
        ? (account) => sessionLauncher.removeProxy!(account)
        : undefined,
      setEcoMode: (enabled, backgroundFps) => (
        sessionLauncher?.setEcoMode?.(enabled, backgroundFps) ?? false
      ),
      setFrameRate: (account, fps) => sessionLauncher?.setFrameRate?.(account, fps),
      setInterfaceScale: sessionLauncher?.setInterfaceScale
        ? (account, scale) => sessionLauncher.setInterfaceScale!(account, scale)
        : undefined,
      setFullscreen: (enabled) => sessionLauncher?.setFullscreen?.(enabled),
      setMuted: (account, muted) => sessionLauncher?.setMuted?.(account, muted),
      setExtensionEnabled: sessionLauncher?.setExtensionEnabled
        ? (account, enabled) => sessionLauncher.setExtensionEnabled!(account, enabled)
        : undefined,
      setProxy: sessionLauncher?.setProxy
        ? (account, input) => sessionLauncher.setProxy!(account, input)
        : undefined,
      testProxy: sessionLauncher?.testProxy
        ? (account) => sessionLauncher.testProxy!(account)
        : undefined,
    }
    this.gridLayoutService = new GridLayoutService(this.permissionService)
  }

  async start(): Promise<void> {
    this.render()
    this.initializeUpdater()
    this.unsubscribeFromChat = this.chatService?.subscribe(() => {
      if (!this.destroyed && this.currentView === 'authenticated') {
        this.render()
      }
    }) ?? null
    this.unsubscribeFromAuth = this.authService.onAuthStateChange(
      (event, session) => {
        this.authStateRevision += 1
        queueMicrotask(() => {
          void this.handleAuthStateChange(event, session)
        })
      },
    )
    window.addEventListener('online', this.handleConnectivityChange)
    window.addEventListener('offline', this.handleConnectivityChange)
    window.addEventListener('resize', this.handleWorkspaceResize)
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('pointerdown', this.handleGlobalPointerDown)
    window.addEventListener(ADMIN_PUSH_EVENT, this.handleAdminPush)
    this.unsubscribeFromSessionEscape =
      this.sessionLauncher.registerEscapeHandler(this.handleSessionEscape)
      ?? null
    this.unsubscribeFromSessionStatus =
      this.sessionLauncher.registerStatusHandler(this.handleSessionStatus)
      ?? null

    if (parsePasswordRecoveryCallback(window.location.href)) {
      try {
        const recoverySession = await this.authService.completePasswordRecovery(
          window.location.href,
        )
        if (recoverySession) {
          await this.enterPasswordRecovery(recoverySession)
          return
        }
      } catch (error) {
        this.recoveryMode = false
        this.session = null
        this.currentView = 'login'
        this.initialAlert = `${errorMessage(error)} Solicite um novo link de recuperação.`
        window.history.replaceState({}, '', window.location.pathname)
        this.render()
        return
      }
    }

    await this.restoreSession()
  }

  private async restoreSession(): Promise<void> {
    if (this.destroyed || this.sessionCheckInFlight) {
      return
    }

    this.sessionCheckInFlight = true
    this.sessionCheckError = null
    if (!this.session) {
      this.currentView = 'checking'
      this.render()
    }
    const revisionAtStart = this.authStateRevision

    try {
      const session = await this.authService.getSession()

      if (
        this.destroyed
        || revisionAtStart !== this.authStateRevision
      ) {
        return
      }

      this.retrySessionOnReconnect = false
      this.sessionCheckError = null
      if (session && !this.recoveryMode) {
        this.prepareAuthenticatedSession(session)
      } else {
        this.session = session
        this.currentView = this.recoveryMode
          ? 'reset'
          : this.signupReferralCode ? 'signup' : 'login'
      }
    } catch (error) {
      if (
        this.destroyed
        || revisionAtStart !== this.authStateRevision
      ) {
        return
      }

      if (shouldRetrySessionAfterReconnect(error)) {
        this.retrySessionOnReconnect = !navigator.onLine
        this.sessionCheckError = errorMessage(error)
        this.currentView = this.session ? 'authenticated' : 'checking'
      } else {
        this.retrySessionOnReconnect = false
        this.sessionCheckError = null
        this.currentView = this.recoveryMode ? 'reset' : 'login'
        this.initialAlert = errorMessage(error)
      }
    } finally {
      this.sessionCheckInFlight = false
    }

    if (!this.destroyed) {
      this.render()

      if (this.currentView === 'authenticated' && this.session) {
        void this.loadApplicationData(this.session)
      }
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.sessionAlertTimer) clearTimeout(this.sessionAlertTimer)
    this.sessionAlertTimer = null
    this.stopPaymentPolling()
    this.stopPresenceTracking()
    this.stopResourceMonitoring()
    this.stopAdminPaymentAlerts()
    this.stopAppAdPopupTimer()
    void this.releaseTrackedSessions()
    this.sessionSurfaceManager?.clear()
    this.sessionSurfaceManager = null
    this.unsubscribeFromAuth?.()
    this.unsubscribeFromAuth = null
    this.unsubscribeFromSessionEscape?.()
    this.unsubscribeFromSessionEscape = null
    this.unsubscribeFromSessionStatus?.()
    this.unsubscribeFromSessionStatus = null
    this.unsubscribeFromChat?.()
    this.unsubscribeFromChat = null
    this.chatService?.reset()
    this.unsubscribeFromUpdater?.()
    this.unsubscribeFromUpdater = null
    window.removeEventListener('online', this.handleConnectivityChange)
    window.removeEventListener('offline', this.handleConnectivityChange)
    window.removeEventListener('resize', this.handleWorkspaceResize)
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('pointerdown', this.handleGlobalPointerDown)
    window.removeEventListener(ADMIN_PUSH_EVENT, this.handleAdminPush)
    this.disconnectWorkspaceObserver()
  }

  private initializeUpdater(): void {
    try {
      const previousVersion = localStorage.getItem('altgrid.last-run-version')
      if (previousVersion && previousVersion !== APP_VERSION) {
        this.notificationCenter.upsertSystemNotification({
          category: 'update',
          id: `updated:${APP_VERSION}`,
          summary: `A versão anterior era ${previousVersion}.`,
          title: `AltGrid atualizado para ${APP_VERSION}`,
        })
      }
      localStorage.setItem('altgrid.last-run-version', APP_VERSION)
    } catch {
      // Version history is a convenience and must not delay the local shell.
    }

    if (!this.updater) {
      return
    }

    this.unsubscribeFromUpdater = this.updater.onStateChange((state) => {
      this.applyUpdateState(state)
    })
    void this.updater.getState()
      .then((state) => this.applyUpdateState(state))
      .catch(() => undefined)
  }

  private applyUpdateState(state: AppUpdateState): void {
    this.updateState = { ...state }

    if (state.status === 'available' || state.status === 'downloaded') {
      const version = state.version ?? 'nova versão'
      this.notificationCenter.upsertSystemNotification({
        category: 'update',
        id: `update:${version}`,
        summary: state.status === 'downloaded'
          ? 'Pronta para instalar quando você encerrar suas sessões.'
          : 'Você pode baixar sem interromper suas sessões.',
        title: state.status === 'downloaded'
          ? `AltGrid ${version} pronto para instalar`
          : `AltGrid ${version} disponível`,
      })
    }

    if (
      !this.destroyed
      && (this.currentView === 'authenticated' || this.activeDialog === 'update')
    ) {
      this.render()
    }
  }

  private async checkForUpdates(openDialog: boolean): Promise<void> {
    if (!this.updater) {
      this.updateState = {
        message: 'Atualizações automáticas estão disponíveis no aplicativo instalado.',
        status: 'error',
        supported: false,
      }
      if (openDialog) {
        this.activeDialog = 'update'
        this.render()
      }
      return
    }

    if (openDialog) {
      this.activeDialog = 'update'
      this.render()
    }

    try {
      this.applyUpdateState(await this.updater.checkForUpdates())
    } catch {
      this.applyUpdateState({
        message: 'Não foi possível verificar atualizações.',
        status: 'error',
        supported: true,
      })
    }
  }

  private readonly handleConnectivityChange = (): void => {
    this.updateConnectivityBanner()

    if (navigator.onLine && this.retrySessionOnReconnect) {
      void this.restoreSession()
    }

    if (
      navigator.onLine
      && this.backendLoadStatus === 'error'
      && this.session
    ) {
      void this.loadApplicationData(this.session, true)
    }

    if (
      navigator.onLine
      && this.currentView === 'authenticated'
      && this.session
    ) {
      // Do not wait up to one minute after a temporary connection loss. This
      // keeps the public online counter accurate when Windows resumes or the
      // network changes while the app remains open.
      void this.refreshPresenceAndMetrics(this.session.user.id)
    }
  }

  private readonly handleWorkspaceResize = (): void => {
    this.scheduleWorkspaceLayout()
  }

  private readonly handleAdminPush = (event: Event): void => {
    if (this.currentView !== 'authenticated' || !this.session) return
    const detail = (event as CustomEvent<AdminPushEventDetail>).detail
    if (!detail) return
    const title = String(detail.title ?? '').trim().slice(0, 100)
    const body = String(detail.body ?? '').trim().slice(0, 500)
    if (!title || !body) return
    const eventKey = String(detail.data?.event_key ?? Date.now())
      .replace(/[^a-zA-Z0-9:_-]/g, '')
      .slice(0, 160)
    this.notificationCenter.upsertSystemNotification({
      id: `admin-push:${eventKey || Date.now()}`,
      title,
      summary: body,
    })
    this.render()
    this.showSessionAlert(`${title}: ${body}`)
  }

  private readonly handleGlobalPointerDown = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    const currentMenu = target?.closest<HTMLDetailsElement>(
      'details[data-session-menu], details[data-toolbar-menu]',
    ) ?? null

    this.root
      .querySelectorAll<HTMLDetailsElement>(
        'details[data-session-menu][open], details[data-toolbar-menu][open]',
      )
      .forEach((details) => {
        if (details !== currentMenu) {
          details.removeAttribute('open')
        }
      })
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.exitPresentationLayer()) {
      event.preventDefault()
      return
    }

    if (this.currentView !== 'authenticated' || this.activeDialog) {
      return
    }

    if (event.ctrlKey && event.shiftKey && event.key.toLocaleLowerCase() === 'c') {
      event.preventDefault()
      const state = this.chatService?.getState()
      if (state?.open) {
        this.chatService?.close()
      } else {
        void this.chatService?.open(this.focusedGameId())
      }
      return
    }

    if (event.ctrlKey && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
      const account = this.configuredAccounts[Number(event.key) - 1]

      if (!account) {
        return
      }

      event.preventDefault()
      const button = this.root.querySelector<HTMLButtonElement>(
        `[data-account-tab][data-account-id="${CSS.escape(account.id)}"]`,
      )
      button?.click()
    }
  }

  private readonly handleSessionEscape = (): void => {
    this.exitPresentationLayer()
  }

  private readonly handleSessionStatus = (
    event: AccountSessionStatusEvent,
  ): void => {
    if (this.destroyed) {
      return
    }

    if (event.type === 'closed') {
      void this.handleNativeSessionClosed(event.accountId)
      return
    }

    if (event.type === 'focused') {
      if (this.permissionService.isSessionActive(event.accountId)) {
        const focusChanged = this.focusedAccountId !== event.accountId
        this.focusedAccountId = event.accountId
        if (focusChanged) {
          const account = this.configuredAccounts.find(
            (candidate) => candidate.id === event.accountId,
          )
          if (account) {
            this.updateWorkspaceContext(account)
          }
          if (this.currentView === 'authenticated') {
            this.render()
          }
        }
      }
      return
    }

    if (event.type === 'crashed' || event.type === 'load-failed') {
      this.sessionIssues.set(
        event.accountId,
        event.detail ?? (event.type === 'crashed'
          ? 'Sessão interrompida.'
          : 'Não foi possível carregar esta conta.'),
      )
    } else {
      this.sessionIssues.delete(event.accountId)
    }

    this.lastLayoutSignature = ''
    if (this.currentView === 'authenticated') {
      this.render()
    }
  }

  private async handleNativeSessionClosed(accountId: string): Promise<void> {
    const wasActive = this.permissionService.isSessionActive(accountId)
    const wasFullscreen = this.mobileSessionMode
      && this.screensOnly
      && this.maximizedAccountId === accountId

    await this.permissionService.closeSession(accountId)
    this.mutedAccountIds.delete(accountId)
    this.sessionIssues.delete(accountId)

    if (wasFullscreen) {
      this.maximizedAccountId = null
      this.screensOnly = false
      this.setNativeFullscreen(false)
    }

    if (this.focusedAccountId === accountId) {
      this.focusedAccountId = this.getActiveAccounts()[0]?.id ?? null
    }
    if (this.workspaceMode === 'grid' && this.getActiveAccounts().length <= 1) {
      this.workspaceMode = 'account'
      this.gridPageIndex = 0
    }

    if (this.destroyed || this.currentView !== 'authenticated') {
      return
    }

    this.render()
    if (wasActive) {
      this.showSessionAlert('Sessão encerrada no celular.')
    }
  }

  private exitPresentationLayer(): boolean {
    if (this.activeDialog) {
      this.closeDialog()
      return true
    }

    if (this.maximizedAccountId) {
      this.maximizedAccountId = null
      if (this.mobileSessionMode) {
        this.screensOnly = false
        this.setNativeFullscreen(false)
      }
      this.applyWorkspacePresentation()
      return true
    }

    if (this.screensOnly) {
      this.screensOnly = false
      this.setNativeFullscreen(false)
      this.applyWorkspacePresentation()
      return true
    }

    return false
  }

  private setNativeFullscreen(enabled: boolean): void {
    if (!this.mobileSessionMode) {
      return
    }

    void Promise.resolve(this.sessionLauncher.setFullscreen?.(enabled))
      .catch(() => undefined)
  }

  private async handleAuthStateChange(
    event: AuthChangeEvent,
    session: Session | null,
  ): Promise<void> {
    if (this.destroyed) {
      return
    }

    if (event === 'PASSWORD_RECOVERY') {
      await this.enterPasswordRecovery(session)
      return
    }

    if (event === 'SIGNED_OUT') {
      this.retrySessionOnReconnect = false
      this.sessionCheckError = null
      this.recoveryMode = false
      this.session = null
      this.clearAuthenticatedState()
      this.currentView = 'login'
      this.render()
      return
    }

    if (event === 'INITIAL_SESSION' && !session) {
      this.session = null

      if (!navigator.onLine) {
        this.retrySessionOnReconnect = true
        this.sessionCheckError = 'Sem conexão. Verifique sua internet e tente novamente.'
        this.currentView = 'checking'
      } else {
        this.retrySessionOnReconnect = false
        this.sessionCheckError = null
        this.currentView = 'login'
      }

      this.render()
      return
    }

    if (
      session
      && !this.recoveryMode
      && [
        'INITIAL_SESSION',
        'SIGNED_IN',
        'TOKEN_REFRESHED',
        'USER_UPDATED',
      ].includes(event)
    ) {
      this.retrySessionOnReconnect = false
      this.sessionCheckError = null
      this.prepareAuthenticatedSession(session)
      this.render()
      void this.loadApplicationData(
        session,
        event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED',
      )
    }
  }

  private prepareAuthenticatedSession(session: Session): void {
    if (this.backendUserId !== session.user.id) {
      this.backendStateRevision += 1
      void this.releaseTrackedSessions()
      this.backendUserId = session.user.id
      this.backendLoadStatus = 'idle'
      this.backendLoadError = null
      this.serviceStatus = 'unknown'
      this.appConfig = {}
      this.offlineLicenseSource = null
      this.backendLoadInFlight = null
      this.adminAccess = false
      this.stopAdminPaymentAlerts()
      this.freePlanPromptShown = false
      this.nicknameOnboarding = false
      this.me = null
      this.games = this.gamePresetService?.getCachedGames() ?? []
      this.gameCatalogError = null
      this.announcements = []
      this.appAds = []
      this.appAdPlans = [...DEFAULT_APP_AD_PLANS]
      this.selectedSponsoredAdId = null
      this.appAdSuccess = null
      this.myAppAdRequests = []
      this.myAppAdRequestsLoading = false
      this.appAdPaymentRequestId = null
      this.appAdTestStage = 1
      this.stopAppAdPopupTimer()
      this.sponsoredPopupShownForUserId = null
      this.products = []
      this.appMetrics = null
      this.notificationCenter.setAnnouncements([])
      this.pixPayment = null
      this.paymentError = null
      this.activeDialog = null
      this.dialogAccountId = null
      this.dialogReturnFocus = null
      this.gridMode = this.readGridModePreference()
      this.workspaceMode = 'account'
      this.gridPageIndex = 0
      this.previousAutoMode = undefined
      this.screensOnly = false
      this.maximizedAccountId = null
      this.focusedAccountId = null
      this.sessionIssues.clear()
      this.mutedAccountIds.clear()
      this.backgroundAccountIds.clear()
      this.accountProxyStates.clear()
      this.proxyStateLoadingAccountIds.clear()
      this.accountExtensionStates.clear()
      this.extensionStateLoadingAccountIds.clear()
      this.extensionStatesReady = false
      this.extensionStateRefreshInFlight = null
      this.permissionService.updateEntitlements(SAFE_FREE_ENTITLEMENTS)
      this.ecoModeEffective = false
      void this.syncEcoMode()
      this.configuredAccounts = this.accountService.list(session.user.id)
      this.loadSavedGridWorkspaces(session.user.id)
      void this.chatService?.start()
    }

    this.session = session
    this.currentView = 'authenticated'
    this.startPresenceTracking(session.user.id)
    this.startResourceMonitoring()
  }

  private clearAuthenticatedState(): void {
    this.stopPresenceTracking()
    this.stopPaymentPolling()
    this.stopResourceMonitoring()
    this.stopAdminPaymentAlerts()
    this.backendStateRevision += 1
    void this.releaseTrackedSessions()
    this.backendUserId = null
    this.backendLoadStatus = 'idle'
    this.backendLoadError = null
    this.serviceStatus = 'unknown'
    this.appConfig = {}
    this.offlineLicenseSource = null
    this.backendLoadInFlight = null
    this.adminAccess = false
    this.nicknameOnboarding = false
    this.me = null
    this.games = []
    this.announcements = []
    this.appAds = []
    this.appAdPlans = [...DEFAULT_APP_AD_PLANS]
    this.selectedSponsoredAdId = null
    this.appAdSuccess = null
    this.myAppAdRequests = []
    this.myAppAdRequestsLoading = false
    this.appAdPaymentRequestId = null
    this.appAdTestStage = 1
    this.stopAppAdPopupTimer()
    this.sponsoredPopupShownForUserId = null
    this.products = []
    this.appMetrics = null
    this.referralProgram = null
    this.referralLoading = false
    this.referralError = null
    this.notificationCenter.setAnnouncements([])
    this.pixPayment = null
    this.paymentError = null
    this.paymentLoading = false
    this.gameCatalogError = null
    this.configuredAccounts = []
    this.accountExtensionStates.clear()
    this.extensionStateLoadingAccountIds.clear()
    this.extensionStatesReady = false
    this.extensionStateRefreshInFlight = null
    this.savedGridWorkspaces = []
    this.selectedGridWorkspaceId = null
    this.dialogGridWorkspaceId = null
    this.activeDialog = null
    this.dialogError = null
    this.dialogReturnFocus = null
    this.dialogAccountId = null
    this.gridMode = 'auto'
    this.workspaceMode = 'account'
    this.gridPageIndex = 0
    this.previousAutoMode = undefined
    this.screensOnly = false
    this.maximizedAccountId = null
    this.focusedAccountId = null
    this.sessionIssues.clear()
    this.mutedAccountIds.clear()
    this.backgroundAccountIds.clear()
    this.resourceUsage = []
    this.accountProxyStates.clear()
    this.proxyStateLoadingAccountIds.clear()
    this.accountExtensionStates.clear()
    this.extensionStateLoadingAccountIds.clear()
    this.sessionSurfaceManager = null
    this.disconnectWorkspaceObserver()
    this.permissionService.updateEntitlements(SAFE_FREE_ENTITLEMENTS)
    this.ecoModeEffective = false
    void this.syncEcoMode()
    this.chatService?.reset()
  }

  private stopAppAdPopupTimer(): void {
    if (this.appAdPopupTimer !== null) clearTimeout(this.appAdPopupTimer)
    this.appAdPopupTimer = null
  }

  private scheduleSponsoredPopup(): void {
    this.stopAppAdPopupTimer()
    if (this.permissionService.getCurrentPlan() !== 'FREE') return
    const userId = this.session?.user.id
    if (!userId || this.sponsoredPopupShownForUserId === userId) return
    const ad = this.appAds.find((entry) => entry.popup_enabled) ?? HOUSE_APP_AD

    const openWhenIdle = (): void => {
      this.appAdPopupTimer = null
      if (
        this.destroyed
        || this.permissionService.getCurrentPlan() !== 'FREE'
        || this.session?.user.id !== userId
        || this.sponsoredPopupShownForUserId === userId
      ) return
      if (this.activeDialog) {
        this.appAdPopupTimer = setTimeout(openWhenIdle, 2_000)
        return
      }
      this.sponsoredPopupShownForUserId = userId
      this.selectedSponsoredAdId = ad.id
      this.activeDialog = 'sponsored'
      if (ad.id !== LOCAL_APP_AD_PREVIEW_ID && ad.id !== HOUSE_APP_AD_ID) {
        void this.backendApi?.recordAppAdEvent?.(ad.id, 'impression', 'popup')
          .catch(() => undefined)
      }
      this.render()
    }
    this.appAdPopupTimer = setTimeout(openWhenIdle, 6_000)
  }

  private startPresenceTracking(userId: string): void {
    if (
      !this.backendApi?.sendPresenceHeartbeat
      || !this.backendApi.getAppMetrics
      || this.destroyed
    ) {
      return
    }

    if (this.presenceUserId === userId && this.presenceHeartbeatTimer !== null) {
      return
    }

    this.stopPresenceTracking()
    this.presenceUserId = userId
    void this.refreshPresenceAndMetrics(userId)
    this.presenceHeartbeatTimer = setInterval(() => {
      void this.refreshPresenceAndMetrics(userId)
    }, 60_000)
  }

  private stopPresenceTracking(): void {
    if (this.presenceHeartbeatTimer !== null) {
      clearInterval(this.presenceHeartbeatTimer)
      this.presenceHeartbeatTimer = null
    }
    this.presenceUserId = null
  }

  private async refreshPresenceAndMetrics(userId: string): Promise<void> {
    const backendApi = this.backendApi
    if (
      this.destroyed
      || this.session?.user.id !== userId
      || !navigator.onLine
    ) {
      return
    }

    void this.chatService?.refreshUnread()
    if (!backendApi?.sendPresenceHeartbeat || !backendApi.getAppMetrics) {
      return
    }

    const [, metricsResult] = await Promise.allSettled([
      backendApi.sendPresenceHeartbeat([
        ...new Set(this.getActiveAccounts().map((account) => account.gameSlug)),
      ]),
      backendApi.getAppMetrics(),
    ])

    if (
      metricsResult.status === 'fulfilled'
      && !this.destroyed
      && this.session?.user.id === userId
    ) {
      this.appMetrics = metricsResult.value
      if (this.currentView === 'authenticated') {
        this.render()
      }
    }
  }

  private releaseTrackedSessions(): Promise<boolean> {
    this.sessionLayoutSuspended = true
    // Reset the generation and capture the account objects synchronously. The
    // auth shell may be cleared immediately after this method returns.
    const snapshot = this.captureTrackedSessionRelease()
    const previousOperation = this.sessionCleanupInFlight
    const operation = Promise.resolve(previousOperation ?? true)
      .then(async (previousSucceeded) => {
        const currentSucceeded = await this.performTrackedSessionRelease(snapshot)
        return previousSucceeded && currentSucceeded
      })
      .catch(() => false)

    this.sessionCleanupInFlight = operation
    void operation.then(() => {
      if (this.sessionCleanupInFlight === operation) {
        this.sessionCleanupInFlight = null
        this.sessionLayoutSuspended = false
        this.lastLayoutSignature = ''
        if (
          !this.destroyed
          && this.currentView === 'authenticated'
          && this.session
          && this.permissionService.getActiveSessionCount() > 0
        ) {
          this.scheduleWorkspaceLayout()
        }
      }
    })

    return operation
  }

  private captureTrackedSessionRelease(): SessionReleaseSnapshot {
    const openingOperations = [...this.sessionOpeningInFlight.entries()]
    const closingOperations = new Map(
      this.permissionService.getActiveSessionIds()
        .map((accountId) => [
          accountId,
          this.permissionService.getClosingSessionOperation(accountId),
        ] as const)
        .filter((entry): entry is readonly [string, Promise<void>] =>
          entry[1] !== null),
    )
    const sessionsNeedingClose = new Set([
      ...this.permissionService.resetForRestart(),
      ...this.failedSessionReleaseIds,
    ])
    const sessionsNeedingHide = new Set([
      ...sessionsNeedingClose,
      ...openingOperations.map(([accountId]) => accountId),
      ...this.sessionReleaseInFlight.keys(),
      ...this.failedSessionReleaseIds,
    ])
    const activeAccounts = this.configuredAccounts.filter((account) =>
      sessionsNeedingClose.has(account.id))

    return {
      activeAccounts,
      closingOperations,
      openingOperations,
      sessionsNeedingHide: [...sessionsNeedingHide],
    }
  }

  private async performTrackedSessionRelease(
    snapshot: SessionReleaseSnapshot,
  ): Promise<boolean> {
    const {
      activeAccounts,
      closingOperations,
      openingOperations,
      sessionsNeedingHide,
    } = snapshot

    if (sessionsNeedingHide.length > 0) {
      const hiddenLayout: GridLayout = {
        capacity: 1,
        columns: 1,
        overflowSessionIds: sessionsNeedingHide,
        pageCount: 1,
        pageIndex: 0,
        requestedMode: 'auto',
        resolvedMode: '1x1',
        rows: 1,
        slots: [],
      }

      await this.enqueueSessionLayout(hiddenLayout)
        .catch(() => undefined)
    }

    const operations = activeAccounts.map((account) => {
      const existing = this.sessionReleaseInFlight.get(account.id)

      if (existing) {
        return existing
      }

      const closeOperation = closingOperations.get(account.id)
        ?? Promise.resolve().then(() => this.sessionLauncher.close(account))
      const operation = Promise.resolve(closeOperation)
        .then(() => {
          this.failedSessionReleaseIds.delete(account.id)
        })
        .catch((error: unknown) => {
          this.failedSessionReleaseIds.add(account.id)
          throw error
        })
        .finally(() => {
          if (this.sessionReleaseInFlight.get(account.id) === operation) {
            this.sessionReleaseInFlight.delete(account.id)
          }
        })

      this.sessionReleaseInFlight.set(account.id, operation)
      return operation
    })

    const [openingResults, releaseResults] = await Promise.all([
      Promise.allSettled(openingOperations.map(([, operation]) => operation)),
      Promise.allSettled([
      ...this.sessionReleaseInFlight.values(),
      ...operations,
      ]),
    ])

    const failedOpeningIds = openingOperations.flatMap(
      ([accountId], index) => {
        const result = openingResults[index]
        return result?.status === 'fulfilled' && result.value ? [] : [accountId]
      },
    )
    const sessionsNeedingRehide = [
      ...new Set([
        ...failedOpeningIds,
        ...this.failedSessionReleaseIds,
      ]),
    ]

    // An opening WebView may be created after the first hide was applied. If
    // its compensating close fails, hide it again before auth changes screens.
    if (sessionsNeedingRehide.length > 0) {
      await this.enqueueSessionLayout({
        capacity: 1,
        columns: 1,
        overflowSessionIds: sessionsNeedingRehide,
        pageCount: 1,
        pageIndex: 0,
        requestedMode: 'auto',
        resolvedMode: '1x1',
        rows: 1,
        slots: [],
      }).catch(() => undefined)
    }

    return (
      openingResults.every(
        (result) => result.status === 'fulfilled' && result.value,
      )
      && releaseResults.every((result) => result.status === 'fulfilled')
    )
  }

  private loadApplicationData(
    session: Session,
    force = false,
  ): Promise<void> {
    const backendApi = this.backendApi

    if (!backendApi || this.destroyed) {
      return Promise.resolve()
    }

    if (
      this.backendUserId !== session.user.id
      || this.session?.user.id !== session.user.id
    ) {
      return Promise.resolve()
    }

    if (this.backendLoadInFlight) {
      return this.backendLoadInFlight
    }

    if (!force && this.backendLoadStatus === 'ready') {
      return Promise.resolve()
    }

    const revision = this.backendStateRevision
    this.backendLoadStatus = 'loading'
    this.backendLoadError = null
    if (backendApi.getHealth) {
      this.serviceStatus = 'checking'
    }
    this.render()

    const request = (async (): Promise<void> => {
      const [
        meResult,
        entitlementsResult,
        gamesResult,
        announcementsResult,
        appAdsResult,
        appAdPlansResult,
        productsResult,
        healthResult,
        configResult,
        adminResult,
      ] =
        await Promise.allSettled([
          backendApi.getMe(),
          this.offlineLicenseService
            ? this.offlineLicenseService.loadEntitlements(session.user.id)
            : backendApi.getEntitlements().then((entitlements) => ({
                entitlements,
                source: 'network' as const,
              })),
          this.gamePresetService?.loadGames() ?? Promise.resolve([]),
          backendApi.getAnnouncements?.()
            ?? Promise.resolve({ announcements: [] }),
          backendApi.getAppAds?.()
            ?? Promise.resolve({ ads: [], popup_cooldown_hours: 6 }),
          backendApi.getAppAdPlans?.()
            ?? Promise.resolve({ plans: [] }),
          backendApi.getProducts?.()
            ?? Promise.resolve({ products: [] }),
          backendApi.getHealth?.() ?? Promise.resolve(null),
          backendApi.getAppConfig?.() ?? Promise.resolve(null),
          backendApi.getAdminSession?.() ?? Promise.resolve(null),
        ])

      if (
        this.destroyed
        || revision !== this.backendStateRevision
        || this.session?.user.id !== session.user.id
      ) {
        return
      }

      const failures = [
        meResult,
        entitlementsResult,
        gamesResult,
        announcementsResult,
        productsResult,
        healthResult,
        configResult,
      ].filter((result): result is PromiseRejectedResult =>
        result.status === 'rejected')
      const unauthorized = failures.find(
        (result) =>
          result.reason instanceof BackendApiError
          && result.reason.status === 401,
      )

      const adminUnauthorized = adminResult.status === 'rejected'
        && adminResult.reason instanceof BackendApiError
        && adminResult.reason.status === 401

      if (unauthorized || adminUnauthorized) {
        this.session = null
        this.clearAuthenticatedState()
        this.currentView = 'login'
        this.initialAlert = 'Sua sessão expirou. Entre novamente.'
        this.render()
        void this.authService.signOut().catch(() => undefined)
        return
      }

      if (meResult.status === 'fulfilled' && meResult.value) {
        this.me = meResult.value
      }

      if (
        entitlementsResult.status === 'fulfilled'
        && entitlementsResult.value
      ) {
        this.permissionService.updateEntitlements(
          entitlementsResult.value.entitlements,
        )
        this.offlineLicenseSource = entitlementsResult.value.source
      } else if (meResult.status === 'fulfilled' && meResult.value) {
        this.permissionService.updateEntitlements(
          entitlementsFromMe(meResult.value),
        )
      }

      if (gamesResult.status === 'fulfilled') {
        this.games = gamesResult.value
        this.gameCatalogError = null
      } else {
        this.gameCatalogError = 'Não foi possível atualizar os jogos agora.'
      }

      if (announcementsResult.status === 'fulfilled') {
        this.announcements = announcementsResult.value.announcements
        this.notificationCenter.setAnnouncements(this.announcements)
      }

      if (productsResult.status === 'fulfilled') {
        this.products = productsResult.value.products
      }

      if (healthResult.status === 'fulfilled' && healthResult.value) {
        this.serviceStatus = healthResult.value.ok ? 'online' : 'offline'
      } else if (healthResult.status === 'rejected') {
        this.serviceStatus = 'offline'
      }

      if (configResult.status === 'fulfilled' && configResult.value) {
        this.appConfig = configResult.value.config
      }

      if (appAdsResult.status === 'fulfilled') {
        this.appAds = appAdsResult.value.ads.length > 0
          ? appAdsResult.value.ads
          : localAppAdPreviewEnabled()
            ? [LOCAL_APP_AD_PREVIEW]
            : []
      } else if (localAppAdPreviewEnabled()) {
        this.appAds = [LOCAL_APP_AD_PREVIEW]
      }

      if (appAdPlansResult.status === 'fulfilled') {
        this.appAdPlans = appAdPlansResult.value.plans.length > 0
          ? appAdPlansResult.value.plans
          : [...DEFAULT_APP_AD_PLANS]
      }

      this.adminAccess = adminResult.status === 'fulfilled'
        && adminResult.value !== null

      if (this.adminAccess) {
        this.startAdminPaymentAlerts()
      } else {
        this.stopAdminPaymentAlerts()
      }

      this.backendLoadStatus =
        entitlementsResult.status === 'fulfilled'
        || meResult.status === 'fulfilled'
          ? 'ready'
          : 'error'
      this.backendLoadError = failures.length > 0
        ? backendErrorMessage(failures[0]?.reason)
        : null
      if (
        this.backendLoadStatus === 'ready'
        && !this.me?.profile.display_name?.trim()
      ) {
        this.nicknameOnboarding = true
        this.activeDialog = 'chat-nickname'
      } else if (
        this.backendLoadStatus === 'ready'
        && !this.freePlanPromptShown
        && !this.activeDialog
        && this.permissionService.getCurrentPlan() === 'FREE'
      ) {
        this.freePlanPromptShown = true
        this.activeDialog = 'plans'
      }
      this.render()
      this.scheduleSponsoredPopup()
      void this.refreshAccountProxyStates()
      void this.refreshAccountExtensionStates()
      void this.syncEcoMode()
        .then(() => {
          if (!this.destroyed && this.session?.user.id === session.user.id) {
            this.render()
          }
        })
        .catch(() => undefined)
    })()

    this.backendLoadInFlight = request
    void request.finally(() => {
      if (this.backendLoadInFlight === request) {
        this.backendLoadInFlight = null
      }
    }).catch(() => undefined)

    return request
  }

  private async loadReferralProgram(force = false): Promise<void> {
    if (!this.backendApi?.getReferralProgram || this.referralLoading) {
      if (!this.backendApi?.getReferralProgram) {
        this.referralError = 'O programa de indicações está temporariamente indisponível.'
        this.render()
      }
      return
    }

    if (this.referralProgram && !force) return

    const userId = this.session?.user.id
    if (!userId) return

    this.referralLoading = true
    this.referralError = null
    this.render()

    try {
      const program = await this.backendApi.getReferralProgram()
      if (!this.destroyed && this.session?.user.id === userId) {
        this.referralProgram = program
      }
    } catch (error) {
      if (!this.destroyed && this.session?.user.id === userId) {
        this.referralError = backendErrorMessage(error)
      }
    } finally {
      if (!this.destroyed && this.session?.user.id === userId) {
        this.referralLoading = false
        this.render()
      }
    }
  }

  private async enterPasswordRecovery(session: Session | null): Promise<void> {
    const revision = this.authStateRevision
    if (
      this.permissionService.getActiveSessionCount() > 0
      || this.sessionOpeningInFlight.size > 0
      || this.sessionReleaseInFlight.size > 0
    ) {
      await this.releaseTrackedSessions()
    }

    if (this.destroyed || revision !== this.authStateRevision) {
      return
    }

    this.retrySessionOnReconnect = false
    this.sessionCheckError = null
    this.clearAuthenticatedState()
    this.recoveryMode = true
    this.session = session
    this.currentView = 'reset'
    window.history.replaceState({}, '', window.location.pathname)
    this.render()
  }

  private async refreshGamePresets(): Promise<void> {
    if (!this.gamePresetService || !this.session || this.destroyed) {
      return
    }

    const revision = this.backendStateRevision
    const userId = this.session.user.id

    try {
      const games = await this.gamePresetService.loadGames()

      if (
        this.destroyed
        || revision !== this.backendStateRevision
        || this.session?.user.id !== userId
      ) {
        return
      }

      this.games = games
      this.gameCatalogError = null
      this.render()
    } catch {
      if (
        this.destroyed
        || revision !== this.backendStateRevision
        || this.session?.user.id !== userId
      ) {
        return
      }

      this.gameCatalogError = 'Não foi possível atualizar os jogos agora.'
      this.render()
    }
  }

  private navigate(view: AuthView): void {
    this.initialAlert = null
    this.currentView = view
    this.render()
  }

  private render(): void {
    const restoreSidebarProfile = Boolean(
      !this.activeDialog
      && this.root.querySelector<HTMLDetailsElement>('.sidebar-profile-menu[open]'),
    )
    if (
      this.currentView === 'authenticated'
      && this.session
      && this.updateAuthenticatedShell(restoreSidebarProfile)
    ) {
      return
    }

    this.disconnectWorkspaceObserver()
    this.sessionSurfaceManager = null
    const authenticated = this.currentView === 'authenticated'
    if (!authenticated) {
      this.workspaceMarkupCache.clear()
    }
    this.root.innerHTML = `
      <div class="app-frame ${authenticated ? 'app-frame--workspace' : ''} ${this.mobileSessionMode ? 'is-mobile-session' : ''} ${this.screensOnly ? 'is-screens-only' : ''} ${this.ecoModeEffective ? 'is-eco-mode' : ''}">
        <header class="topbar ${authenticated ? 'topbar--workspace' : ''}">
          <div class="brand" aria-label="AltGrid">
            <img
              class="${authenticated ? 'brand__mark brand__mark--image' : 'brand__logo'}"
              src="${altgridLogoUrl}"
              alt=""
            />
            <span class="brand__name">AltGrid</span>
            ${authenticated ? `<span class="brand__version">${APP_VERSION}</span>` : ''}
          </div>
          ${
             authenticated
               ? `<div class="topbar__workspace-tools">${this.renderWorkspaceToolbar()}</div>`
               : `<div class="topbar__public-actions">
                   <div class="topbar__status" aria-label="Status da conexão">
                     <span class="status-dot" aria-hidden="true"></span>
                     <span>${navigator.onLine ? 'Conectado à internet' : 'Sem conexão'}</span>
                   </div>
                   ${this.renderUpdateButton()}
                 </div>`
          }
        </header>

        <div
          class="connectivity-banner ${navigator.onLine ? 'is-hidden' : ''}"
          id="connectivity-banner"
          role="status"
          aria-live="polite"
        >
          Sem conexão. Sua sessão e configurações foram mantidas.
        </div>

        <main class="${
          this.currentView === 'authenticated' ? 'app-stage' : 'auth-stage'
        }">
          ${authenticated
            ? this.renderView()
            : `<div class="auth-shell auth-shell--${this.currentView}">
                ${this.renderAuthShowcase()}
                <div class="auth-panel">${this.renderView()}</div>
              </div>`}
        </main>

        <div data-overlay-region>${this.renderDialog()}</div>

        ${authenticated ? '' : `<footer class="app-footer">
          <span>AltGrid</span>
          <span class="app-footer__health">
            <span class="status-dot status-dot--small" aria-hidden="true"></span>
            Autenticação protegida
          </span>
        </footer>`}
      </div>
    `

    this.bindViewActions()
    this.restoreSidebarProfileMenu(restoreSidebarProfile)
    this.updateConnectivityBanner()
    this.renderedDialogSignature = this.getDialogSignature()
    this.focusCurrentView()

    if (authenticated) {
      this.restoreChatScroll(this.root, null)
      this.ensureSessionSurfaceManager()
      this.ensureWorkspaceObserver()
      this.applyWorkspacePresentation()
    }
  }

  private updateAuthenticatedShell(restoreSidebarProfile = false): boolean {
    const shell = this.root.querySelector<HTMLElement>('[data-authenticated-shell]')

    if (!shell || shell.dataset.userId !== this.session?.user.id) {
      return false
    }

    const toolbar = this.root.querySelector<HTMLElement>('.topbar__workspace-tools')
    const backendRegion = shell.querySelector<HTMLElement>('[data-backend-region]')
    const sidebarRegion = shell.querySelector<HTMLElement>('[data-sidebar-region]')
    const sidebarToggle = shell.querySelector<HTMLButtonElement>('.sidebar-edge-toggle')
    const mobileNavigationRegion = shell.querySelector<HTMLElement>(
      '[data-mobile-navigation-region]',
    )
    const gridControlsRegion = shell.querySelector<HTMLElement>('[data-grid-controls-region]')
    const statusbarRegion = shell.querySelector<HTMLElement>('[data-statusbar-region]')
    const chatRegion = shell.querySelector<HTMLElement>('[data-chat-region]')
    const previousChatScroll = this.captureChatScroll(chatRegion)
    const overlayRegion = this.root.querySelector<HTMLElement>('[data-overlay-region]')
    const previousAccountScroller = toolbar?.querySelector<HTMLElement>(
      '[data-account-tabs-scroll]',
    )
    const previousAccountScrollLeft = previousAccountScroller?.scrollLeft ?? 0
    const previousFocusedAccountId = toolbar
      ?.querySelector<HTMLElement>('[data-account-tab].is-active')
      ?.dataset.accountId
    let dialogReplaced = false

    shell.classList.toggle(
      'has-chat-open',
      Boolean(this.chatService?.getState().open),
    )

    if (toolbar) {
      const toolbarMarkup = this.renderWorkspaceToolbar()
      const toolbarChanged = this.workspaceMarkupChanged('toolbar', toolbarMarkup)
      if (toolbarChanged) {
        toolbar.innerHTML = toolbarMarkup
      }
      const accountScroller = toolbar.querySelector<HTMLElement>('[data-account-tabs-scroll]')
      if (accountScroller) {
        accountScroller.scrollLeft = this.accountOrderChanged
          ? 0
          : previousAccountScrollLeft
        this.accountOrderChanged = false
        if (previousFocusedAccountId !== this.focusedAccountId) {
          toolbar
            .querySelector<HTMLElement>('[data-account-tab].is-active')
            ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
        }
      }
    }
    if (backendRegion) {
      const markup = this.renderBackendStatus()
      if (this.workspaceMarkupChanged('backend', markup)) {
        backendRegion.innerHTML = markup
      }
    }
    if (sidebarRegion) {
      const markup = this.renderSidebar()
      if (this.workspaceMarkupChanged('sidebar', markup)) {
        sidebarRegion.outerHTML = markup
      }
      this.restoreSidebarProfileMenu(restoreSidebarProfile)
    }
    if (sidebarToggle) {
      sidebarToggle.hidden = !this.sidebarCollapsed
    }
    if (mobileNavigationRegion) {
      const markup = this.renderMobileNavigation()
      if (this.workspaceMarkupChanged('mobile-navigation', markup)) {
        mobileNavigationRegion.outerHTML = markup
      }
    }
    if (gridControlsRegion) {
      const markup = this.renderGridControls()
      if (this.workspaceMarkupChanged('grid-controls', markup)) {
        gridControlsRegion.innerHTML = markup
      }
    }
    if (statusbarRegion) {
      const markup = this.renderWorkspaceStatusbar()
      if (this.workspaceMarkupChanged('statusbar', markup)) {
        statusbarRegion.innerHTML = markup
      }
    }
    if (chatRegion) {
      const markup = this.renderChat()
      if (this.workspaceMarkupChanged('chat', markup)) {
        chatRegion.innerHTML = markup
        this.restoreChatScroll(chatRegion, previousChatScroll)
      }
    }
    if (overlayRegion) {
      const signature = this.getDialogSignature()

      if (signature !== this.renderedDialogSignature) {
        const draft = this.captureDialogDraft(overlayRegion)
        overlayRegion.innerHTML = this.renderDialog()
        this.restoreDialogDraft(overlayRegion, draft)
        this.renderedDialogSignature = signature
        dialogReplaced = true
      }
    }

    this.ensureSessionSurfaceManager()
    this.reconcileSessionCards(shell)
    this.bindViewActions()
    this.bindDialogActions()
    this.updateConnectivityBanner()
    this.ensureWorkspaceObserver()
    this.applyWorkspacePresentation()
    // A newly added card can change whether a scrollbar is needed, which only
    // settles after this paint. Re-running once more on the next frame keeps
    // native views aligned instead of requiring a manual scroll to correct them.
    this.scheduleWorkspaceLayout()
    if (dialogReplaced && this.activeDialog) {
      this.focusCurrentView()
    }
    return true
  }

  private restoreSidebarProfileMenu(shouldRestore: boolean): void {
    if (!shouldRestore || this.activeDialog) {
      return
    }

    this.root
      .querySelector<HTMLDetailsElement>('.sidebar-profile-menu')
      ?.setAttribute('open', '')
  }

  private workspaceMarkupChanged(region: string, markup: string): boolean {
    if (this.workspaceMarkupCache.get(region) === markup) {
      return false
    }
    this.workspaceMarkupCache.set(region, markup)
    return true
  }

  private captureChatScroll(region: HTMLElement | null): ChatScrollSnapshot | null {
    const scroller = region?.querySelector<HTMLElement>('[data-chat-messages]')

    if (!scroller) {
      return null
    }

    return {
      channelId: scroller.dataset.chatChannelId ?? '',
      clientHeight: scroller.clientHeight,
      loadingMore: scroller.dataset.chatLoadingMore === 'true',
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
    }
  }

  private restoreChatScroll(
    region: HTMLElement,
    previous: ChatScrollSnapshot | null,
  ): void {
    const scroller = region.querySelector<HTMLElement>('[data-chat-messages]')

    if (!scroller) {
      return
    }

    scroller.scrollTop = resolveChatScrollTop(previous, {
      channelId: scroller.dataset.chatChannelId ?? '',
      clientHeight: scroller.clientHeight,
      loadingMore: scroller.dataset.chatLoadingMore === 'true',
      scrollHeight: scroller.scrollHeight,
    })
  }

  private getDialogSignature(): string {
    const dependency = this.activeDialog === 'add-account'
      ? [this.games, this.gameCatalogError]
      : this.activeDialog === 'grid-manager'
        ? [this.configuredAccounts, this.savedGridWorkspaces, this.dialogGridWorkspaceId]
      : this.activeDialog === 'advertise'
        ? [
            this.appAdTestStage,
            this.appAdSubmitting,
            this.appAdSuccess,
            this.myAppAdRequestsLoading,
            this.myAppAdRequests,
            this.appAdPlans,
          ]
      : this.activeDialog === 'extension'
        ? [this.extensionConfig, this.extensionLoading, this.extensionSaving]
      : this.activeDialog === 'plans'
        ? [
            this.permissionService.getCurrentPlan(),
            this.permissionService.getAccountLimit(),
            this.permissionService.canUseFeature('advanced_grids'),
            this.products,
          ]
        : this.activeDialog === 'free-limit'
          ? (() => {
              const account = this.configuredAccounts.find(
                (candidate) => candidate.id === this.dialogAccountId,
              )
              return [
                this.permissionService.getCurrentPlan(),
                this.permissionService.getAccountLimit(account?.gameSlug),
                account?.gameSlug,
              ]
            })()
          : this.activeDialog === 'payment'
            ? [this.paymentLoading, this.paymentError, this.pixPayment]
            : this.activeDialog === 'update'
              ? this.updateState
              : this.activeDialog === 'more-games'
                ? [this.games, this.gameCatalogError]
                : this.activeDialog === 'my-plan'
                  ? this.me
                : this.activeDialog === 'referrals'
                  ? [this.referralLoading, this.referralError, this.referralProgram]
                  : this.activeDialog === 'proxy' || this.activeDialog === 'copy-proxy'
                    ? [
                        this.proxyConfig,
                        this.proxyLoading,
                        this.proxySaving,
                        this.proxyTestResult,
                      ]
                    : this.activeDialog === 'settings'
                      ? [this.resourceUsage, this.resourceUsageLoading]
        : this.configuredAccounts.find(
            (account) => account.id === this.dialogAccountId,
          )?.displayName ?? null

    return JSON.stringify([
      this.activeDialog,
      this.dialogAccountId,
      this.dialogError,
      dependency,
    ])
  }

  private captureDialogDraft(container: HTMLElement): Map<string, string> {
    const draft = new Map<string, string>()
    container
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name], select[name]')
      .forEach((field) => {
        if (!field.name) {
          return
        }

        if (
          field instanceof HTMLInputElement
          && (field.type === 'radio' || field.type === 'checkbox')
        ) {
          if (field.checked) {
            draft.set(field.name, field.value)
          }
          return
        }

        draft.set(field.name, field.value)
      })
    return draft
  }

  private restoreDialogDraft(
    container: HTMLElement,
    draft: ReadonlyMap<string, string>,
  ): void {
    container
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name], select[name]')
      .forEach((field) => {
        const value = draft.get(field.name)

        if (
          field instanceof HTMLInputElement
          && (field.type === 'radio' || field.type === 'checkbox')
        ) {
          if (value !== undefined) {
            field.checked = field.value === value
          }
        } else if (value !== undefined) {
          field.value = value
        }
      })
  }

  private profileDisplayName(): string {
    return this.me?.profile.display_name?.trim()
      || this.session?.user.email?.split('@')[0]
      || 'Minha conta'
  }

  private renderPlanName(): string {
    const plan = this.permissionService.getCurrentPlan()

    return plan === 'FOUNDER' && this.me?.founder_number
      ? `FOUNDER #${String(this.me.founder_number).padStart(4, '0')}`
      : PLAN_PRESENTATION[plan].displayName
  }

  private renderSessionLimitSummary(activeSessions: number): string {
    if (this.permissionService.getCurrentPlan() === 'FREE') {
      return `${activeSessions} ${activeSessions === 1 ? 'aberta' : 'abertas'} · Huntera 3 / demais 2`
    }

    const limit = this.permissionService.getAccountLimit()
    return limit === UNLIMITED_ACCOUNT_LIMIT
      ? `${activeSessions} sessões abertas · ilimitadas`
      : `${activeSessions}/${limit} sessões abertas`
  }

  private renderAccountLimit(limit: number): string {
    return limit === UNLIMITED_ACCOUNT_LIMIT ? 'ilimitadas' : String(limit)
  }

  private renderAccountGameIcon(account: ConfiguredAccount): string {
    const game = this.games.find((candidate) => candidate.slug === account.gameSlug)

    if (game) {
      return this.renderGameIcon(game)
    }

    return `<span aria-hidden="true">${account.gameSlug === CUSTOM_GAME_SLUG ? 'URL' : escapeHtml(account.gameSlug.slice(0, 2).toUpperCase())}</span>`
  }

  private renderAccountTabs(): string {
    return `
      <div class="account-tabs" data-account-tabs aria-label="Contas">
        <button class="account-tabs__nav account-tabs__nav--previous" data-scroll-accounts="previous" type="button" aria-label="Contas anteriores" aria-controls="account-tabs-scroll" hidden>‹</button>
        <div class="account-tabs__scroll" id="account-tabs-scroll" data-account-tabs-scroll role="region" aria-label="Contas configuradas" tabindex="0">
          ${this.configuredAccounts.map((account) => {
            const active = this.permissionService.isSessionActive(account.id)
            const resting = active && this.backgroundAccountIds.has(account.id)
            const proxyState = this.accountProxyStates.get(account.id)
            const proxyEnabled = proxyState?.enabled === true
            const proxyLoading = this.proxyStateLoadingAccountIds.has(account.id)
            const extensionState = this.accountExtensionStates.get(account.id)
            const extensionWithinLimit = extensionState
              ? this.isAccountExtensionWithinLimit(account.id)
              : true
            const extensionEnabled = extensionState?.enabled === true && extensionWithinLimit
            const extensionLoading = this.extensionStateLoadingAccountIds.has(account.id)
            const selected = this.workspaceMode === 'account'
              && active
              && !resting
              && account.id === this.focusedAccountId
            return `
              <div class="account-tab-shell ${selected ? 'is-active' : ''} ${active ? 'is-open' : ''} ${resting ? 'is-resting' : ''} ${account.id === this.reorderedAccountId ? 'is-reordered' : ''}" draggable="${this.mobileSessionMode ? 'false' : 'true'}" data-account-order-id="${escapeHtml(account.id)}">
                <button
                  class="account-tab ${selected ? 'is-active' : ''} ${active ? 'is-open' : ''} ${resting ? 'is-resting' : ''}"
                  data-account-tab
                  data-account-id="${escapeHtml(account.id)}"
                  type="button"
                  ${selected ? 'aria-current="page"' : ''}
                >
                  <span class="account-tab__game-icon">${this.renderAccountGameIcon(account)}</span>
                  <span class="account-tab__copy">
                    <strong>${escapeHtml(account.displayName)}</strong>
                    <small><i class="account-tab__indicator ${active ? 'is-online' : ''}" aria-hidden="true"></i>${escapeHtml(this.gameNameFor(account))} · ${resting ? 'Em descanso' : active ? (this.mobileSessionMode ? 'Conectada' : 'Conectado') : (this.mobileSessionMode ? 'Salva' : 'Offline')}</small>
                  </span>
                </button>
                ${active
                  ? this.mobileSessionMode
                    ? `<button class="account-tab__close" data-close-account data-account-id="${escapeHtml(account.id)}" type="button" aria-label="Fechar sessão ${escapeHtml(account.displayName)}" title="Fechar sessão">×</button>`
                    : `<div class="account-tab__actions">
                      ${this.extensionControlAvailable() ? `<button class="account-tab__action account-tab__action--extension ${extensionEnabled ? 'is-active' : ''}" data-extension-account data-account-id="${escapeHtml(account.id)}" type="button" aria-label="Extensão de ${escapeHtml(account.displayName)}" title="${extensionState && !extensionWithinLimit ? 'Extensão preservada · fora do limite atual' : extensionEnabled ? `${escapeHtml(extensionState?.name ?? 'Extensão')} ativa` : extensionState ? 'Extensão configurada, mas desativada' : 'Configurar extensão por conta'}" ${extensionLoading ? 'disabled' : ''}>${extensionLoading ? '…' : 'E'}</button>` : ''}
                      ${this.proxyControlAvailable() ? `<button class="account-tab__action account-tab__action--proxy ${proxyEnabled ? 'is-active' : ''}" data-toggle-account-proxy data-account-id="${escapeHtml(account.id)}" type="button" aria-label="${proxyEnabled ? 'Desativar' : proxyState ? 'Ativar' : 'Configurar'} proxy de ${escapeHtml(account.displayName)}" title="${proxyEnabled ? 'Proxy ativo · clique para desativar' : proxyState ? 'Proxy salvo · clique para ativar' : 'Configurar proxy'}" ${proxyLoading ? 'disabled' : ''}>${proxyLoading ? '…' : 'P'}</button>` : ''}
                      <button class="account-tab__action account-tab__action--rest ${resting ? 'is-active' : ''}" ${resting ? 'data-restore-account' : 'data-background-account'} data-account-id="${escapeHtml(account.id)}" type="button" aria-label="${resting ? 'Restaurar' : 'Colocar em descanso'} ${escapeHtml(account.displayName)}" title="${resting ? 'Em descanso · clique para restaurar' : 'Descansar tela mantendo o jogo ativo'}">${resting ? '<span class="account-tab__play" aria-hidden="true">▶</span>' : uiIcon('moon')}</button>
                      <button class="account-tab__action account-tab__action--close" data-close-account data-account-id="${escapeHtml(account.id)}" type="button" aria-label="Fechar sessão ${escapeHtml(account.displayName)}" title="Fechar sessão">${uiIcon('close')}</button>
                    </div>`
                  : `<button class="account-tab__close" data-delete-account data-account-id="${escapeHtml(account.id)}" type="button" aria-label="Remover conta ${escapeHtml(account.displayName)}" title="Remover conta">×</button>`}
              </div>
            `
          }).join('')}
        </div>
        <button class="account-tabs__nav account-tabs__nav--next" data-scroll-accounts="next" type="button" aria-label="Próximas contas" aria-controls="account-tabs-scroll" hidden>›</button>
        <button class="account-tab account-tab--add" data-add-account type="button">
          ${uiIcon('add')}
          <span class="account-tab__copy"><strong>Adicionar</strong><small>Nova conta</small></span>
        </button>
      </div>
    `
  }

  private renderNotificationCenter(): string {
    const notifications = this.notificationCenter.list()
    const unread = this.notificationCenter.getUnreadCount()

    return `
      <details class="toolbar-menu toolbar-menu--end notification-menu" data-toolbar-menu>
        <summary class="header-icon-button" aria-label="Notificações${unread ? `, ${unread} não lidas` : ''}">
          ${uiIcon('bell')}
          ${unread ? `<b class="notification-badge">${Math.min(unread, 99)}</b>` : ''}
        </summary>
        <section class="notification-popover" aria-label="Central de notificações">
          <header>
            <div><strong>Notificações</strong><small>Atualizações do AltGrid</small></div>
            ${unread ? '<button class="text-button" data-read-all-notifications type="button">Marcar lidas</button>' : ''}
          </header>
          <div class="notification-list">
            ${notifications.length > 0
              ? notifications.map((notification) => `
                <button class="notification-item ${notification.read ? '' : 'is-unread'}" data-read-notification="${escapeHtml(notification.id)}" type="button">
                  <span class="notification-item__dot notification-item__dot--${notification.severity}" aria-hidden="true"></span>
                  <span><strong>${escapeHtml(notification.title)}</strong><small>${escapeHtml(notification.summary)}</small><time>${escapeHtml(formatDate(notification.occurredAt))}</time></span>
                </button>
              `).join('')
              : '<p class="notification-empty">Tudo tranquilo por aqui.</p>'}
          </div>
          <button class="notification-update-action" data-open-update type="button">Verificar atualização</button>
        </section>
      </details>
    `
  }

  private renderWorkspaceToolbar(): string {
    const active = this.permissionService.getActiveSessionCount()

    return `
      ${this.renderAccountTabs()}
      <div class="header-actions ${this.mobileSessionMode ? 'header-actions--mobile' : ''}">
        ${this.mobileSessionMode ? `
          <div class="header-utility-actions" role="group" aria-label="Notificações">
            ${this.renderNotificationCenter()}
          </div>
        ` : `
          <div class="header-view-actions" role="group" aria-label="Visualização">
            <button
              class="header-command-button ${this.workspaceMode === 'grid' ? 'is-active' : ''}"
              data-toggle-grid
              type="button"
              aria-label="Ver contas em grade"
              aria-pressed="${this.workspaceMode === 'grid'}"
            >
              ${uiIcon('grid')}
              <span class="header-command-button__copy"><strong>Grades</strong><small>${active} ${active === 1 ? 'aberta' : 'abertas'}</small></span>
            </button>
          </div>
          <div class="header-utility-actions" role="group" aria-label="Notificações">
            ${this.renderNotificationCenter()}
          </div>
        `}
      </div>
    `
  }

  private renderUpdateButton(): string {
    const updateReady = ['available', 'downloaded'].includes(this.updateState.status)

    return `
      <button class="header-icon-button update-button" data-open-update type="button" aria-label="Atualizações">
        ${uiIcon('refresh')}
        ${updateReady ? '<i class="update-available-dot" aria-hidden="true"></i>' : ''}
      </button>
    `
  }

  private renderView(): string {
    switch (this.currentView) {
      case 'checking':
        return this.renderChecking()
      case 'signup':
        return this.renderSignup()
      case 'forgot':
        return this.renderForgotPassword()
      case 'forgot-sent':
        return this.renderForgotPasswordSent()
      case 'confirm-email':
        return this.renderConfirmEmail()
      case 'reset':
        return this.renderResetPassword()
      case 'password-updated':
        return this.renderPasswordUpdated()
      case 'authenticated':
        return this.renderAuthenticated()
      case 'login':
      default:
        return this.renderLogin()
    }
  }

  private renderChecking(): string {
    const error = this.sessionCheckError

    return `
      <section class="auth-card auth-card--checking" aria-live="polite">
        ${
          error
            ? '<span class="message-icon message-icon--warning" aria-hidden="true">!</span>'
            : '<span class="spinner spinner--large" aria-hidden="true"></span>'
        }
        <h1>Verificando sua sessão</h1>
        <p class="auth-card__subtitle">${
          error ? escapeHtml(error) : 'Só um instante…'
        }</p>
        ${
          error
            ? '<button class="button button--secondary" data-retry-session type="button">Tentar novamente</button>'
            : ''
        }
      </section>
    `
  }

  private renderLogin(): string {
    return `
      <section class="auth-card" aria-labelledby="login-title">
        <div class="auth-card__heading">
          <p class="eyebrow">Bem-vindo de volta</p>
          <h1 id="login-title">Entrar na AltGrid</h1>
          <p class="auth-card__subtitle">Acesse suas sessões e configurações.</p>
        </div>

        ${this.renderAlertSlot()}

        <form id="login-form" novalidate>
          ${this.renderEmailField('login-email')}
          ${this.renderPasswordField('login-password', 'Senha', 'current-password')}

          <button class="button button--primary" data-submit type="submit">
            Entrar
          </button>
        </form>

        ${this.renderGoogleAuthButton()}

        <div class="auth-links" aria-label="Outras opções">
          <button class="text-button text-button--strong" data-view="signup" type="button">
            Criar conta
          </button>
          <span aria-hidden="true">•</span>
          <button class="text-button" data-view="forgot" type="button">
            Esqueci minha senha
          </button>
        </div>
      </section>
    `
  }

  private renderSignup(): string {
    return `
      <section class="auth-card auth-card--signup" aria-labelledby="signup-title">
        <div class="auth-card__heading">
          <p class="eyebrow">Nova conta</p>
          <h1 id="signup-title">Criar conta</h1>
          <p class="auth-card__subtitle">Use seu e-mail para acessar suas contas.</p>
        </div>

        ${this.renderAlertSlot()}

        <form id="signup-form" novalidate>
          ${this.renderEmailField('signup-email')}
          ${this.renderPasswordField('signup-password', 'Senha', 'new-password')}
          ${this.renderPasswordField(
            'signup-password-confirmation',
            'Confirmar senha',
            'new-password',
          )}
          <div class="field field--referral">
            <label for="signup-referral-code">Código de indicação <small>opcional</small></label>
            <input id="signup-referral-code" name="referralCode" type="text" inputmode="text" autocomplete="off" maxlength="13" placeholder="HUNT-XXXXXXXX" value="${escapeHtml(this.signupReferralCode)}" aria-describedby="signup-referral-code-help signup-referral-code-error" />
            <small id="signup-referral-code-help">Se você recebeu um link, o código aparece preenchido automaticamente.</small>
            <span class="field__error" id="signup-referral-code-error"></span>
          </div>

          <button class="button button--primary" data-submit type="submit">
            Criar conta
          </button>
        </form>

        ${this.renderGoogleAuthButton('Criar conta com Google')}

        <div class="auth-links auth-links--single">
          <button class="text-button" data-view="login" type="button">
            Já tenho uma conta
          </button>
        </div>
      </section>
    `
  }

  private renderForgotPassword(): string {
    return `
      <section class="auth-card" aria-labelledby="forgot-title">
        <button class="back-button" data-view="login" type="button" aria-label="Voltar ao login">
          <span aria-hidden="true">←</span> Voltar
        </button>
        <div class="auth-card__heading">
          <p class="eyebrow">Acesso à conta</p>
          <h1 id="forgot-title">Recuperar senha</h1>
          <p class="auth-card__subtitle">
            Enviaremos um link para você definir uma nova senha.
          </p>
        </div>

        ${this.renderAlertSlot()}

        <form id="forgot-form" novalidate>
          ${this.renderEmailField('forgot-email')}
          <button class="button button--primary" data-submit type="submit">
            Enviar link de recuperação
          </button>
        </form>
      </section>
    `
  }

  private renderForgotPasswordSent(): string {
    return this.renderMessageCard(
      'E-mail enviado',
      'Se existir uma conta com esse e-mail, enviaremos as instruções de recuperação.',
      'Voltar para o login',
      'login',
    )
  }

  private renderConfirmEmail(): string {
    const email = escapeHtml(this.pendingConfirmationEmail)
    const statusClass = this.confirmationResendStatus === 'error'
      ? ' confirmation-status--error'
      : this.confirmationResendStatus === 'sent'
        ? ' confirmation-status--success'
        : ''
    const buttonLabel = this.confirmationResendStatus === 'sending'
      ? '<span class="spinner spinner--green" aria-hidden="true"></span> Reenviando…'
      : 'Reenviar e-mail'

    return `
      <section class="auth-card auth-card--message auth-card--confirmation" aria-labelledby="message-title">
        <span class="message-icon" aria-hidden="true">@</span>
        <p class="eyebrow">Confirmação necessária</p>
        <h1 id="message-title">Verifique seu e-mail</h1>
        <p class="auth-card__subtitle">Enviamos o link de confirmação${email ? ` para <strong>${email}</strong>` : ''}. Abra a mensagem para ativar sua conta e depois volte ao AltGrid.</p>
        <div class="confirmation-checklist" aria-label="Ajuda para encontrar o e-mail">
          <span>Confira a caixa de entrada</span>
          <span>Veja também Spam ou Lixo eletrônico</span>
          <span>O remetente será AltGrid</span>
        </div>
        <p class="confirmation-status${statusClass}" role="status" aria-live="polite">${escapeHtml(this.confirmationResendMessage)}</p>
        <div class="confirmation-actions">
          <button class="button button--secondary" data-resend-confirmation type="button" ${!email || this.confirmationResendStatus === 'sending' ? 'disabled' : ''}>${buttonLabel}</button>
          <button class="text-button text-button--strong" data-view="login" type="button">Voltar para o login</button>
        </div>
      </section>
    `
  }

  private renderResetPassword(): string {
    return `
      <section class="auth-card" aria-labelledby="reset-title">
        <div class="auth-card__heading">
          <p class="eyebrow">Recuperação de conta</p>
          <h1 id="reset-title">Definir nova senha</h1>
          <p class="auth-card__subtitle">Escolha uma nova senha para sua conta.</p>
        </div>

        ${this.renderAlertSlot()}

        <form id="reset-form" novalidate>
          ${this.renderPasswordField('reset-password', 'Nova senha', 'new-password')}
          ${this.renderPasswordField(
            'reset-password-confirmation',
            'Confirmar nova senha',
            'new-password',
          )}
          <button class="button button--primary" data-submit type="submit">
            Salvar nova senha
          </button>
        </form>
      </section>
    `
  }

  private renderPasswordUpdated(): string {
    return this.renderMessageCard(
      'Senha atualizada',
      'Sua nova senha já está ativa. Você pode continuar com segurança.',
      'Continuar',
      this.session ? 'authenticated' : 'login',
    )
  }

  private renderGameIcon(game: PublicGame): string {
    const iconUrl = getBundledGameIconUrl(game.slug)
      ?? normalizeSafeGameUrl(game.icon_url)

    return iconUrl
      ? `<img src="${escapeHtml(iconUrl)}" alt="" loading="lazy" />`
      : `<span aria-hidden="true">${escapeHtml(game.name.slice(0, 2).toUpperCase())}</span>`
  }

  private renderSidebar(): string {
    const activeAccount = this.configuredAccounts.find(
      (account) => account.id === this.focusedAccountId,
    )
    const selectedSlug = activeAccount?.gameSlug ?? this.games[0]?.slug
    const featuredGameSlugs = new Set(
      this.appAds
        .filter((ad) => ad.category === 'game' && ad.game_slug)
        .map((ad) => ad.game_slug as string),
    )
    // Keep sponsored games prominent, then order each group by the live
    // presence counter returned by the API. The counter is refreshed with the
    // presence heartbeat, so the sidebar reorders automatically without an
    // app update when player activity changes.
    const onlinePlayersFor = (game: typeof this.games[number]): number => {
      const value = this.appMetrics?.games?.[game.slug]
        ?? (localAppAdPreviewEnabled() && game.slug === LOCAL_APP_AD_PREVIEW.game_slug ? 128 : 0)
      return Number.isFinite(value) ? Math.max(0, value) : 0
    }
    const visibleGames = [...this.games]
      .sort((left, right) =>
        Number(featuredGameSlugs.has(right.slug)) - Number(featuredGameSlugs.has(left.slug))
        || onlinePlayersFor(right) - onlinePlayersFor(left)
        || (left.sort_order ?? 0) - (right.sort_order ?? 0)
        || left.name.localeCompare(right.name, 'pt-BR'))
      .slice(0, 6)
    const activeSessions = this.permissionService.getActiveSessionCount()
    const currentPlan = this.permissionService.getCurrentPlan()
    const profilePlanBadge = renderPlanBadge(currentPlan, this.me?.founder_number ?? null)

    return `
      <aside class="game-sidebar" data-sidebar-region aria-label="Navegação principal">
        <div class="game-sidebar__catalog">
          <div class="sidebar-heading">
            <div class="sidebar-heading__copy">
              <span class="sidebar-eyebrow">Biblioteca</span>
              <div class="sidebar-heading__title">
                <p class="sidebar-label">Jogos suportados</p>
                <span class="sidebar-game-count" aria-label="${this.games.length} jogos no catálogo">${this.games.length}</span>
              </div>
            </div>
            <button class="sidebar-collapse-button" data-toggle-sidebar type="button" aria-label="Ocultar painel lateral" title="Ocultar painel lateral">‹</button>
          </div>
          <nav class="game-list" aria-label="Jogos suportados">
            ${visibleGames.length > 0
              ? visibleGames.map((game) => {
                const featured = featuredGameSlugs.has(game.slug)
                const hasOnlineMetric = Object.prototype.hasOwnProperty.call(this.appMetrics?.games ?? {}, game.slug)
                  || (localAppAdPreviewEnabled() && game.slug === LOCAL_APP_AD_PREVIEW.game_slug)
                const onlinePlayers = hasOnlineMetric ? onlinePlayersFor(game) : undefined
                return `
                <button class="game-list__item ${game.slug === selectedSlug ? 'is-selected' : ''} ${featured ? 'is-sponsored' : ''}" data-select-game="${escapeHtml(game.slug)}" type="button">
                  <span class="game-list__icon">${this.renderGameIcon(game)}</span>
                  <span class="game-list__copy"><span>${escapeHtml(game.name)}${featured ? '<em>Destaque</em>' : ''}</span>${typeof onlinePlayers === 'number' ? `<small title="Usuários ativos neste jogo pelo AltGrid"><b aria-hidden="true"></b>${onlinePlayers.toLocaleString('pt-BR')} online</small>` : ''}</span>
                  <i aria-label="${game.slug === selectedSlug ? 'Selecionado' : 'Disponível'}"></i>
                </button>
              `}).join('')
              : '<p class="sidebar-empty">O catálogo será carregado quando os serviços estiverem disponíveis.</p>'}
          </nav>
          <button class="sidebar-more" data-open-dialog="more-games" type="button"><span aria-hidden="true">▦</span> Ver mais jogos</button>
        </div>

        ${this.renderSidebarAdvertising()}

        <nav class="sidebar-menu" aria-label="Preferências">
          <p class="sidebar-menu__label">Conta e preferências</p>
          <button data-open-dialog="referrals" type="button"><span aria-hidden="true">✦</span><b>Indique e ganhe</b><i aria-hidden="true">›</i></button>
          <button data-open-dialog="settings" type="button"><span aria-hidden="true">⚙</span><b>Configurações</b><i aria-hidden="true">›</i></button>
          <button data-open-dialog="shortcuts" type="button"><span aria-hidden="true">⌨</span><b>Atalhos</b><i aria-hidden="true">›</i></button>
          <button data-open-dialog="about" type="button"><span aria-hidden="true">ⓘ</span><b>Sobre o AltGrid</b><i aria-hidden="true">›</i></button>
        </nav>

        <details class="toolbar-menu sidebar-profile-menu" data-toolbar-menu>
          <summary class="sidebar-profile" aria-label="Abrir perfil">
            <span class="profile-avatar">${escapeHtml(this.profileDisplayName().slice(0, 1).toUpperCase())}</span>
            <span class="sidebar-profile__details"><span class="profile-name-with-plan"><strong>${escapeHtml(this.profileDisplayName())}</strong>${profilePlanBadge}</span><small>Minha conta</small></span>
            ${uiIcon('chevron')}
          </summary>
          <div class="menu-popover menu-popover--up sidebar-profile-popover" aria-label="Conta e plano">
            <div class="sidebar-profile-popover__identity">
              <span class="profile-avatar">${escapeHtml(this.profileDisplayName().slice(0, 1).toUpperCase())}</span>
              <div>
                <small>Conta AltGrid</small>
                <span class="profile-name-with-plan"><strong>${escapeHtml(this.profileDisplayName())}</strong>${profilePlanBadge}</span>
              </div>
            </div>
            <div class="sidebar-profile-popover__plan">
              <div class="sidebar-profile-popover__plan-label"><span class="sidebar-profile-popover__plan-dot"></span><small>Plano ativo</small></div>
              <div class="sidebar-profile-popover__plan-main"><strong>${escapeHtml(this.renderPlanName())}</strong><span>${uiIcon('chevron')}</span></div>
              <div class="sidebar-profile-popover__usage"><span class="visually-hidden">${escapeHtml(this.renderSessionLimitSummary(activeSessions))}</span><span><b>${activeSessions}</b> ${activeSessions === 1 ? 'sessão aberta' : 'sessões abertas'}</span><span>${escapeHtml(this.renderSessionLimitSummary(activeSessions).split('·').at(-1)?.trim() ?? '')}</span></div>
            </div>
            <p class="sidebar-profile-popover__section-label">Sua conta</p>
            <div class="sidebar-profile-popover__actions">
              <button class="menu-item" data-open-dialog="my-plan" type="button"><span><i aria-hidden="true">${uiIcon('gauge')}</i><span><b>Meu plano</b><small>Benefícios e limites</small></span></span><b aria-hidden="true">›</b></button>
              <button class="menu-item" data-open-dialog="referrals" type="button"><span><i aria-hidden="true">${uiIcon('gift')}</i><span><b>Indique e ganhe</b><small>Convites e recompensas</small></span></span><b aria-hidden="true">›</b></button>
              <button class="menu-item sidebar-profile-popover__advertise" data-open-dialog="advertise" type="button"><span><i aria-hidden="true">${uiIcon('external')}</i><span><b>Anuncie no AltGrid</b><small>Divulgue seu jogo, produto ou site</small></span></span><b aria-hidden="true">›</b></button>
              <button class="menu-item" data-open-dialog="about" type="button"><span><i aria-hidden="true">${uiIcon('user')}</i><span><b>Minha conta</b><small>Perfil e informações</small></span></span><b aria-hidden="true">›</b></button>
              <button class="menu-item" data-open-dialog="settings" type="button"><span><i aria-hidden="true">${uiIcon('settings')}</i><span><b>Configurações</b><small>Preferências do aplicativo</small></span></span><b aria-hidden="true">›</b></button>
            </div>
            <div class="sidebar-profile-popover__footer-actions">
              ${this.adminAccess ? `<a class="menu-item sidebar-profile-popover__admin" href="/admin"><span><i aria-hidden="true">${uiIcon('grid')}</i><span><b>Painel administrativo</b><small>Gerenciar o AltGrid</small></span></span>${uiIcon('external')}</a>` : ''}
              <button class="menu-item menu-item--danger" id="logout-button" type="button"><span><i aria-hidden="true">${uiIcon('power')}</i><span><b>Sair da conta</b><small>Encerrar esta sessão</small></span></span></button>
            </div>
          </div>
        </details>
      </aside>
    `
  }

  private renderMobileNavigation(): string {
    const chatState = this.chatService?.getState()
    const chatOpen = Boolean(chatState?.open)
    const chatUnread = Object.values(chatState?.unread ?? {}).reduce(
      (total, count) => total + Math.max(0, count),
      0,
    )
    const profilePlanBadge = renderPlanBadge(
      this.permissionService.getCurrentPlan(),
      this.me?.founder_number ?? null,
    )

    return `
      <nav class="mobile-navigation" data-mobile-navigation-region aria-label="Navegação principal">
        <button class="mobile-navigation__item ${chatOpen ? '' : 'is-active'}" data-mobile-home type="button" aria-current="${chatOpen ? 'false' : 'page'}">
          ${uiIcon('screens')}
          <span>Contas</span>
        </button>
        <button class="mobile-navigation__item" data-open-dialog="more-games" type="button">
          ${uiIcon('globe')}
          <span>Jogos</span>
        </button>
        <button class="mobile-navigation__item mobile-navigation__item--primary" data-add-account type="button" aria-label="Adicionar conta">
          <span class="mobile-navigation__add">${uiIcon('add')}</span>
          <span>Adicionar</span>
        </button>
        ${this.chatService ? `
          <button class="mobile-navigation__item ${chatOpen ? 'is-active' : ''}" data-open-chat type="button" aria-label="${chatOpen ? 'Fechar chat' : 'Abrir chat'}${chatUnread ? `, ${chatUnread} ${chatUnread === 1 ? 'mensagem não lida' : 'mensagens não lidas'}` : ''}" aria-pressed="${chatOpen}">
            ${uiIcon('chat')}
            <span>Chat</span>
            ${chatUnread ? `<b class="chat-unread-badge" aria-hidden="true">${Math.min(chatUnread, 99)}</b>` : ''}
          </button>
        ` : `
          <button class="mobile-navigation__item" data-open-dialog="my-plan" type="button">
            ${uiIcon('grid')}
            <span>Plano</span>
          </button>
        `}
        <details class="toolbar-menu mobile-profile-menu" data-toolbar-menu>
          <summary class="mobile-navigation__item" aria-label="Perfil, plano e configurações">
            <span class="profile-avatar">${escapeHtml(this.profileDisplayName().slice(0, 1).toUpperCase())}</span>
            <span>Perfil</span>
          </summary>
          <div class="menu-popover menu-popover--up mobile-profile-popover" aria-label="Conta e plano">
            <div class="mobile-profile-popover__heading">
              <span class="profile-avatar">${escapeHtml(this.profileDisplayName().slice(0, 1).toUpperCase())}</span>
              <span><span class="profile-name-with-plan"><strong>${escapeHtml(this.profileDisplayName())}</strong>${profilePlanBadge}</span><small>${escapeHtml(this.renderPlanName())}</small></span>
            </div>
            <button class="menu-item" data-open-dialog="my-plan" type="button">Meu plano <b aria-hidden="true">›</b></button>
            <button class="menu-item" data-open-dialog="referrals" type="button">Indique e ganhe <b aria-hidden="true">›</b></button>
            <button class="menu-item" data-open-dialog="settings" type="button">Configurações <b aria-hidden="true">›</b></button>
            <button class="menu-item" data-open-dialog="about" type="button">Sobre o AltGrid <b aria-hidden="true">›</b></button>
            <button class="menu-item menu-item--danger" id="logout-button" type="button">Sair</button>
          </div>
        </details>
      </nav>
    `
  }

  private renderGridControls(): string {
    if (this.workspaceMode !== 'grid') {
      return ''
    }

    const modes = this.gridLayoutService.listModes().map((item) => {
      const selected = item.mode === this.gridMode
      const capacities: Partial<Record<GridMode, number>> = {
        '1x1': 1,
        '1x2': 2,
        '2x1': 2,
        '2x2': 4,
        '3x2': 6,
        '3x3': 9,
        '4x4': 16,
      }
      const capacity = capacities[item.mode]
      return `<button
        class="menu-item ${selected ? 'is-selected' : ''}"
        data-grid-mode="${item.mode}"
        type="button"
        role="menuitemradio"
        aria-checked="${selected}"
        ${item.available ? '' : 'data-grid-locked="true"'}
      >
        <span class="grid-mode-option"><b>${item.mode === 'auto' ? 'Automático' : item.mode}</b><small>${capacity ? `${capacity} ${capacity === 1 ? 'conta' : 'contas'} por página` : 'Ajusta conforme as contas'}</small></span>
        ${item.available ? (selected ? '<span aria-hidden="true">✓</span>' : '') : '<span class="menu-lock">PRO</span>'}
      </button>`
    }).join('')

    const activeIds = new Set(this.getActiveAccounts().map((account) => account.id))
    const workspaceTabs = this.savedGridWorkspaces.map((grid) => {
      const selected = grid.id === this.selectedGridWorkspaceId
      const openCount = grid.accountIds.filter((id) => activeIds.has(id)).length
      return `<span class="grid-workspace-tab ${selected ? 'is-active' : ''}">
        <button data-select-grid-workspace="${escapeHtml(grid.id)}" type="button" aria-pressed="${selected}"><strong>${escapeHtml(grid.name)}</strong><small>${openCount}/${grid.accountIds.length}</small></button>
        <button data-edit-grid-workspace="${escapeHtml(grid.id)}" type="button" aria-label="Editar ${escapeHtml(grid.name)}" title="Editar grade">•••</button>
      </span>`
    }).join('')

    return `
      <div class="workspace-modebar">
        <span class="workspace-modebar__title"><b aria-hidden="true">▦</b> Organizar telas</span>
        <div class="grid-workspace-tabs" aria-label="Grades salvas">
          <button class="grid-workspace-all ${this.selectedGridWorkspaceId === null ? 'is-active' : ''}" data-select-grid-workspace="" type="button" aria-pressed="${this.selectedGridWorkspaceId === null}"><strong>Todas</strong><small>${activeIds.size}</small></button>
          ${workspaceTabs}
          <button class="grid-workspace-add" data-create-grid-workspace type="button" aria-label="Criar nova grade" title="Criar nova grade">＋ Nova grade</button>
        </div>
        <span class="workspace-modebar__page" data-grid-page-summary>Página 1 · preparando</span>
        <details class="toolbar-menu" data-toolbar-menu>
          <summary class="tool-button" aria-label="Escolher layout">Layout <small data-grid-mode-label>${this.gridMode === 'auto' ? 'Auto' : this.gridMode}</small></summary>
          <div class="menu-popover menu-popover--grid" role="menu" aria-label="Layouts de sessão">${modes}</div>
        </details>
      </div>
    `
  }

  private renderSidebarAdvertising(): string {
    const ad = this.appAds[0]
    if (!ad) {
      return `
        <section class="sidebar-advertising sidebar-advertising--empty" aria-label="Publicidade no AltGrid">
          <span class="sidebar-advertising__label">Espaço publicitário</span>
          <strong>Mostre sua marca para jogadores idle</strong>
          <p>Divulgue jogos, produtos ou sites dentro do AltGrid.</p>
          <button data-open-dialog="advertise" type="button">Anuncie no app <span aria-hidden="true">↗</span></button>
        </section>
      `
    }
    return `
      <section class="sidebar-advertising" aria-label="Conteúdo patrocinado">
        <span class="sidebar-advertising__label">Patrocinado</span>
        ${ad.image_url ? `<img src="${escapeHtml(ad.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<span class="sidebar-advertising__art" aria-hidden="true">AD</span>'}
        <div class="sidebar-advertising__copy">
          <small>${escapeHtml(ad.advertiser_name)}</small>
          <strong>${escapeHtml(ad.title)}</strong>
          <p>${escapeHtml(ad.description)}</p>
        </div>
        <button data-sponsored-link="${escapeHtml(ad.id)}" data-sponsored-placement="sidebar" type="button">${escapeHtml(ad.cta_label)} <span aria-hidden="true">↗</span></button>
        ${ad.id === LOCAL_APP_AD_PREVIEW_ID ? `<button class="sidebar-advertising__preview" data-preview-sponsored-popup="${escapeHtml(ad.id)}" type="button">Ver pop-up de teste</button>` : ''}
        <button class="sidebar-advertising__sell" data-open-dialog="advertise" type="button">Anuncie aqui</button>
      </section>
    `
  }

  private renderMyAppAdRequests(): string {
    const labels: Record<UserAppAdRequest['status'], string> = {
      pending: 'Aguardando análise',
      reviewing: 'Em análise',
      payment_pending: 'PIX liberado',
      approved: 'Pago · campanha ativa',
      rejected: 'Ajustes necessários',
      cancelled: 'Cancelado',
    }
    if (this.myAppAdRequestsLoading) {
      return '<section class="advertise-orders"><h3>Seus pedidos</h3><p class="advertise-orders__empty">Carregando seus pedidos…</p></section>'
    }
    if (this.myAppAdRequests.length === 0) return ''
    return `<section class="advertise-orders" aria-labelledby="advertise-orders-title">
      <div class="advertise-orders__heading"><div><small>ACOMPANHAMENTO</small><h3 id="advertise-orders-title">Seus pedidos</h3></div><span>Você só paga depois da aprovação.</span></div>
      <div class="advertise-orders__list">${this.myAppAdRequests.map((request) => `
        <article class="advertise-order is-${escapeHtml(request.status)}">
          <div><span class="advertise-order__status">${escapeHtml(labels[request.status])}</span><strong>${escapeHtml(request.title)}</strong><small>${escapeHtml(request.advertiser_name)} · ${request.requested_days} dias</small></div>
          <strong>${escapeHtml(formatCurrency(request.quoted_amount, request.currency))}</strong>
          ${request.admin_notes ? `<p>${escapeHtml(request.admin_notes)}</p>` : ''}
          ${request.status === 'payment_pending'
            ? `<button class="button button--primary" data-pay-app-ad="${escapeHtml(request.id)}" type="button">Gerar PIX e pagar</button>`
            : ''}
        </article>`).join('')}</div>
    </section>`
  }

  private renderAppAdFlow(): string {
    const stages = [
      ['Crie', 'Plano e campanha'],
      ['Aprovação', 'Conferência AltGrid'],
      ['PIX', 'Pagamento seguro'],
      ['No ar', 'Ativação automática'],
    ] as const
    return `<ol class="advertise-flow" aria-label="Etapas da contratação">${stages.map(([title, subtitle], index) => {
      const number = index + 1
      const state = this.appAdTestStage === number
        ? 'is-active'
        : this.appAdTestStage > number ? 'is-complete' : ''
      return `<li class="${state}"><b>${this.appAdTestStage > number ? '✓' : number}</b><span><strong>${title}</strong><small>${subtitle}</small></span></li>`
    }).join('')}</ol>`
  }

  private renderAppAdTestStage(): string {
    if (this.appAdTestStage === 2) {
      return `<section class="advertise-test-stage advertise-test-stage--review" aria-live="polite">
        <span class="advertise-test-stage__icon">⌕</span><p class="eyebrow">PEDIDO RECEBIDO</p>
        <h3>Campanha aguardando sua aprovação</h3>
        <p>O pedido fictício chegou ao painel administrativo. Nesta etapa você confere plano, conteúdo, destino e valor antes de liberar qualquer cobrança.</p>
        <div class="advertise-test-summary"><span><small>Campanha</small><strong>Teste AltGrid · jogos idle</strong></span><span><small>Plano</small><strong>Destaque FREE · 7 dias</strong></span><span><small>Orçamento</small><strong>R$ 35,00</strong></span><span><small>Status</small><strong>Em análise</strong></span></div>
        <div class="modal__actions"><button class="button button--primary" data-test-ad-stage="3" type="button">Aprovar e liberar PIX</button><button class="button button--secondary" data-test-ad-stage="1" type="button">Voltar ao formulário</button></div>
      </section>`
    }
    if (this.appAdTestStage === 3) {
      return `<section class="advertise-test-stage advertise-test-stage--pix" aria-live="polite">
        <span class="advertise-test-stage__icon">PIX</span><p class="eyebrow">PAGAMENTO LIBERADO</p>
        <h3>PIX disponível para o anunciante</h3>
        <p>Esta é apenas uma demonstração local. Nenhum PIX real foi criado e nenhum valor deve ser pago.</p>
        <div class="advertise-test-pix"><div class="advertise-test-pix__qr" aria-label="QR Code ilustrativo"><i></i><i></i><i></i><i></i><b>TESTE</b></div><div><small>VALOR DA CAMPANHA</small><strong>R$ 35,00</strong><span>Expira em 30 minutos</span><code>00020126...ALTGRID.TESTE.LOCAL...6304</code></div></div>
        <div class="advertise-test-warning">Ambiente de teste local · sem cobrança</div>
        <div class="modal__actions"><button class="button button--primary" data-test-ad-stage="4" type="button">Simular pagamento aprovado</button><button class="button button--secondary" data-test-ad-stage="2" type="button">Voltar</button></div>
      </section>`
    }
    return `<section class="advertise-test-stage advertise-test-stage--active" aria-live="polite">
      <span class="advertise-test-stage__icon">✓</span><p class="eyebrow">CAMPANHA ATIVA</p>
      <h3>O anúncio de teste está no ar</h3>
      <p>Após a confirmação do pagamento, a campanha entra automaticamente na lateral e, no plano escolhido, também no pop-up das contas FREE.</p>
      <div class="advertise-test-metrics"><span><small>Status</small><strong>Ativo</strong></span><span><small>Período</small><strong>7 dias</strong></span><span><small>Posições</small><strong>Lateral + pop-up</strong></span></div>
      <div class="modal__actions"><button class="button button--primary" data-test-ad-stage="1" type="button">Fazer outro teste</button><button class="button button--secondary" data-close-dialog type="button">Fechar</button></div>
    </section>`
  }

  private renderGoogleAuthButton(label = 'Continuar com Google'): string {
    return `
      <div class="auth-provider">
        <div class="auth-provider__divider"><span>ou</span></div>
        <button class="button button--google" data-google-auth type="button">
          <span class="google-mark" aria-hidden="true">G</span>
          <span>${label}</span>
        </button>
      </div>
    `
  }

  private readGridModePreference(): GridMode {
    try {
      const stored = localStorage.getItem(GRID_MODE_STORAGE_KEY)
      return stored && (GRID_MODES as readonly string[]).includes(stored)
        ? stored as GridMode
        : 'auto'
    } catch {
      return 'auto'
    }
  }

  private storeGridModePreference(mode: GridMode): void {
    try {
      localStorage.setItem(GRID_MODE_STORAGE_KEY, mode)
    } catch {
      // The selected layout remains active for the current run.
    }
  }

  private loadSavedGridWorkspaces(userId: string): void {
    this.savedGridWorkspaces = this.gridWorkspaceService.list(
      userId,
      this.configuredAccounts.map((account) => account.id),
    )
    try {
      const selected = localStorage.getItem(`${SELECTED_GRID_STORAGE_KEY}:${userId}`)
      this.selectedGridWorkspaceId = selected
        && this.savedGridWorkspaces.some((grid) => grid.id === selected)
        ? selected
        : null
    } catch { this.selectedGridWorkspaceId = null }
  }

  private selectGridWorkspace(gridId: string | null): void {
    const userId = this.session?.user.id
    this.selectedGridWorkspaceId = gridId
      && this.savedGridWorkspaces.some((grid) => grid.id === gridId)
      ? gridId
      : null
    this.gridPageIndex = 0
    this.maximizedAccountId = null
    if (userId) {
      try {
        const key = `${SELECTED_GRID_STORAGE_KEY}:${userId}`
        if (this.selectedGridWorkspaceId) localStorage.setItem(key, this.selectedGridWorkspaceId)
        else localStorage.removeItem(key)
      } catch { /* selection remains active during this run */ }
    }
  }

  private selectedGridWorkspace(): SavedGridWorkspace | null {
    return this.savedGridWorkspaces.find((grid) => grid.id === this.selectedGridWorkspaceId) ?? null
  }

  private getGridVisibleAccounts(): ConfiguredAccount[] {
    const active = this.getActiveAccounts()
    if (this.workspaceMode !== 'grid' || !this.selectedGridWorkspaceId) return active
    const selected = this.selectedGridWorkspace()
    if (!selected) return active
    const accountIds = new Set(selected.accountIds)
    return active.filter((account) => accountIds.has(account.id))
  }

  private configFlag(key: string): boolean {
    const value = this.appConfig[key]
    return value === true || value === 'true'
  }

  private configText(key: string): string | null {
    const value = this.appConfig[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  private readEcoModePreference(): boolean {
    try {
      return localStorage.getItem(ECO_MODE_STORAGE_KEY) !== 'false'
    } catch {
      return true
    }
  }

  private storeEcoModePreference(enabled: boolean): void {
    try {
      localStorage.setItem(ECO_MODE_STORAGE_KEY, String(enabled))
    } catch {
      // The native state remains authoritative if local storage is unavailable.
    }
  }

  private readEcoBackgroundFpsPreference(): EcoBackgroundFps {
    try {
      const value = Number(localStorage.getItem(ECO_BACKGROUND_FPS_STORAGE_KEY))
      return value === 10 || value === 30 ? value : 20
    } catch {
      return 20
    }
  }

  private storeEcoBackgroundFpsPreference(fps: EcoBackgroundFps): void {
    try {
      localStorage.setItem(ECO_BACKGROUND_FPS_STORAGE_KEY, String(fps))
    } catch {
      // Keep the in-memory preference when local storage is unavailable.
    }
  }

  private readSessionFrameRatePreferences(): Map<string, number> {
    try {
      const parsed = JSON.parse(localStorage.getItem(SESSION_FPS_STORAGE_KEY) ?? '{}') as unknown

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return new Map()
      }

      return new Map(Object.entries(parsed).flatMap(([accountId, value]) => (
        typeof value === 'number'
          && Number.isInteger(value)
          && value >= 1
          && value <= 240
          ? [[accountId, value] as const]
          : []
      )))
    } catch {
      return new Map()
    }
  }

  private storeSessionFrameRatePreferences(): void {
    try {
      localStorage.setItem(
        SESSION_FPS_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this.sessionFrameRates)),
      )
    } catch {
      // Native frame-rate state remains usable for the current run.
    }
  }

  private sessionFrameRateFor(accountId: string): number {
    return this.sessionFrameRates.get(accountId) ?? 0
  }

  private renderAuthShowcase(): string {
    return `
      <aside class="auth-showcase" aria-label="Conheça o AltGrid">
        <div class="auth-showcase__glow" aria-hidden="true"></div>
        <div class="auth-showcase__brand">
          <span class="auth-showcase__logo"><img src="${altgridLogoUrl}" alt="" /></span>
          <span><small>SEU HUB DE JOGOS IDLE</small><strong>AltGrid</strong></span>
        </div>
        <div class="auth-showcase__content">
          <span class="auth-showcase__pill"><i aria-hidden="true"></i> Tudo em um só lugar</span>
          <h2>Suas contas.<br /><em>Seu ritmo.</em></h2>
          <p>Organize múltiplas sessões, acompanhe seus jogos e mantenha o controle em qualquer tela.</p>
          <div class="auth-showcase__features" aria-label="Recursos principais">
            <span><b aria-hidden="true">▦</b><small>Multissessão</small><strong>Contas organizadas</strong></span>
            <span><b aria-hidden="true">◇</b><small>Experiência</small><strong>Desktop e Android</strong></span>
            <span><b aria-hidden="true">⌁</b><small>Privacidade</small><strong>Sessões isoladas</strong></span>
          </div>
        </div>
        <div class="auth-showcase__footer">
          <span class="status-dot" aria-hidden="true"></span>
          <span>Serviços AltGrid protegidos e online</span>
        </div>
      </aside>
    `
  }

  private syncAccountTabsForGridPage(visibleAccountIds: readonly string[]): void {
    const filterToCurrentPage = this.workspaceMode === 'grid'
    const visible = new Set(visibleAccountIds)
    this.root
      .querySelectorAll<HTMLElement>('[data-account-order-id]')
      .forEach((tab) => {
        const accountId = tab.dataset.accountOrderId
        tab.hidden = filterToCurrentPage && (!accountId || !visible.has(accountId))
      })

    const scroller = this.root.querySelector<HTMLElement>('[data-account-tabs-scroll]')
    if (scroller && filterToCurrentPage) scroller.scrollLeft = 0
    queueMicrotask(() => this.updateAccountTabNavigation())
  }

  private updateAccountTabNavigation(): void {
    const accountScroller = this.root.querySelector<HTMLElement>('[data-account-tabs-scroll]')
    const previous = this.root.querySelector<HTMLButtonElement>('[data-scroll-accounts="previous"]')
    const next = this.root.querySelector<HTMLButtonElement>('[data-scroll-accounts="next"]')
    if (!accountScroller) return

    const overflow = accountScroller.scrollWidth > accountScroller.clientWidth + 2
    if (previous) {
      previous.hidden = !overflow
      previous.disabled = accountScroller.scrollLeft <= 1
    }
    if (next) {
      next.hidden = !overflow
      next.disabled = accountScroller.scrollLeft + accountScroller.clientWidth
        >= accountScroller.scrollWidth - 1
    }
  }

  private readSessionInterfaceScalePreferences(): Map<string, number> {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(SESSION_INTERFACE_SCALE_STORAGE_KEY) ?? '{}',
      ) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return new Map()
      }

      return new Map(Object.entries(parsed).flatMap(([accountId, value]) => (
        typeof value === 'number'
          && Number.isFinite(value)
          && value >= 0.5
          && value <= 1
          ? [[accountId, Math.round(value * 100) / 100] as const]
          : []
      )))
    } catch {
      return new Map()
    }
  }

  private storeSessionInterfaceScalePreferences(): void {
    try {
      localStorage.setItem(
        SESSION_INTERFACE_SCALE_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this.sessionInterfaceScales)),
      )
    } catch {
      // Native zoom remains usable for the current run.
    }
  }

  private sessionInterfaceScaleFor(accountId: string): number | null {
    return this.sessionInterfaceScales.get(accountId) ?? null
  }

  private syncEcoMode(): Promise<void> {
    const target = this.ecoModeSupported
      && this.ecoModeRequested
      && this.permissionService.canUseFeature('eco_mode')
    const operation = this.ecoModeOperation
      .catch(() => undefined)
      .then(async () => {
        if (!this.ecoModeSupported) {
          this.ecoModeEffective = false
          return
        }

        const confirmed = await this.sessionLauncher.setEcoMode(
          target,
          this.ecoBackgroundFps,
        )
        this.ecoModeEffective = confirmed
      })

    this.ecoModeOperation = operation.catch(() => {
      this.ecoModeEffective = false
    })
    return operation
  }

  private async syncEcoModeWithRetry(): Promise<void> {
    try {
      await this.syncEcoMode()
    } catch {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 140))
      await this.syncEcoMode()
    }
  }

  private async updateEcoModePreference(
    enabled: boolean,
    input: HTMLInputElement | HTMLButtonElement,
  ): Promise<void> {
    const previous = this.ecoModeRequested
    this.ecoModeRequested = enabled
    this.storeEcoModePreference(enabled)
    input.disabled = true

    try {
      await this.syncEcoModeWithRetry()
      if (this.ecoModeEffective !== enabled) {
        throw new Error('Eco Mode indisponível')
      }
      this.showSessionAlert('')
    } catch {
      this.ecoModeRequested = previous
      this.storeEcoModePreference(previous)
      await this.syncEcoMode().catch(() => undefined)
      this.showSessionAlert('Não foi possível alterar o Eco Mode.')
    }

    this.render()
  }

  private async updateEcoBackgroundFpsPreference(
    fps: EcoBackgroundFps,
    input: HTMLSelectElement,
  ): Promise<void> {
    const previous = this.ecoBackgroundFps
    this.ecoBackgroundFps = fps
    this.storeEcoBackgroundFpsPreference(fps)
    input.disabled = true

    try {
      await this.syncEcoModeWithRetry()
      this.showSessionAlert('')
    } catch {
      this.ecoBackgroundFps = previous
      this.storeEcoBackgroundFpsPreference(previous)
      await this.syncEcoMode().catch(() => undefined)
      this.showSessionAlert('Não foi possível alterar o limite do Eco Mode.')
    }

    this.render()
  }

  private async updateSessionFrameRate(
    account: ConfiguredAccount,
    fps: number,
    input: HTMLInputElement,
  ): Promise<void> {
    const previous = this.sessionFrameRateFor(account.id)
    input.disabled = true

    try {
      await this.sessionLauncher.setFrameRate(account, fps)
      if (fps === 0) {
        this.sessionFrameRates.delete(account.id)
      } else {
        this.sessionFrameRates.set(account.id, fps)
      }
      this.storeSessionFrameRatePreferences()
      input.value = fps === 0 ? '' : String(fps)
      this.showSessionAlert('')
    } catch {
      input.value = previous === 0 ? '' : String(previous)
      this.showSessionAlert('Não foi possível alterar o FPS desta conta.')
    } finally {
      if (input.isConnected) {
        input.disabled = false
      }
    }
  }

  private async updateSessionInterfaceScale(
    account: ConfiguredAccount,
    scale: number | null,
    select: HTMLSelectElement,
  ): Promise<boolean> {
    const previous = this.sessionInterfaceScaleFor(account.id)
    select.disabled = true

    try {
      await this.sessionLauncher.setInterfaceScale?.(account, scale)
      if (scale === null) {
        this.sessionInterfaceScales.delete(account.id)
      } else {
        this.sessionInterfaceScales.set(account.id, scale)
      }
      this.storeSessionInterfaceScalePreferences()
      select.value = scale === null ? '' : String(Math.round(scale * 100))
      this.showSessionAlert('')
      return true
    } catch {
      select.value = previous === null ? '' : String(Math.round(previous * 100))
      this.showSessionAlert('Não foi possível alterar a escala desta conta.')
      return false
    } finally {
      if (select.isConnected) {
        select.disabled = false
      }
    }
  }

  private requiresMinimumVersion(): boolean {
    // The server's minimum_version policy targets the Windows desktop release.
    // Android uses its own APK update channel and must never be blocked by a
    // desktop version number.
    if (this.mobileSessionMode) {
      return false
    }

    const minimumVersion = this.configText('minimum_version')
    return minimumVersion !== null
      && compareVersions(APP_VERSION, minimumVersion) === -1
  }

  private serviceStatusLabel(): string {
    switch (this.serviceStatus) {
      case 'online':
        return 'Online'
      case 'offline':
        return 'Indisponível'
      case 'checking':
        return 'Verificando'
      default:
        return 'Não verificado'
    }
  }

  private serviceStatusDotClass(): string {
    return this.serviceStatus === 'offline' ? 'is-offline' : ''
  }

  private gameForChatChannel(
    channel: ChatState['channels'][number] | undefined,
  ): PublicGame | null {
    if (!channel?.game_id) {
      return null
    }

    return this.games.find((game) => game.id === channel.game_id) ?? null
  }

  private renderChatChannelIcon(
    channel: ChatState['channels'][number] | undefined,
  ): string {
    if (channel?.type === 'global') {
      return uiIcon('globe')
    }
    if (channel?.type === 'direct') {
      return uiIcon('user')
    }

    const game = this.gameForChatChannel(channel)
    return game ? this.renderGameIcon(game) : uiIcon('chat')
  }

  private visibleChatChannels(channels: ChatState['channels']): ChatState['channels'] {
    const global = channels.filter((channel) => channel.type === 'global')
    const directs = channels.filter((channel) => channel.type === 'direct')
    const games = channels.filter((channel) => channel.type === 'game')
      .filter((channel) => (
        this.selectedChatGameChannelIds === null
        || this.selectedChatGameChannelIds.has(channel.id)
      ))
    return [...global, ...directs, ...games]
  }

  private readChatGameSelection(channels: ChatState['channels']): void {
    if (this.selectedChatGameChannelIds !== null || channels.length === 0) {
      return
    }

    try {
      const stored = JSON.parse(
        localStorage.getItem(CHAT_GAME_SELECTION_STORAGE_KEY) ?? 'null',
      )
      this.selectedChatGameChannelIds = Array.isArray(stored)
        ? new Set(stored.filter((id): id is string => typeof id === 'string'))
        : new Set(channels.filter((channel) => channel.type === 'game').map((channel) => channel.id))
    } catch {
      this.selectedChatGameChannelIds = new Set(
        channels.filter((channel) => channel.type === 'game').map((channel) => channel.id),
      )
    }
  }

  private setChatGameChannelVisible(channelId: string, visible: boolean): void {
    const state = this.chatService?.getState()
    if (!state) {
      return
    }
    this.readChatGameSelection(state.channels)
    if (visible) {
      this.selectedChatGameChannelIds?.add(channelId)
    } else {
      this.selectedChatGameChannelIds?.delete(channelId)
      if (state.selectedChannelId === channelId) {
        const global = state.channels.find((channel) => channel.type === 'global')
        if (global) {
          void this.chatService?.selectChannel(global.id)
        }
      }
    }
    try {
      localStorage.setItem(
        CHAT_GAME_SELECTION_STORAGE_KEY,
        JSON.stringify([...this.selectedChatGameChannelIds ?? []]),
      )
    } catch {
      // Chat preferences remain available for the current session.
    }
    this.render()
  }

  private renderChatMessage(
    message: ChatState['messages'][number],
    channel: ChatState['channels'][number] | undefined,
  ): string {
    const own = message.user_id === this.session?.user.id
    const badge = renderPlanBadge(message.plan, message.founder_number)

    return `
      <article class="chat-message ${own ? 'is-own' : ''}" data-chat-message-channel="${escapeHtml(message.channel_id)}">
        <span class="chat-message__avatar" title="${escapeHtml(channel?.name ?? 'Chat AltGrid')}">${this.renderChatChannelIcon(channel)}</span>
        <div class="chat-message__bubble">
          <header>
            <strong>${escapeHtml(message.display_name || 'Jogador')}</strong>
            ${badge}
            <time>${escapeHtml(new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.created_at)))}</time>
            ${own ? '' : `<details class="chat-message__menu">
              <summary aria-label="Opções da mensagem">•••</summary>
              <div>
                ${channel?.type === 'direct' ? '' : `<button data-direct-chat-user="${escapeHtml(message.user_id)}" type="button">Mensagem direta</button>`}
                <button data-mention-chat-user="${escapeHtml(message.display_name || 'Jogador')}" type="button">Mencionar @nick</button>
                <button data-report-chat-message="${escapeHtml(message.id)}" type="button">Denunciar</button>
                <button data-block-chat-user="${escapeHtml(message.user_id)}" type="button">Bloquear localmente</button>
              </div>
            </details>`}
          </header>
          <p>${escapeHtml(message.message)}</p>
        </div>
      </article>
    `
  }

  private renderChat(): string {
    if (!this.chatService) {
      return ''
    }

    const state = this.chatService.getState()
    this.readChatGameSelection(state.channels)
    const visibleChannels = this.visibleChatChannels(state.channels)
    const currentChannel = state.channels.find(
      (channel) => channel.id === state.selectedChannelId,
    )

    if (!state.open) {
      return ''
    }

    const communityStats = currentChannel?.type === 'global' && this.appMetrics
      ? `<div class="chat-community-stats" title="Ativos nos últimos ${Math.round(this.appMetrics.active_window_seconds / 60)} minutos"><span class="chat-community-stat chat-community-stat--online"><i aria-hidden="true"></i><strong>${this.appMetrics.users.active.toLocaleString('pt-BR')}</strong><small>online</small></span><span class="chat-community-stat"><strong>${this.appMetrics.users.total.toLocaleString('pt-BR')}</strong><small>usuários</small></span></div>`
      : ''

    return `
      <aside class="chat-panel" aria-label="Chat AltGrid">
        <header class="chat-panel__header">
          <div class="chat-panel__identity">
            <span class="chat-panel__game-icon">${this.renderChatChannelIcon(currentChannel)}</span>
            <div><strong>${currentChannel?.type === 'direct' ? 'Mensagem direta' : 'Chat'}</strong><small>${escapeHtml(currentChannel?.name ?? 'AltGrid')}</small>${communityStats}</div>
          </div>
          <div class="chat-panel__actions">
            ${currentChannel?.type === 'direct' ? `<button class="chat-panel__delete" data-delete-direct-chat="${escapeHtml(currentChannel.id)}" data-direct-chat-name="${escapeHtml(currentChannel.name)}" type="button" aria-label="Apagar conversa com ${escapeHtml(currentChannel.name)}" title="Apagar esta conversa">${uiIcon('trash')}</button>` : ''}
            <button data-close-chat type="button" aria-label="Fechar chat">×</button>
          </div>
        </header>
        <nav class="chat-channels" aria-label="Canais do chat">
          ${visibleChannels.map((channel) => {
            const unread = state.unread[channel.id] ?? 0
            return `
              <button class="${channel.id === state.selectedChannelId ? 'is-active' : ''}" data-chat-channel="${escapeHtml(channel.id)}" data-chat-channel-type="${escapeHtml(channel.type)}" type="button">
                <span class="chat-channel__icon">${this.renderChatChannelIcon(channel)}</span>
                <span>${escapeHtml(channel.name)}</span>
                ${unread ? `<b class="chat-channel__badge">${Math.min(unread, 99)}</b>` : ''}
              </button>
            `
          }).join('')}
        </nav>
        <details class="chat-channel-picker">
          <summary>Selecionar chats</summary>
          <div class="chat-channel-picker__menu">
            ${state.channels.filter((channel) => channel.type === 'game').map((channel) => `
              <label>
                <input type="checkbox" data-chat-game-toggle="${escapeHtml(channel.id)}" ${this.selectedChatGameChannelIds?.has(channel.id) ? 'checked' : ''} />
                <span class="chat-channel__icon">${this.renderChatChannelIcon(channel)}</span>
                <span>${escapeHtml(channel.name)}</span>
              </label>
            `).join('') || '<small>Nenhum chat de jogo disponível.</small>'}
          </div>
        </details>
        <div class="chat-messages" data-chat-messages data-chat-channel-id="${escapeHtml(state.selectedChannelId ?? '')}" data-chat-loading-more="${state.loadingMore}" aria-live="polite">
          ${state.hasMore ? `<button class="chat-load-more" data-chat-load-more type="button" ${state.loadingMore ? 'disabled' : ''}>${state.loadingMore ? 'Carregando…' : 'Mensagens anteriores'}</button>` : ''}
          ${state.loading
            ? '<span class="chat-loading"><i class="spinner spinner--green"></i> Carregando conversa…</span>'
            : state.messages.length > 0
              ? state.messages.map((message) => this.renderChatMessage(message, currentChannel)).join('')
              : `<p class="chat-empty">${currentChannel?.type === 'direct' ? `Envie uma mensagem privada para ${escapeHtml(currentChannel.name)}.` : 'Seja a primeira pessoa a conversar por aqui.'}</p>`}
        </div>
        ${state.banned || state.mutedUntil
          ? `<p class="chat-moderation">${state.banned ? 'Seu acesso ao chat está bloqueado.' : `Silenciado até ${escapeHtml(formatDate(state.mutedUntil))}.`} ${escapeHtml(state.moderationReason ?? '')}</p>`
          : ''}
        ${state.error ? `<p class="chat-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        <form class="chat-composer" id="chat-form">
          <textarea name="message" maxlength="500" rows="2" placeholder="${currentChannel?.type === 'direct' ? `Mensagem para ${escapeHtml(currentChannel.name)}…` : 'Escreva uma mensagem…'}" aria-label="Mensagem" ${state.banned ? 'disabled' : ''}></textarea>
          <button type="submit" aria-label="Enviar mensagem" ${state.sending || state.banned ? 'disabled' : ''}>➤</button>
        </form>
      </aside>
    `
  }

  private async saveChatNickname(form: HTMLFormElement): Promise<void> {
    if (!this.backendApi?.updateProfile) return
    const field = form.elements.namedItem('display_name')
    if (!(field instanceof HTMLInputElement)) return

    this.chatNicknameSaving = true
    this.dialogError = null
    const openChatAfterSave = !this.nicknameOnboarding
    this.render()
    try {
      const response = await this.backendApi.updateProfile({ display_name: field.value })
      if (this.me) this.me = { ...this.me, profile: response.profile }
      this.nicknameOnboarding = false
      this.activeDialog = null
      if (openChatAfterSave) {
        await this.chatService?.open(this.focusedGameId())
      }
    } catch (error) {
      this.dialogError = error instanceof Error ? error.message : 'Não foi possível salvar o nick.'
    } finally {
      this.chatNicknameSaving = false
      this.render()
    }
  }

  private renderAuthenticated(): string {
    const userId = escapeHtml(this.session?.user.id ?? '')
    const activeAccounts = this.getActiveAccounts()
    const chatOpen = Boolean(this.chatService?.getState().open)

    return `
      <section class="session-shell ${this.mobileSessionMode ? 'is-mobile-session' : ''} ${chatOpen ? 'has-chat-open' : ''} ${this.sidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${this.utilityBarCollapsed ? 'is-utility-collapsed' : ''}" data-authenticated-shell data-user-id="${userId}" aria-labelledby="accounts-title">
        <h1 class="visually-hidden" id="accounts-title">Minhas contas e sessões</h1>
        ${this.mobileSessionMode ? '' : this.renderSidebar()}
        ${this.mobileSessionMode ? '' : `<button class="sidebar-edge-toggle" data-toggle-sidebar type="button" aria-label="Mostrar painel lateral" title="Mostrar painel lateral" ${this.sidebarCollapsed ? '' : 'hidden'}>›</button>`}
        <div class="workspace-column">
          <div class="backend-region" data-backend-region>${this.renderBackendStatus()}</div>
          <div data-grid-controls-region>${this.renderGridControls()}</div>
          <div class="session-workspace" data-session-workspace>
            <div class="session-grid" data-session-grid aria-live="polite">
              ${activeAccounts.map((account) => this.renderSessionCard(account)).join('')}
            </div>
            <nav class="session-pagination" data-session-pagination aria-label="Páginas da grade" hidden>
              <button data-grid-page="previous" type="button" aria-label="Página anterior">‹</button>
              <span data-grid-page-status aria-live="polite">1/1</span>
              <button data-grid-page="next" type="button" aria-label="Próxima página">›</button>
            </nav>
            <div class="session-empty" data-session-empty ${activeAccounts.length > 0 ? 'hidden' : ''}>
              <div class="session-empty__glow" aria-hidden="true"></div>
              <div class="session-empty__hero">
                <span class="session-empty__mark" aria-hidden="true"><img src="${altgridLogoUrl}" alt="" /></span>
                <span class="session-empty__eyebrow"><i></i> CENTRAL PRONTA</span>
                <h2>Seu grid começa aqui</h2>
                <p>Abra suas contas em ambientes isolados e organize tudo em uma única central.</p>
                <button class="button button--primary session-empty__action" data-add-account type="button">${uiIcon('add')} Adicionar primeira conta</button>
              </div>
              <div class="session-empty__features" aria-label="Recursos de desempenho">
                <span>${uiIcon('cpu')}<b>FPS adaptativo</b><small>Prioridade para a tela em uso</small></span>
                <span>${uiIcon('memory')}<b>Memória monitorada</b><small>Consumo visível em tempo real</small></span>
                <span>${uiIcon('leaf')}<b>Eco inteligente</b><small>Sessões ocultas mais leves</small></span>
              </div>
            </div>
          </div>
          <div data-statusbar-region>${this.renderWorkspaceStatusbar()}</div>
        </div>
        <div data-chat-region>${this.renderChat()}</div>
        ${this.mobileSessionMode ? this.renderMobileNavigation() : ''}
        <div class="form-alert" id="session-alert" role="alert" aria-live="polite"></div>
        <button class="screens-only-exit" data-exit-screens-only type="button">Sair</button>
      </section>
    `
  }

  private focusedGameId(): string | null {
    const account = this.configuredAccounts.find(
      (candidate) => candidate.id === this.focusedAccountId,
    )

    if (!account || account.gameSlug === CUSTOM_GAME_SLUG) {
      return null
    }

    return this.games.find((game) => game.slug === account.gameSlug)?.id ?? null
  }

  private getActiveAccounts(): ConfiguredAccount[] {
    const activeIds = new Set(this.permissionService.getActiveSessionIds())
    return this.configuredAccounts.filter((account) => activeIds.has(account.id))
  }

  private gameNameFor(account: ConfiguredAccount): string {
    if (account.gameSlug === CUSTOM_GAME_SLUG) {
      return 'URL personalizada'
    }

    return this.games.find((game) => game.slug === account.gameSlug)?.name
      ?? account.gameSlug
  }

  private renderBackendStatus(): string {
    if (this.backendLoadStatus === 'loading') {
      return `
        <div class="data-notice" role="status" aria-live="polite">
          <span class="spinner spinner--green" aria-hidden="true"></span>
          Carregando plano e jogos…
        </div>
      `
    }

    const notices: string[] = []
    const minimumVersion = this.configText('minimum_version')

    if (this.configFlag('maintenance')) {
      notices.push(
        '<div class="data-notice data-notice--warning" role="status">Serviços em manutenção. Alguns recursos online podem ficar temporariamente indisponíveis.</div>',
      )
    }

    if (minimumVersion && this.requiresMinimumVersion()) {
      notices.push(
        `<div class="data-notice data-notice--warning" role="status">Atualização necessária: instale a versão ${escapeHtml(minimumVersion)} ou superior.</div>`,
      )
    }

    if (this.backendLoadError) {
      notices.push(`
        <div class="data-notice data-notice--warning" role="status">
          <span>${escapeHtml(this.backendLoadError)}</span>
          <button class="text-button text-button--strong" data-retry-backend type="button">
            Tentar novamente
          </button>
        </div>
      `)
      return notices.join('')
    }

    if (this.serviceStatus === 'offline') {
      notices.push(`
        <div class="data-notice data-notice--warning" role="status">
          <span>Serviço AltGrid indisponível no momento.</span>
          <button class="text-button text-button--strong" data-retry-backend type="button">Tentar novamente</button>
        </div>
      `)
    }

    if (this.offlineLicenseSource === 'cache') {
      notices.push('<div class="data-notice" role="status">Modo offline · licença assinada válida.</div>')
    } else if (this.offlineLicenseSource === 'safe_free') {
      notices.push('<div class="data-notice data-notice--warning" role="status">Não foi possível verificar sua licença. Conecte-se à internet para atualizar.</div>')
    }

    return notices.join('')
  }

  private renderSessionCard(account: ConfiguredAccount): string {
    const muted = this.mutedAccountIds.has(account.id)
    const resting = this.backgroundAccountIds.has(account.id)
    const frameRate = this.sessionFrameRateFor(account.id)
    const interfaceScale = this.sessionInterfaceScaleFor(account.id)
    const mobileFullscreen = this.mobileSessionMode
      && this.screensOnly
      && this.maximizedAccountId === account.id

    return `
      <article class="session-card ${resting ? 'is-resting' : ''}" data-session-card data-account-id="${escapeHtml(account.id)}">
        <header class="session-card__header">
          <div class="session-card__identity">
            <strong data-session-name>${escapeHtml(account.displayName)}</strong>
            <span data-session-game>${escapeHtml(this.gameNameFor(account))}</span>
          </div>
          <details class="session-menu" data-session-menu>
            <summary class="session-menu__trigger" aria-label="Opções de ${escapeHtml(account.displayName)}">⋯</summary>
            <div class="menu-popover session-menu__popover" role="menu">
              <header class="session-menu__heading">
                <span>${this.renderAccountGameIcon(account)}</span>
                <div><strong>${escapeHtml(account.displayName)}</strong><small>${escapeHtml(this.gameNameFor(account))} · ${resting ? 'Em descanso' : 'Conectado'}</small></div>
              </header>

              <section class="session-menu__group" aria-label="Ações da tela">
                <span class="session-menu__label">Tela</span>
                <div class="session-menu__action-grid">
                  <button class="session-menu__action" data-reload-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('refresh')}</i><span>Recarregar</span></button>
                  <button class="session-menu__action" data-maximize-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('screens')}</i><span>${this.mobileSessionMode ? (mobileFullscreen ? 'Sair da tela cheia' : 'Tela cheia · zoom automático') : 'Maximizar'}</span></button>
                  <button class="session-menu__action ${muted ? 'is-active' : ''}" data-toggle-session-mute data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('volume')}</i><span>${muted ? 'Ativar som' : 'Silenciar'}</span></button>
                  ${this.mobileSessionMode ? '' : `<button class="session-menu__action ${resting ? 'is-active' : ''}" ${resting ? 'data-restore-account' : 'data-background-account'} data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('moon')}</i><span>${resting ? 'Despertar' : 'Descansar'}</span></button>`}
                </div>
              </section>

              ${this.frameRateControlSupported || this.interfaceScaleControlSupported ? `<section class="session-menu__group" aria-label="Desempenho">
                <span class="session-menu__label">Desempenho</span>
                <div class="session-menu__controls">
                  ${this.frameRateControlSupported ? `<label class="session-menu__control">
                    <span><i>${uiIcon('gauge')}</i><b>FPS</b><small>Vazio = Auto</small></span>
                    <input data-session-frame-rate data-account-id="${escapeHtml(account.id)}" type="number" inputmode="numeric" min="0" max="240" step="1" value="${frameRate === 0 ? '' : frameRate}" placeholder="Auto" aria-label="FPS de ${escapeHtml(account.displayName)}" />
                  </label>` : ''}
                  ${this.interfaceScaleControlSupported ? `<label class="session-menu__control">
                    <span><i>${uiIcon('screens')}</i><b>Interface</b><small>Mais espaço no HUD</small></span>
                    <select data-session-interface-scale data-account-id="${escapeHtml(account.id)}" aria-label="Escala da interface de ${escapeHtml(account.displayName)}">
                      <option value="" ${interfaceScale === null ? 'selected' : ''}>Automático</option>
                      ${[50, 55, 60, 67, 75, 80, 90, 100].map((percent) => `<option value="${percent}" ${interfaceScale === percent / 100 ? 'selected' : ''}>${percent}%</option>`).join('')}
                    </select>
                  </label>` : ''}
                  ${this.interfaceScaleControlSupported ? `<button class="session-menu__scale-reset" data-reset-session-scale data-account-id="${escapeHtml(account.id)}" type="button"><i>${uiIcon('refresh')}</i><span><b>Restaurar escala do jogo</b><small>Corrige zoom acidental sem apagar seus dados</small></span></button>` : ''}
                </div>
              </section>` : ''}

              <section class="session-menu__group" aria-label="Configuração da conta">
                <span class="session-menu__label">Conta</span>
                <div class="session-menu__account-grid">
                  <button class="session-menu__row" data-rename-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('edit')}</i><span>Renomear</span></button>
                  ${this.proxyControlAvailable() ? `<button class="session-menu__row" data-copy-proxy-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('copy')}</i><span>Copiar proxy</span></button>` : ''}
                  ${this.extensionControlAvailable() ? `<button class="session-menu__row" data-extension-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('puzzle')}</i><span>Extensão</span></button>` : ''}
                  ${this.proxyControlAvailable() ? `<button class="session-menu__row" data-proxy-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('route')}</i><span>Proxy</span></button>` : ''}
                </div>
              </section>

              <footer class="session-menu__footer">
                <button class="session-menu__close" data-close-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('power')}</i><span>Fechar sessão</span></button>
                <div>
                  <button class="session-menu__danger" data-clear-session-data data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('trash')}</i><span>Limpar dados</span></button>
                  <button class="session-menu__danger" data-delete-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem"><i>${uiIcon('trash')}</i><span>Excluir conta</span></button>
                </div>
              </footer>
            </div>
          </details>
        </header>
        <div class="session-surface" data-session-surface-id="${escapeHtml(account.id)}" ${this.mobileSessionMode ? `data-native-session-host role="region" aria-label="Jogo ${escapeHtml(this.gameNameFor(account))} da conta ${escapeHtml(account.displayName)}"` : 'data-focus-account'} data-account-id="${escapeHtml(account.id)}" tabindex="0">
          ${this.renderSessionSurfaceContent(account)}
        </div>
      </article>
    `
  }

  private utilityRestTargets(): ConfiguredAccount[] {
    const activeAccounts = this.getActiveAccounts()

    if (this.workspaceMode === 'grid' && !this.maximizedAccountId) {
      return this.getGridVisibleAccounts()
    }

    const targetId = this.maximizedAccountId ?? this.focusedAccountId
    const target = activeAccounts.find((account) => account.id === targetId)
      ?? activeAccounts[0]
    return target ? [target] : []
  }

  private renderWorkspaceUtilityBar(): string {
    if (this.mobileSessionMode) {
      return ''
    }

    const activeAccounts = this.getActiveAccounts()
    const restTargets = this.utilityRestTargets()
    const restingCount = activeAccounts.filter(
      (account) => this.backgroundAccountIds.has(account.id),
    ).length
    const wakesTargets = restTargets.length > 0
      && restTargets.every((account) => this.backgroundAccountIds.has(account.id))
    const totalPrivateKb = this.resourceUsage.reduce(
      (total, usage) => total + finiteResourceValue(usage.privateKb),
      0,
    )
    const totalCpu = Math.min(999, this.resourceUsage.reduce(
      (total, usage) => total + finiteResourceValue(usage.cpuPercent),
      0,
    ))
    const ecoAvailable = this.ecoModeSupported
      && this.permissionService.canUseFeature('eco_mode')
    const chatState = this.chatService?.getState()
    const chatOpen = Boolean(chatState?.open)
    const chatUnread = Object.values(chatState?.unread ?? {}).reduce(
      (total, count) => total + Math.max(0, count),
      0,
    )
    const adaptiveEcoFps = activeAccounts.length >= 8
      ? Math.min(this.ecoBackgroundFps, 5)
      : activeAccounts.length >= 4
        ? Math.min(this.ecoBackgroundFps, 10)
        : this.ecoBackgroundFps

    return `
      <section class="workspace-utility" aria-label="Central de desempenho" data-workspace-utility>
        <div class="workspace-utility__metrics" aria-label="Uso das sessões">
          <span class="utility-live-dot ${this.resourceUsageLoading ? 'is-loading' : ''}" aria-hidden="true"></span>
          <span class="utility-metric" title="CPU usada pelos processos das contas">
            ${uiIcon('cpu')}
            <span><small>CPU</small><strong data-utility-cpu>${this.resourceUsage.length > 0 ? `${totalCpu.toFixed(totalCpu >= 100 ? 0 : 1)}%` : '—'}</strong></span>
          </span>
          <span class="utility-metric" title="Memória privada usada pelas contas">
            ${uiIcon('memory')}
            <span><small>RAM</small><strong data-utility-memory>${this.resourceUsage.length > 0 ? escapeHtml(formatMemoryKb(totalPrivateKb)) : '—'}</strong></span>
          </span>
          <span class="utility-session-count"><strong>${activeAccounts.length}</strong> ${activeAccounts.length === 1 ? 'sessão' : 'sessões'}${restingCount > 0 ? ` · <b>${restingCount} descansando</b>` : ''}</span>
          <button class="utility-refresh" data-refresh-resource-usage type="button" aria-label="Atualizar dados de desempenho" title="Atualizar agora" ${this.resourceUsageLoading ? 'disabled' : ''}>${uiIcon('refresh')}</button>
        </div>
        <div class="workspace-utility__actions" role="group" aria-label="Utilitários das sessões">
          <button class="utility-action ${chatOpen ? 'is-active' : ''}" data-open-chat type="button" aria-label="${chatOpen ? 'Fechar chat' : 'Abrir chat'}${chatUnread ? `, ${chatUnread} ${chatUnread === 1 ? 'mensagem não lida' : 'mensagens não lidas'}` : ''}" aria-pressed="${chatOpen}">${uiIcon('chat')}<span>Chat</span>${chatUnread ? `<b class="chat-unread-badge" aria-hidden="true">${Math.min(chatUnread, 99)}</b>` : ''}</button>
          <button class="utility-action" data-open-rmt type="button" aria-label="Abrir RMT no Discord"><strong>RMT</strong></button>
          <button class="utility-action ${this.screensOnly ? 'is-active' : ''}" data-toggle-screens-only type="button" aria-label="${this.screensOnly ? 'Sair de Somente telas' : 'Ativar Somente telas'}" aria-pressed="${this.screensOnly}">${uiIcon('screens')}<span>Somente telas</span></button>
          <button class="utility-action utility-action--rest ${wakesTargets ? 'is-resting' : ''}" data-toggle-workspace-rest type="button" ${restTargets.length > 0 ? '' : 'disabled'} aria-label="${wakesTargets ? 'Despertar' : 'Descansar'} ${this.workspaceMode === 'grid' ? 'contas da grade' : 'conta atual'}">
            ${uiIcon('moon')}<span>${wakesTargets ? 'Despertar' : 'Descanso'}</span>
          </button>
          <div class="utility-eco ${this.ecoModeEffective ? 'is-active' : ''}">
            <button data-toggle-eco-mode type="button" role="switch" aria-label="${this.ecoModeEffective ? 'Desligar Eco Mode' : 'Ligar Eco Mode'}" aria-checked="${this.ecoModeEffective}" ${ecoAvailable ? '' : 'disabled'}>
              ${uiIcon('leaf')}<span><small>Eco Mode</small><strong>${this.ecoModeEffective ? 'Ligado' : 'Desligado'}</strong></span><i aria-hidden="true"></i>
            </button>
            <label title="Limite adaptativo atual: ${adaptiveEcoFps} FPS nas contas secundárias"><span class="visually-hidden">FPS em segundo plano</span><select data-eco-background-fps ${ecoAvailable ? '' : 'disabled'} aria-label="FPS máximo em segundo plano"><option value="10" ${this.ecoBackgroundFps === 10 ? 'selected' : ''}>Até 10 FPS</option><option value="20" ${this.ecoBackgroundFps === 20 ? 'selected' : ''}>Até 20 FPS</option><option value="30" ${this.ecoBackgroundFps === 30 ? 'selected' : ''}>Até 30 FPS</option></select></label>
          </div>
          <button class="utility-collapse-button" data-toggle-utility-bar type="button" aria-label="Ocultar barra de utilitários" title="Ocultar barra de utilitários">⌄</button>
        </div>
      </section>
    `
  }

  private renderWorkspaceStatusbar(): string {
    if (this.mobileSessionMode) {
      return ''
    }

    return `
      ${this.renderWorkspaceUtilityBar()}
      <button class="utility-edge-toggle" data-toggle-utility-bar type="button" aria-label="Mostrar barra de utilitários" title="Mostrar barra de utilitários" ${this.utilityBarCollapsed ? '' : 'hidden'}>⌃</button>
    `
  }

  private renderSavedAccounts(): string {
    const inactiveAccounts = this.configuredAccounts.filter(
      (account) => !this.permissionService.isSessionActive(account.id),
    )

    if (inactiveAccounts.length === 0) {
      return ''
    }

    return `
      <div class="saved-accounts">
        <span class="saved-accounts__label">Contas salvas</span>
        <div class="saved-accounts__list">
          ${inactiveAccounts.map((account) => `
            <div class="saved-account" data-saved-account data-account-id="${escapeHtml(account.id)}">
              <span class="saved-account__name" title="${escapeHtml(account.displayName)} · ${escapeHtml(this.gameNameFor(account))}">
                ${escapeHtml(account.displayName)}
                <small>${escapeHtml(this.gameNameFor(account))}</small>
              </span>
              <button class="saved-account__open" data-open-account data-account-id="${escapeHtml(account.id)}" type="button">Abrir</button>
              <details class="saved-account__menu" data-session-menu>
                <summary aria-label="Opções de ${escapeHtml(account.displayName)}">⋯</summary>
                <div class="menu-popover menu-popover--up" role="menu">
                  <button class="menu-item" data-rename-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Renomear</button>
                  ${this.proxyControlAvailable() ? `<button class="menu-item" data-copy-proxy-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Copiar proxy para outra conta</button>` : ''}
                  ${this.extensionControlAvailable() ? `<button class="menu-item" data-extension-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Extensão desta conta</button>` : ''}
                  ${this.proxyControlAvailable() ? `<button class="menu-item" data-proxy-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Proxy exclusivo</button>` : ''}
                  <button class="menu-item menu-item--danger" data-clear-session-data data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Limpar dados</button>
                  <button class="menu-item menu-item--danger" data-delete-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Excluir configuração</button>
                </div>
              </details>
            </div>
          `).join('')}
        </div>
      </div>
    `
  }

  private renderSessionSurfaceContent(account: ConfiguredAccount): string {
    const issue = this.sessionIssues.get(account.id)

    if (issue) {
      return `
        <div class="session-surface__issue" role="status">
          <span aria-hidden="true">!</span>
          <strong>${escapeHtml(issue)}</strong>
          <button class="button button--secondary" data-reload-account data-account-id="${escapeHtml(account.id)}" type="button">Recarregar</button>
        </div>
      `
    }

    if (this.mobileSessionMode) {
      return ''
    }

    if (this.backgroundAccountIds.has(account.id)) {
      return `
        <button class="session-rest-screen" data-restore-account data-account-id="${escapeHtml(account.id)}" type="button" aria-label="Despertar ${escapeHtml(account.displayName)}">
          <span class="session-rest-screen__moon">${uiIcon('moon')}</span>
          <span class="session-rest-screen__zzz" aria-hidden="true"><i>Z</i><i>Z</i><i>Z</i></span>
          <strong>${escapeHtml(account.displayName)}</strong>
          <small>Continua conectada em segundo plano</small>
          <b>Despertar tela</b>
        </button>
      `
    }

    return `
      <div class="session-surface__placeholder" aria-hidden="true">
        <span>▦</span>
        <small>Tela ativa</small>
      </div>
    `
  }

  private ensureSessionSurfaceManager(): void {
    if (this.sessionSurfaceManager) {
      return
    }

    const grid = this.root.querySelector<HTMLElement>('[data-session-grid]')

    if (!grid) {
      return
    }

    const manager = new SessionSurfaceManager(grid)
    grid.querySelectorAll<HTMLElement>('[data-session-card]').forEach((card) => {
      const accountId = card.dataset.accountId
      const surface = card.querySelector<HTMLElement>('[data-session-surface-id]')

      if (accountId && surface) {
        manager.adopt(accountId, { card, surface })
      }
    })
    this.sessionSurfaceManager = manager
  }

  private reconcileSessionCards(shell: HTMLElement): void {
    const grid = shell.querySelector<HTMLElement>('[data-session-grid]')

    if (!grid) {
      return
    }

    const activeAccounts = this.getActiveAccounts()
    const activeIds = new Set(activeAccounts.map((account) => account.id))

    this.sessionSurfaceManager?.list().forEach((record) => {
      if (!activeIds.has(record.accountId)) {
        this.sessionSurfaceManager?.remove(record.accountId)
      }
    })

    activeAccounts.forEach((account) => {
      let card = this.sessionSurfaceManager?.get(account.id)?.card
        ?? [...grid.querySelectorAll<HTMLElement>('[data-session-card]')]
          .find((candidate) => candidate.dataset.accountId === account.id)

      if (!card) {
        const template = document.createElement('template')
        template.innerHTML = this.renderSessionCard(account).trim()
        card = template.content.firstElementChild as HTMLElement | null ?? undefined

        if (card) {
          const surface = card.querySelector<HTMLElement>('[data-session-surface-id]')

          if (surface) {
            this.sessionSurfaceManager?.adopt(account.id, { card, surface })
          } else {
            grid.append(card)
          }
        }
      }

      if (card) {
        const resting = this.backgroundAccountIds.has(account.id)
        card.classList.toggle('is-resting', resting)
        const name = card.querySelector<HTMLElement>('[data-session-name]')
        const game = card.querySelector<HTMLElement>('[data-session-game]')
        const surface = card.querySelector<HTMLElement>('[data-session-surface-id]')
        const muteButton = card.querySelector<HTMLButtonElement>('[data-toggle-session-mute]')
        const frameRateInput = card.querySelector<HTMLInputElement>('[data-session-frame-rate]')
        const interfaceScaleSelect = card.querySelector<HTMLSelectElement>('[data-session-interface-scale]')

        if (name) {
          name.textContent = account.displayName
        }
        if (game) {
          game.textContent = this.gameNameFor(account)
        }
        if (surface) {
          const issue = this.sessionIssues.get(account.id)
          const contentSignature = issue ? `issue:${issue}` : resting ? 'resting' : 'ready'

          if (surface.dataset.contentSignature !== contentSignature) {
            surface.innerHTML = this.renderSessionSurfaceContent(account)
            surface.dataset.contentSignature = contentSignature
          }
          surface.classList.toggle('has-session-issue', Boolean(issue))
        }
        if (muteButton) {
          muteButton.textContent = this.mutedAccountIds.has(account.id)
            ? 'Ativar som'
            : 'Silenciar'
        }
        if (frameRateInput && document.activeElement !== frameRateInput) {
          const frameRate = this.sessionFrameRateFor(account.id)
          frameRateInput.value = frameRate === 0 ? '' : String(frameRate)
        }
        if (interfaceScaleSelect && document.activeElement !== interfaceScaleSelect) {
          const interfaceScale = this.sessionInterfaceScaleFor(account.id)
          interfaceScaleSelect.value = interfaceScale === null
            ? ''
            : String(Math.round(interfaceScale * 100))
        }
        const menuTrigger = card.querySelector<HTMLElement>('.session-menu__trigger')
        menuTrigger?.setAttribute('aria-label', `Opções de ${account.displayName}`)
      }
    })

    const empty = shell.querySelector<HTMLElement>('[data-session-empty]')
    empty?.toggleAttribute('hidden', activeAccounts.length > 0)

    if (
      this.maximizedAccountId
      && !activeIds.has(this.maximizedAccountId)
    ) {
      this.maximizedAccountId = null
    }
  }

  private ensureWorkspaceObserver(): void {
    if (this.workspaceResizeObserver || typeof ResizeObserver === 'undefined') {
      return
    }

    const workspace = this.root.querySelector<HTMLElement>('[data-session-workspace]')

    if (!workspace) {
      return
    }

    this.workspaceResizeObserver = new ResizeObserver(() => {
      this.scheduleWorkspaceLayout()
    })
    this.workspaceResizeObserver.observe(workspace)

    // The workspace container itself keeps a fixed size, so adding/removing
    // session cards only changes the grid's own content box. Observing it too
    // guarantees native views are repositioned once the new grid settles,
    // instead of only reacting to a subsequent manual scroll.
    const grid = workspace.querySelector<HTMLElement>('[data-session-grid]')

    if (grid) {
      this.workspaceResizeObserver.observe(grid)
    }
  }

  private disconnectWorkspaceObserver(): void {
    this.workspaceResizeObserver?.disconnect()
    this.workspaceResizeObserver = null

    if (this.workspaceResizeFrame !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.workspaceResizeFrame)
      }
      this.workspaceResizeFrame = null
    }

    this.lastLayoutSignature = ''
  }

  private scheduleWorkspaceLayout(): void {
    if (this.workspaceResizeFrame !== null || this.currentView !== 'authenticated') {
      return
    }

    if (typeof requestAnimationFrame === 'function') {
      this.workspaceResizeFrame = requestAnimationFrame(() => {
        this.workspaceResizeFrame = null
        this.applyWorkspacePresentation()
      })
      return
    }

    queueMicrotask(() => this.applyWorkspacePresentation())
  }

  private enqueueSessionLayout(layout: GridLayout): Promise<void> {
    // Native layout calls may be asynchronous. Serializing them prevents an
    // older resize from completing after a newer one and restoring stale bounds.
    const operation = this.sessionLayoutQueue
      .catch(() => undefined)
      .then(() => Promise.resolve().then(() => this.sessionLauncher.applyLayout(layout)))

    this.sessionLayoutQueue = operation.catch(() => undefined)
    return operation
  }

  private async openGridManagerDialog(gridId: string | null): Promise<void> {
    const activeIds = this.getActiveAccounts().map((account) => account.id)

    // Electron native views always sit above the renderer, including <dialog>.
    // Hide them before showing the grid editor so the game cannot cover the
    // modal while only its backdrop remains visible.
    if (activeIds.length > 0) {
      const hiddenLayout: GridLayout = {
        capacity: 1,
        columns: 1,
        overflowSessionIds: activeIds,
        pageCount: 1,
        pageIndex: 0,
        requestedMode: '1x1',
        resolvedMode: '1x1',
        rows: 1,
        slots: [],
      }

      await this.enqueueSessionLayout(hiddenLayout).catch(() => undefined)
    }

    this.dialogGridWorkspaceId = gridId
    this.dialogError = null
    this.activeDialog = 'grid-manager'
    this.lastLayoutSignature = ''
    this.render()
  }

  private applyWorkspacePresentation(): void {
    if (this.sessionLayoutSuspended) {
      return
    }

    const frame = this.root.querySelector<HTMLElement>('.app-frame')
    const shell = this.root.querySelector<HTMLElement>('[data-authenticated-shell]')
    const workspace = shell?.querySelector<HTMLElement>('[data-session-workspace]')
    const grid = shell?.querySelector<HTMLElement>('[data-session-grid]')

    if (!frame || !shell || !workspace || !grid) {
      return
    }

    frame.classList.toggle('is-screens-only', this.screensOnly)
    frame.classList.toggle('is-eco-mode', this.ecoModeEffective)
    shell.classList.toggle('is-screens-only', this.screensOnly)
    shell.classList.toggle('is-sidebar-collapsed', this.sidebarCollapsed)
    shell.classList.toggle('is-utility-collapsed', this.utilityBarCollapsed)
    shell.classList.toggle('has-maximized-session', Boolean(this.maximizedAccountId))
    shell.classList.toggle(
      'is-grid-mode',
      this.workspaceMode === 'grid' && !this.maximizedAccountId,
    )
    shell.dataset.requestedGrid = this.gridMode

    if (this.mobileSessionMode) {
      this.root
        .querySelectorAll<HTMLButtonElement>('[data-maximize-account]')
        .forEach((button) => {
          button.textContent = this.screensOnly
            && button.dataset.accountId === this.maximizedAccountId
              ? 'Sair da tela cheia'
              : 'Tela cheia · zoom automático'
        })
    }

    const activeIds = this.getGridVisibleAccounts().map((account) => account.id)
    const overlayMenuOpen = Boolean(this.root.querySelector(
      'details[data-session-menu][open], details[data-toolbar-menu][open]',
    ))
    const suppressNativeSessions = this.activeDialog !== null
      || overlayMenuOpen
      || (this.mobileSessionMode && Boolean(this.chatService?.getState().open))
    const focusedActiveId = this.focusedAccountId
      && activeIds.includes(this.focusedAccountId)
        ? this.focusedAccountId
        : activeIds[0] ?? null
    const layoutIds = this.maximizedAccountId
      ? [this.maximizedAccountId]
      : this.workspaceMode === 'account'
        ? focusedActiveId ? [focusedActiveId] : []
        : activeIds
    const rectangle = workspace.getBoundingClientRect()
    const width = rectangle.width > 0 ? rectangle.width : 1280
    const height = rectangle.height > 0 ? rectangle.height : 720
    let resolution = this.gridLayoutService.resolve({
      area: { height, width, x: rectangle.x, y: rectangle.y },
      gap: this.screensOnly ? 4 : 10,
      mode: this.maximizedAccountId || this.workspaceMode === 'account'
        ? '1x1'
        : this.gridMode,
      pageIndex: this.maximizedAccountId ? 0 : this.gridPageIndex,
      previousAutoMode: this.previousAutoMode,
      sessionIds: layoutIds,
    })

    if (!resolution.ok) {
      this.gridMode = 'auto'
      this.storeGridModePreference('auto')
      resolution = this.gridLayoutService.resolve({
        area: { height, width, x: rectangle.x, y: rectangle.y },
        gap: this.screensOnly ? 4 : 10,
        mode: this.maximizedAccountId || this.workspaceMode === 'account'
          ? '1x1'
          : 'auto',
        pageIndex: this.maximizedAccountId ? 0 : this.gridPageIndex,
        previousAutoMode: this.previousAutoMode,
        sessionIds: layoutIds,
      })
    }

    if (!resolution.ok) {
      return
    }

    const layout = resolution.layout

    this.gridPageIndex = layout.pageIndex
    this.resolvedGridMode = layout.resolvedMode
    if (this.gridMode === 'auto' && !this.maximizedAccountId) {
      this.previousAutoMode = layout.resolvedMode
    }

    const rows = layout.rows
    const visibleIds = layout.slots.map((slot) => slot.sessionId)
    this.syncAccountTabsForGridPage(visibleIds)
    grid.style.setProperty('--grid-columns', String(layout.columns))
    grid.style.setProperty('--grid-rows', String(rows))
    grid.style.setProperty('--grid-row-height', '')
    grid.dataset.resolvedGrid = layout.resolvedMode
    // Opening/closing a native session and reconciling its DOM card happen on
    // separate async turns. During that short gap, present only surfaces that
    // are already adopted; the next scheduled layout includes the new card.
    // This prevents a transient layout race from aborting the whole shell.
    const adoptedVisibleIds = this.sessionSurfaceManager
      ? visibleIds.filter((accountId) => this.sessionSurfaceManager!.has(accountId))
      : []
    const adoptedMaximizedId = this.maximizedAccountId
      && this.sessionSurfaceManager?.has(this.maximizedAccountId)
        ? this.maximizedAccountId
        : null
    this.sessionSurfaceManager?.applyPresentation({
      layout: `grid-${layout.resolvedMode}`,
      maximizedAccountId: adoptedMaximizedId,
      screensOnly: this.screensOnly,
      visibleAccountIds: adoptedVisibleIds,
    })

    const pagination = shell.querySelector<HTMLElement>('[data-session-pagination]')
    const pageStatus = pagination?.querySelector<HTMLElement>('[data-grid-page-status]')
    const pageSummary = this.root.querySelector<HTMLElement>('[data-grid-page-summary]')
    const previousPage = pagination?.querySelector<HTMLButtonElement>('[data-grid-page="previous"]')
    const nextPage = pagination?.querySelector<HTMLButtonElement>('[data-grid-page="next"]')
    const paginationVisible = !this.maximizedAccountId
      && !this.screensOnly
      && layout.pageCount > 1

    pagination?.toggleAttribute('hidden', !paginationVisible)
    if (pageStatus) {
      pageStatus.textContent = `${layout.pageIndex + 1}/${layout.pageCount}`
    }
    if (pageSummary) {
      const accountCount = visibleIds.length
      const gridName = this.selectedGridWorkspace()?.name ?? 'Todas'
      pageSummary.textContent = `${gridName} · Página ${layout.pageIndex + 1} de ${layout.pageCount} · ${accountCount} ${accountCount === 1 ? 'conta' : 'contas'}`
    }
    if (previousPage) {
      previousPage.disabled = layout.pageIndex === 0
    }
    if (nextPage) {
      nextPage.disabled = layout.pageIndex >= layout.pageCount - 1
    }

    this.root.querySelectorAll<HTMLButtonElement>('button[data-grid-mode]').forEach((button) => {
      const selected = button.dataset.gridMode === this.gridMode
      button.classList.toggle('is-selected', selected)
      button.setAttribute('aria-checked', String(selected))
    })
    const layoutLabel = this.root.querySelector<HTMLElement>('[data-grid-mode-label]')
    if (layoutLabel) {
      layoutLabel.textContent = this.gridMode === 'auto' ? 'Auto' : this.gridMode
    }

    const screensOnlyButton = this.root.querySelector<HTMLButtonElement>(
      '[data-toggle-screens-only]',
    )
    screensOnlyButton?.classList.toggle('is-active', this.screensOnly)
    screensOnlyButton?.setAttribute('aria-pressed', String(this.screensOnly))

    // Measure the actual surface rectangles after CSS layout. Native WebViews
    // receive content bounds—not the card bounds—so headers and gaps stay clear.
    const slots = (suppressNativeSessions ? [] : layout.slots).flatMap((slot) => {
      if (this.backgroundAccountIds.has(slot.sessionId)) {
        return []
      }
      const surface = this.sessionSurfaceManager?.get(slot.sessionId)?.surface

      if (!surface) {
        return []
      }

      const bounds = surface.getBoundingClientRect()
      return [{
        bounds: {
          height: bounds.height,
          width: bounds.width,
          x: bounds.x,
          y: bounds.y,
        },
        column: slot.column,
        index: slot.index,
        row: slot.row,
        sessionId: slot.sessionId,
      }]
    })
    const nativeVisibleIds = slots.map((slot) => slot.sessionId)
    const surfaceLayout: GridLayout = {
      ...layout,
      overflowSessionIds: suppressNativeSessions
        ? activeIds
        : activeIds.filter((accountId) => !nativeVisibleIds.includes(accountId)),
      rows,
      slots,
    }

    const signature = JSON.stringify({
      bounds: surfaceLayout.slots.map((slot) => slot.bounds),
      ids: suppressNativeSessions ? [] : nativeVisibleIds,
      page: layout.pageIndex,
      overflow: surfaceLayout.overflowSessionIds,
      maximized: this.maximizedAccountId,
      resolved: layout.resolvedMode,
      screensOnly: this.screensOnly,
      suppressedByOverlay: suppressNativeSessions,
    })

    if (activeIds.length === 0) {
      // There are no native views to position. Session close/cleanup owns its
      // explicit hide operation, so an empty workspace must not issue IPC.
      this.lastLayoutSignature = signature
      return
    }

    if (signature !== this.lastLayoutSignature && rectangle.width > 0 && rectangle.height > 0) {
      this.lastLayoutSignature = signature
      void this.enqueueSessionLayout(surfaceLayout)
        .catch(() => {
          if (this.lastLayoutSignature === signature) {
            this.lastLayoutSignature = ''
          }
          this.showSessionAlert('Não foi possível reorganizar as telas.')
        })
    }
  }

  private renderDialog(): string {
    if (!this.activeDialog) {
      return ''
    }

    if (this.activeDialog === 'chat-nickname') {
      return `
        <dialog class="modal modal--chat-nickname" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header">
            <p class="eyebrow">${this.nicknameOnboarding ? 'CONFIGURE SEU PERFIL' : 'PRIMEIRO ACESSO AO CHAT'}</p>
            <h2 id="dialog-title">Como quer ser chamado?</h2>
            <p>Este será seu nick no chat e também identificará sua conta no suporte e nas compras.</p>
          </div>
          ${this.renderDialogError()}
          <form class="chat-nickname-form" data-chat-nickname-form>
            <label for="chat-nickname">Nick</label>
            <input id="chat-nickname" name="display_name" minlength="2" maxlength="24" autocomplete="nickname" placeholder="Seu nick" required />
            <small>Use de 2 a 24 caracteres.</small>
            <div class="modal__actions">
              <button class="button button--primary" type="submit" ${this.chatNicknameSaving ? 'disabled' : ''}>${this.chatNicknameSaving ? 'Salvando…' : this.nicknameOnboarding ? 'Continuar' : 'Entrar no chat'}</button>
            </div>
          </form>
        </dialog>
      `
    }

    if (this.activeDialog === 'sponsored') {
      const ad = this.appAds.find((entry) => entry.id === this.selectedSponsoredAdId)
        ?? (this.selectedSponsoredAdId === HOUSE_APP_AD_ID ? HOUSE_APP_AD : null)
      if (!ad) return ''
      return `
        <dialog class="modal modal--sponsored" id="app-dialog" aria-labelledby="dialog-title">
          <button class="modal__close sponsored-modal__close" data-close-dialog type="button" aria-label="Fechar anúncio">×</button>
          ${ad.image_url ? `<img class="sponsored-modal__image" src="${escapeHtml(ad.image_url)}" alt="" referrerpolicy="no-referrer" />` : '<div class="sponsored-modal__image sponsored-modal__image--empty" aria-hidden="true">AD</div>'}
          <div class="sponsored-modal__body">
            <p class="eyebrow">CONTEÚDO PATROCINADO · ${escapeHtml(ad.advertiser_name)}</p>
            <h2 id="dialog-title">${escapeHtml(ad.title)}</h2>
            <p>${escapeHtml(ad.description)}</p>
            <div class="modal__actions">
              ${ad.id === HOUSE_APP_AD_ID
                ? `<button class="button button--primary" data-open-dialog="advertise" type="button">${escapeHtml(ad.cta_label)} ↗</button>`
                : `<button class="button button--primary" data-sponsored-link="${escapeHtml(ad.id)}" data-sponsored-placement="popup" type="button">${escapeHtml(ad.cta_label)} ↗</button>`}
              <button class="button button--secondary" data-close-dialog type="button">Agora não</button>
            </div>
            <small class="sponsored-modal__notice">${ad.id === HOUSE_APP_AD_ID ? 'Este espaço fica disponível quando não há uma campanha ativa.' : 'Anúncios ajudam a manter o plano FREE disponível.'}</small>
          </div>
        </dialog>
      `
    }

    if (this.activeDialog === 'advertise') {
      const defaultPlan = this.appAdPlans[0]
      return `
        <dialog class="modal modal--advertise" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header advertise-dialog__header">
            <p class="eyebrow">ANUNCIE NO ALTGRID</p>
            <h2 id="dialog-title">Sua marca diante de jogadores idle</h2>
            <p>Monte sua campanha em poucos passos. Você envia, a equipe AltGrid confere o plano e o conteúdo, e o PIX só aparece depois da aprovação.</p>
          </div>
          ${this.renderAppAdFlow()}
          ${this.appAdTestStage === 1 ? this.renderDialogError() : ''}
          ${this.appAdSuccess ? `<div class="advertise-success" role="status"><span aria-hidden="true">✓</span><div><strong>Solicitação recebida</strong><p>${escapeHtml(this.appAdSuccess)}</p></div></div>` : ''}
          ${this.appAdTestStage === 1 ? `<form class="advertise-form" data-advertise-form>
              <section class="advertise-step"><header><span>01</span><div><h3>Escolha a exposição</h3><p>O valor será conferido por você e pelo administrador antes do PIX.</p></div></header><fieldset class="advertise-plans">
                <legend>1. Escolha onde aparecer</legend>
                ${this.appAdPlans.length > 0 ? this.appAdPlans.map((plan, index) => `
                  <label class="advertise-plan">
                    <input type="radio" name="plan_code" value="${escapeHtml(plan.code)}" data-ad-plan data-price-per-day="${plan.price_per_day}" data-min-days="${plan.min_days}" data-max-days="${plan.max_days}" ${index === 0 ? 'checked' : ''} required />
                    <span><small>${plan.popup_enabled ? 'LATERAL + POP-UP FREE' : 'LATERAL'}</small><strong>${escapeHtml(plan.name)}</strong><p>${escapeHtml(plan.description)}</p><b>${escapeHtml(formatCurrency(plan.price_per_day, plan.currency))}/dia</b></span>
                  </label>
                `).join('') : '<p class="advertise-unavailable">Os planos de anúncio estão sendo atualizados. Tente novamente em instantes.</p>'}
              </fieldset></section>
              <section class="advertise-step"><header><span>02</span><div><h3>Conte sobre a campanha</h3><p>Preencha os dados que serão revisados antes da cobrança.</p></div></header><div class="advertise-fields">
                <label>Tipo<select name="category" data-ad-category required><option value="game">Jogo idle</option><option value="product">Produto</option><option value="site">Site</option></select></label>
                <label>Anunciante<input name="advertiser_name" maxlength="80" placeholder="Nome da empresa ou projeto" required /></label>
                <label class="advertise-fields__wide" data-ad-game-field>Jogo que receberá destaque<select name="game_slug" required><option value="">Selecione um jogo suportado</option>${this.games.map((game) => `<option value="${escapeHtml(game.slug)}">${escapeHtml(game.name)}</option>`).join('')}<option value="__request__">Meu jogo ainda não está no catálogo</option></select><small>Após a aprovação, o jogo aparece no topo da lista com o selo Destaque.</small></label>
                <div class="advertise-fields advertise-fields__wide advertise-catalog-request" data-ad-new-game hidden>
                  <label>Nome do novo jogo<input name="catalog_game_name" maxlength="80" placeholder="Nome oficial do jogo" /></label>
                  <label>Link oficial para jogar<input name="catalog_launch_url" type="url" maxlength="500" placeholder="https://seujogo.com/jogar" /></label>
                  <label class="advertise-fields__wide">Logo do jogo em HTTPS<input name="catalog_icon_url" type="url" maxlength="500" placeholder="https://seujogo.com/logo.png" /></label>
                  <p class="advertise-catalog-request__notice">A equipe verificará o jogo, o link e a logo antes de adicioná-lo ao catálogo. A campanha só ganhará o selo Destaque depois dessa aprovação.</p>
                </div>
                <label class="advertise-fields__wide">Título<input name="title" minlength="3" maxlength="70" placeholder="Uma chamada curta e clara" required /></label>
                <label class="advertise-fields__wide">Descrição<textarea name="description" minlength="10" maxlength="180" rows="3" placeholder="Explique o que a pessoa encontrará ao clicar" required></textarea></label>
                <label>Link HTTPS<input name="destination_url" type="url" maxlength="500" placeholder="https://seusite.com" required /></label>
                <label>Imagem HTTPS <small>(opcional)</small><input name="image_url" type="url" maxlength="500" placeholder="https://seusite.com/banner.jpg" /></label>
                <label>Texto do botão<input name="cta_label" maxlength="24" value="Saiba mais" required /></label>
                <label>Dias<input name="requested_days" type="number" min="${defaultPlan?.min_days ?? 7}" max="${defaultPlan?.max_days ?? 90}" value="${defaultPlan?.min_days ?? 7}" required data-ad-days /></label>
              </div></section>
              <section class="advertise-step advertise-step--review"><header><span>03</span><div><h3>Revise e envie</h3><p>Nenhum pagamento é criado nesta etapa.</p></div></header>
              <div class="advertise-quote" aria-live="polite"><span>Estimativa</span><strong data-ad-quote>${defaultPlan ? escapeHtml(formatCurrency(defaultPlan.price_per_day * defaultPlan.min_days, defaultPlan.currency)) : '—'}</strong><small>Valor final calculado e confirmado pelo servidor.</small></div>
              <label class="advertise-consent"><input name="accept_review" type="checkbox" required /><span>Confirmo que tenho autorização para usar os textos, a marca e a imagem enviados.</span></label>
              <div class="modal__actions">
                <button class="button button--primary" type="submit" ${this.appAdSubmitting || this.appAdPlans.length === 0 ? 'disabled' : ''}>${this.appAdSubmitting ? 'Enviando…' : 'Enviar para análise'}</button>
                <button class="button button--secondary" data-close-dialog type="button">Fechar</button>
              </div>
              ${LOCAL_AD_TEST_MODE ? '<button class="advertise-test-button" data-test-ad-stage="2" type="button"><span>▶</span><strong>Testar todas as etapas</strong><small>Usa uma campanha fictícia e não gera cobrança</small></button>' : ''}
              </section>
            </form>
          ${this.renderMyAppAdRequests()}` : this.renderAppAdTestStage()}
        </dialog>
      `
    }

    const utilityDialog = this.renderUtilityDialog()

    if (utilityDialog !== null) {
      return utilityDialog
    }

    if (this.activeDialog === 'extension') {
      const account = this.configuredAccounts.find(
        (candidate) => candidate.id === this.dialogAccountId,
      )
      if (!account) return ''
      const config = this.extensionConfig
      const permissions = config?.permissions ?? []
      const extensionLimit = this.extensionAccountLimit()
      const configuredExtensionCount = this.configuredExtensionCount()
      const unlimitedExtensions = extensionLimit === UNLIMITED_ACCOUNT_LIMIT
      const extensionWithinLimit = config
        ? this.isAccountExtensionWithinLimit(account.id)
        : true
      const canChooseExtension = this.canAssignAccountExtension(account.id)
      const quotaIsFull = !unlimitedExtensions && configuredExtensionCount >= extensionLimit
      const quotaLabel = unlimitedExtensions
        ? `${configuredExtensionCount} ${configuredExtensionCount === 1 ? 'conta configurada' : 'contas configuradas'} · sem limite`
        : `${configuredExtensionCount} de ${extensionLimit} contas configuradas`
      return `
        <dialog class="modal modal--extension" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header">
            <p class="eyebrow">RECURSO DE PLANO PAGO · ISOLADO POR CONTA</p>
            <h2 id="dialog-title">Extensão de ${escapeHtml(account.displayName)}</h2>
            <p>Carregue uma extensão descompactada somente nesta conta. Outras contas não recebem seus scripts ou permissões.</p>
          </div>
          ${this.renderDialogError()}
          ${this.extensionLoading ? '<div class="proxy-loading"><i class="spinner spinner--green"></i> Verificando extensão local…</div>' : `
            <section class="extension-quota ${quotaIsFull ? 'is-full' : ''}">
              <span><strong>${escapeHtml(PLAN_PRESENTATION[this.permissionService.getCurrentPlan()].displayName)}</strong><small>Extensões isoladas por conta</small></span>
              <strong>${quotaLabel}</strong>
            </section>
            ${config && !extensionWithinLimit ? `
              <div class="extension-limit-alert" role="status">
                <strong>Configuração preservada, mas fora do limite atual</strong>
                <p>Esta extensão não será carregada até você liberar uma vaga ou mudar para um plano com mais contas.</p>
              </div>
            ` : ''}
            ${!config && !canChooseExtension ? `
              <div class="extension-limit-alert" role="status">
                <strong>Limite de extensões atingido</strong>
                <p>${escapeHtml(this.extensionLimitMessage())}</p>
              </div>
            ` : ''}
            ${config ? `
              <section class="extension-card ${config.enabled && extensionWithinLimit ? 'is-active' : ''}">
                <span class="extension-card__mark" aria-hidden="true">E</span>
                <div><strong>${escapeHtml(config.name)}</strong><small>Versão ${escapeHtml(config.version)} · Manifest V${config.manifestVersion} · ${escapeHtml(config.folderName)}</small></div>
                <span class="extension-card__status">${extensionWithinLimit ? (config.enabled ? 'Ativa' : 'Desativada') : 'Fora do limite'}</span>
              </section>
              <div class="extension-permissions">
                <strong>Permissões declaradas</strong>
                <div>${permissions.length > 0 ? permissions.map((permission) => `<span>${escapeHtml(permission)}</span>`).join('') : '<small>Nenhuma permissão adicional declarada.</small>'}</div>
              </div>
              <label class="setting-toggle"><span><strong>Ativar nesta conta</strong><small>${extensionWithinLimit ? 'A conta será recarregada ao alterar.' : 'Libere uma vaga para voltar a carregar esta extensão.'}</small></span><input data-extension-enabled type="checkbox" ${config.enabled ? 'checked' : ''} ${this.extensionSaving || !extensionWithinLimit ? 'disabled' : ''} /></label>
            ` : '<div class="extension-empty"><span aria-hidden="true">▧</span><strong>Nenhuma extensão configurada</strong><small>Selecione a pasta descompactada que contém o arquivo manifest.json.</small></div>'}
            <div class="extension-security"><strong>Importante</strong><p>Extensões podem ler e alterar páginas permitidas no próprio manifest. Adicione somente arquivos de uma fonte em que você confia.</p></div>
            <div class="modal__actions">
              <button class="button button--primary" data-choose-extension type="button" ${this.extensionSaving || !canChooseExtension ? 'disabled' : ''}>${config ? 'Trocar pasta' : 'Selecionar pasta'}</button>
              ${config ? '<button class="text-button text-button--danger" data-remove-extension type="button">Remover extensão</button>' : ''}
              ${!canChooseExtension && this.permissionService.getCurrentPlan() !== 'FOUNDER' ? '<button class="button button--secondary" data-show-plans type="button">Ver planos</button>' : ''}
              <button class="button button--secondary" data-close-dialog type="button">Fechar</button>
            </div>
          `}
        </dialog>
      `
    }

    if (this.activeDialog === 'proxy') {
      const account = this.configuredAccounts.find(
        (candidate) => candidate.id === this.dialogAccountId,
      )

      if (!account) {
        return ''
      }

      const config = this.proxyConfig
      const active = this.permissionService.isSessionActive(account.id)
      const resultClass = this.proxyTestResult?.ok ? 'proxy-result--success' : 'proxy-result--error'

      return `
        <dialog class="modal modal--proxy" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header">
            <p class="eyebrow">FOUNDER · ROTA POR CONTA</p>
            <h2 id="dialog-title">Proxy de ${escapeHtml(account.displayName)}</h2>
            <p>Esta conta usa uma rota própria. A senha fica protegida pelo sistema e nunca aparece na interface.</p>
          </div>
          ${this.renderDialogError()}
          ${this.proxyLoading ? '<div class="proxy-loading"><i class="spinner spinner--green"></i> Abrindo cofre seguro…</div>' : `
            <form id="proxy-form">
              <label class="setting-toggle proxy-enable"><span><strong>Usar proxy nesta conta</strong><small>Aplicado antes de abrir o jogo e isolado das outras contas.</small></span><input name="enabled" type="checkbox" ${config?.enabled ? 'checked' : ''} /></label>
              <label class="field proxy-compact"><span>Colar proxy em uma linha <small>(opcional)</small></span><input name="compact" placeholder="usuario:senha:host:porta" autocomplete="off" /><small>Ao preencher, esta linha substitui os quatro campos abaixo. Também aceita protocolo://usuario:senha@host:porta.</small></label>
              <div class="proxy-grid">
                <label class="field"><span>Protocolo</span><select name="protocol"><option value="http" ${config?.protocol === 'http' || !config ? 'selected' : ''}>HTTP</option><option value="https" ${config?.protocol === 'https' ? 'selected' : ''}>HTTPS</option><option value="socks5" ${config?.protocol === 'socks5' ? 'selected' : ''}>SOCKS5</option><option value="socks4" ${config?.protocol === 'socks4' ? 'selected' : ''}>SOCKS4</option></select></label>
                <label class="field proxy-host"><span>Servidor</span><input name="host" value="${escapeHtml(config?.host ?? '')}" placeholder="proxy.exemplo.com" autocomplete="off" required /></label>
                <label class="field"><span>Porta</span><input name="port" type="number" min="1" max="65535" value="${config?.port || 8080}" required /></label>
                <label class="field"><span>Usuário <small>(opcional)</small></span><input name="username" value="${escapeHtml(config?.username ?? '')}" autocomplete="off" /></label>
                <label class="field"><span>Senha <small>(opcional)</small></span><input name="password" type="password" placeholder="${config?.hasPassword ? 'Senha protegida — deixe vazio para manter' : 'Senha do proxy'}" autocomplete="new-password" /></label>
              </div>
              <div class="proxy-security"><span aria-hidden="true">◆</span><p><strong>Credencial local protegida</strong><small>O AltGrid usa a proteção de dados do sistema. O servidor AltGrid não recebe esta senha.</small></p></div>
              ${this.proxyTestResult ? `<div class="proxy-result ${resultClass}" role="status"><strong>${escapeHtml(this.proxyTestResult.message)}</strong><span>${escapeHtml(this.proxyTestResult.route)} · ${this.proxyTestResult.latencyMs} ms</span></div>` : ''}
              <div class="modal__actions">
                <button class="button button--primary" type="submit" ${this.proxySaving ? 'disabled' : ''}>${this.proxySaving ? 'Salvando…' : 'Salvar e aplicar'}</button>
                <button class="button button--secondary" data-test-proxy type="button" ${!active || this.proxySaving ? 'disabled' : ''}>Salvar e validar rota</button>
                ${config ? '<button class="text-button text-button--danger" data-remove-proxy type="button">Remover proxy</button>' : ''}
                <button class="button button--secondary" data-close-dialog type="button">Fechar</button>
              </div>
              <p class="modal__note">${active ? 'Ao salvar, somente esta conta será recarregada.' : 'Abra a conta após salvar para usar a nova rota.'}</p>
            </form>
          `}
        </dialog>
      `
    }

    if (this.activeDialog === 'copy-proxy') {
      const source = this.configuredAccounts.find(
        (candidate) => candidate.id === this.dialogAccountId,
      )
      if (!source) return ''

      const destinations = this.configuredAccounts.filter(
        (candidate) => candidate.id !== source.id,
      )
      const sourceRoute = this.proxyConfig
        ? `${this.proxyConfig.protocol.toUpperCase()} · ${this.proxyConfig.host}:${this.proxyConfig.port}`
        : 'Nenhum proxy configurado'

      return `
        <dialog class="modal modal--copy-proxy" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header">
            <p class="eyebrow">ROTA ISOLADA POR CONTA</p>
            <h2 id="dialog-title">Copiar proxy</h2>
            <p>Use a rota de <strong>${escapeHtml(source.displayName)}</strong> em outra conta, sem copiar login, sessão, dados ou extensões.</p>
          </div>
          ${this.renderDialogError()}
          ${this.proxyLoading ? '<div class="proxy-loading"><i class="spinner spinner--green"></i> Verificando a rota de origem…</div>' : `
            <form id="copy-proxy-form">
              <section class="proxy-copy-route ${this.proxyConfig ? 'is-ready' : 'is-empty'}">
                <i>${uiIcon('route')}</i>
                <span><small>Proxy de origem</small><strong>${escapeHtml(sourceRoute)}</strong><em>${this.proxyConfig?.hasPassword ? 'Credencial protegida incluída' : 'Sem senha salva'}</em></span>
              </section>
              <label class="field">
                <span>Copiar para</span>
                <select name="targetAccountId" ${!this.proxyConfig || destinations.length === 0 ? 'disabled' : ''} required>
                  <option value="">Escolha a conta de destino</option>
                  ${destinations.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.displayName)} · ${escapeHtml(this.gameNameFor(account))}</option>`).join('')}
                </select>
                <small>Se a conta já tiver um proxy, ele será substituído. Se estiver aberta, a nova rota será aplicada imediatamente.</small>
              </label>
              <div class="proxy-security"><span aria-hidden="true">◆</span><p><strong>Somente o proxy será copiado</strong><small>A senha continua protegida localmente pelo sistema e não será exibida.</small></p></div>
              <div class="modal__actions">
                <button class="button button--secondary" data-close-dialog type="button">Cancelar</button>
                <button class="button button--primary" type="submit" ${!this.proxyConfig || destinations.length === 0 || this.proxySaving ? 'disabled' : ''}>${this.proxySaving ? 'Copiando…' : 'Copiar e aplicar'}</button>
              </div>
            </form>
          `}
        </dialog>
      `
    }

    if (this.activeDialog === 'grid-manager') {
      const editing = this.savedGridWorkspaces.find(
        (grid) => grid.id === this.dialogGridWorkspaceId,
      ) ?? null
      const activeIds = new Set(this.getActiveAccounts().map((account) => account.id))
      const initiallySelected = new Set(editing?.accountIds
        ?? (activeIds.size > 0
          ? [...activeIds]
          : this.configuredAccounts.map((account) => account.id)))
      const gameGroups = [...new Map(this.configuredAccounts.map((account) => [
        account.gameSlug,
        this.gameNameFor(account),
      ])).entries()]
      const accountChoices = this.configuredAccounts.map((account) => {
        const active = activeIds.has(account.id)
        return `
          <label class="grid-manager__account">
            <input name="accountIds" type="checkbox" value="${escapeHtml(account.id)}" ${initiallySelected.has(account.id) ? 'checked' : ''} />
            <span class="grid-manager__account-state ${active ? 'is-active' : ''}" aria-hidden="true"></span>
            <span><strong>${escapeHtml(account.displayName)}</strong><small>${escapeHtml(this.gameNameFor(account))} · ${active ? 'aberta' : 'fechada'}</small></span>
          </label>
        `
      }).join('')

      return `
        <dialog class="modal modal--grid-manager" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header">
            <p class="eyebrow">ORGANIZAÇÃO DE MUITAS CONTAS</p>
            <h2 id="dialog-title">${editing ? `Editar ${escapeHtml(editing.name)}` : 'Criar uma grade'}</h2>
            <p>Cada grade mostra somente as contas escolhidas. As outras continuam abertas e rodando normalmente.</p>
          </div>
          ${this.renderDialogError()}
          <form id="grid-workspace-form">
            <label class="field"><span>Nome da grade</span><input name="name" maxlength="40" value="${escapeHtml(editing?.name ?? `Grade ${this.savedGridWorkspaces.length + 1}`)}" placeholder="Ex.: Grade 1 ou Huntera" required /></label>
            <div class="grid-manager__tools" aria-label="Seleção rápida">
              <button class="text-button" data-grid-select="open" type="button">Contas abertas</button>
              <button class="text-button" data-grid-select="all" type="button">Todas</button>
              <button class="text-button" data-grid-select="none" type="button">Limpar</button>
              ${gameGroups.map(([slug, name]) => `<button class="text-button" data-grid-select-game="${escapeHtml(slug)}" type="button">${escapeHtml(name)}</button>`).join('')}
            </div>
            <div class="grid-account-picker" data-grid-account-picker>
              ${accountChoices || '<p class="empty-copy">Adicione configurações de conta antes de criar uma grade.</p>'}
            </div>
            <div class="modal__actions modal__actions--grid-manager">
              <button class="button button--primary" type="submit" ${this.configuredAccounts.length === 0 ? 'disabled' : ''}>${editing ? 'Salvar alterações' : 'Criar grade'}</button>
              ${editing
                ? '<button class="text-button text-button--danger" data-delete-grid-workspace type="button">Excluir grade</button>'
                : '<button class="button button--secondary" data-create-game-grids type="button">Criar grades por jogo</button>'}
              <button class="button button--secondary" data-close-dialog type="button">Cancelar</button>
            </div>
          </form>
        </dialog>
      `
    }

    if (this.activeDialog === 'add-account') {
      const availableGames = this.games.filter(
        (game) => game.slug !== CUSTOM_GAME_SLUG,
      )
      const gameChoices = availableGames.map((game, index) => {
        const iconUrl = getBundledGameIconUrl(game.slug)
          ?? normalizeSafeGameUrl(game.icon_url)

        return `
          <label class="game-choice">
            <input
              name="gameSlug"
              type="radio"
              value="${escapeHtml(game.slug)}"
              ${index === 0 ? 'checked' : ''}
            />
            <span class="game-choice__icon" aria-hidden="true">
              ${iconUrl
                ? `<img src="${escapeHtml(iconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
                : escapeHtml(game.name.slice(0, 1).toLocaleUpperCase())}
            </span>
            <span>${escapeHtml(game.name)}</span>
          </label>
        `
      }).join('')
      return `
        <dialog class="modal modal--game-picker" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header">
            <p class="eyebrow">Adicionar conta</p>
            <h2 id="dialog-title">Escolha um jogo</h2>
          </div>
          ${this.renderDialogError()}
          <form id="add-account-form" method="dialog">
            <div class="field">
              <label for="account-name">Nome da conta</label>
              <input id="account-name" name="displayName" maxlength="80" required />
            </div>
            <fieldset class="game-picker">
              <legend>Jogo</legend>
              <div class="game-choice-list">
                ${gameChoices}
                <label class="game-choice game-choice--custom">
                  <input
                    name="gameSlug"
                    type="radio"
                    value="${CUSTOM_GAME_SLUG}"
                    ${availableGames.length === 0 ? 'checked' : ''}
                  />
                  <span class="game-choice__icon" aria-hidden="true">↗</span>
                  <span>URL personalizada</span>
                </label>
              </div>
            </fieldset>
            ${availableGames.length === 0
              ? `<p class="modal__note">${escapeHtml(
                  this.gameCatalogError
                    ? 'Os jogos remotos estão indisponíveis. A URL personalizada continua disponível.'
                    : 'Nenhum jogo remoto está disponível. Você ainda pode usar uma URL personalizada.',
                )}</p>`
              : ''}
            <div
              class="field custom-game-url"
              data-custom-game-url
              ${availableGames.length > 0 ? 'hidden' : ''}
            >
              <label for="custom-launch-url">URL do jogo</label>
              <input
                id="custom-launch-url"
                name="customLaunchUrl"
                type="url"
                inputmode="url"
                autocomplete="url"
                maxlength="2048"
                placeholder="https://jogo.exemplo.com"
                ${availableGames.length === 0 ? 'required' : ''}
              />
              <small>Use HTTPS. HTTP é aceito somente em localhost.</small>
            </div>
            <div class="modal__actions">
              <button class="button button--secondary" data-close-dialog type="button">Cancelar</button>
              <button class="button button--primary" type="submit">
                Salvar conta
              </button>
            </div>
          </form>
        </dialog>
      `
    }

    if (this.activeDialog === 'rename-account') {
      const account = this.configuredAccounts.find(
        (candidate) => candidate.id === this.dialogAccountId,
      )

      if (!account) {
        return ''
      }

      return `
        <dialog class="modal" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header">
            <p class="eyebrow">Conta salva</p>
            <h2 id="dialog-title">Renomear conta</h2>
          </div>
          ${this.renderDialogError()}
          <form id="rename-account-form" method="dialog">
            <div class="field">
              <label for="rename-account-name">Nome da conta</label>
              <input id="rename-account-name" name="displayName" maxlength="80" value="${escapeHtml(account.displayName)}" required />
            </div>
            <div class="modal__actions">
              <button class="button button--secondary" data-close-dialog type="button">Cancelar</button>
              <button class="button button--primary" type="submit">Salvar</button>
            </div>
          </form>
        </dialog>
      `
    }

    if (this.activeDialog === 'delete-account') {
      const account = this.configuredAccounts.find(
        (candidate) => candidate.id === this.dialogAccountId,
      )

      if (!account) {
        return ''
      }

      return `
        <dialog class="modal" id="app-dialog" aria-labelledby="dialog-title" aria-describedby="dialog-description">
          <div class="modal__icon modal__icon--danger" aria-hidden="true">!</div>
          <div class="modal__header">
            <h2 id="dialog-title">Excluir configuração?</h2>
            <p id="dialog-description">A configuração “${escapeHtml(account.displayName)}” será removida deste dispositivo.</p>
            <p>O plano nunca exclui contas automaticamente.</p>
          </div>
          ${this.renderDialogError()}
          <div class="modal__actions">
            <button class="button button--secondary" data-close-dialog type="button">Cancelar</button>
            <button class="button button--danger" data-confirm-delete-account type="button">Excluir</button>
          </div>
        </dialog>
      `
    }

    if (this.activeDialog === 'free-limit') {
      const plan = this.permissionService.getCurrentPlan()
      const account = this.configuredAccounts.find(
        (candidate) => candidate.id === this.dialogAccountId,
      )
      const limit = this.permissionService.getAccountLimit(account?.gameSlug)
      const free = plan === 'FREE'
      const huntera = free && account?.gameSlug.toLocaleLowerCase() === 'huntera'

      return `
        <dialog class="modal" id="app-dialog" aria-labelledby="dialog-title" aria-describedby="dialog-description">
          <div class="modal__icon" aria-hidden="true">!</div>
          <div class="modal__header">
            <h2 id="dialog-title">${free ? 'Limite da versão gratuita' : 'Limite de sessões simultâneas'}</h2>
            <p id="dialog-description">
              ${free
                ? huntera
                  ? `O plano FREE permite até ${limit} contas simultâneas ao abrir Huntera.`
                  : `O plano FREE permite até ${limit} contas simultâneas nos demais jogos.`
                : `O plano ${plan} permite ${this.renderAccountLimit(limit)} contas simultâneas.`}
            </p>
            <p>Suas contas e configurações continuam salvas.</p>
          </div>
          <div class="modal__actions">
            ${
              free
                ? '<button class="button button--primary" data-show-plans type="button">Conhecer PRO</button>'
                : ''
            }
            <button class="button button--secondary" data-close-dialog type="button">Agora não</button>
          </div>
        </dialog>
      `
    }

    const currentPlan = this.permissionService.getCurrentPlan()
    const founderUpgradeEligible = currentPlan === 'PRO'
      && this.me?.founder_upgrade_eligible === true
    const productByCode = (code: string): PublicProduct | null =>
      this.products.find((product) => product.code === code) ?? null
    const productFor = (plan: 'FOUNDER' | 'PRO' | 'PRO_PLUS'): PublicProduct | null => {
      if (plan === 'PRO') {
        return productByCode('PRO_LIFETIME')
      }
      if (plan === 'PRO_PLUS') {
        return currentPlan === 'PRO'
          ? productByCode('PRO_PLUS_UPGRADE') ?? productByCode('PRO_PLUS_LIFETIME')
          : productByCode('PRO_PLUS_LIFETIME')
      }
      return (currentPlan === 'PRO_PLUS'
        ? productByCode('PLUS_FOUNDER_UPGRADE')
        : founderUpgradeEligible ? productByCode('FOUNDER_UPGRADE') : null)
        ?? productByCode('FOUNDER_LIFETIME')
    }

    return `
      <dialog class="modal modal--plans" id="app-dialog" aria-labelledby="dialog-title">
        <div class="modal__header">
          <p class="eyebrow">Escolha uma vez. Use sem mensalidade.</p>
          <h2 id="dialog-title">Planos AltGrid</h2>
          <p>Compare limites e recursos para encontrar o plano certo para a quantidade de contas que você gerencia.</p>
        </div>
        <div class="plan-lifetime-banner">
          <span aria-hidden="true">✓</span>
          <div><strong>Todos os planos pagos são vitalícios</strong><small>Você paga uma única vez, sem mensalidade. A licença fica vinculada à sua conta AltGrid.</small></div>
        </div>
        <div class="plan-list">
          ${this.renderPlanOption('FREE', currentPlan, null)}
          ${this.renderPlanOption('PRO', currentPlan, productFor('PRO'))}
          ${this.renderPlanOption('PRO_PLUS', currentPlan, productFor('PRO_PLUS'), true)}
          ${this.renderPlanOption('FOUNDER', currentPlan, productFor('FOUNDER'), false, founderUpgradeEligible)}
        </div>
        ${this.products.length === 0 ? '<p class="modal__note">Os preços estarão disponíveis quando os serviços AltGrid reconectarem.</p>' : ''}
        <p class="plan-purchase-note">O pagamento libera o plano para a conta AltGrid usada na compra. Recursos de extensão e proxy estão disponíveis no aplicativo para computador.</p>
        <div class="modal__actions modal__actions--end">
          <button class="button button--secondary" data-close-dialog type="button">Fechar</button>
        </div>
      </dialog>
    `
  }

  private renderUtilityDialog(): string | null {
    if (this.activeDialog === 'update') {
      const state = this.updateState
      const version = state.version
        ? `AltGrid ${escapeHtml(state.version)}`
        : 'AltGrid'
      const notes = state.releaseNotes?.split(/\r?\n/)
        .map((line) => line.replace(/^[-*•]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 8)
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join('') ?? ''
      const progress = Math.max(0, Math.min(100, state.percent ?? 0))
      let content = '<p class="modal__note">Use “Verificar agora” para buscar uma nova versão.</p>'
      let actions = '<button class="button button--primary" data-check-update type="button">Verificar agora</button>'

      if (state.status === 'checking') {
        content = '<p class="update-state"><i class="spinner spinner--green"></i> Verificando atualizações…</p>'
        actions = ''
      } else if (state.status === 'available') {
        content = `<div class="update-summary"><strong>Nova versão disponível</strong><span>${version}</span>${notes ? `<ul>${notes}</ul>` : ''}<small>No Windows, o launcher baixará somente o pacote de atualização necessário e verificará sua integridade.</small></div>`
        actions = '<button class="button button--primary" data-download-update type="button">Baixar atualização</button>'
      } else if (state.status === 'downloading') {
        content = `<div class="update-summary"><strong>Baixando atualização</strong><span>Você pode continuar usando o AltGrid.</span><progress max="100" value="${progress}">${progress}%</progress><small>${Math.round(progress)}%</small></div>`
        actions = ''
      } else if (state.status === 'downloaded') {
        content = `<div class="update-summary"><strong>Atualização verificada e pronta</strong><span>${version}</span>${notes ? `<ul>${notes}</ul>` : ''}<small>No Windows, o launcher fechará as sessões, trocará a versão ativa com segurança e abrirá o AltGrid novamente. O Android continua em um canal de APK separado.</small></div>`
        actions = '<button class="button button--primary" data-install-update type="button">Instalar atualização</button>'
      } else if (state.status === 'not_available') {
        if (!state.supported && state.message) {
          content = `<p class="modal__note">${escapeHtml(state.message)}</p>`
          actions = ''
        } else {
          content = '<p class="modal__note">Você já está usando a versão mais recente.</p>'
          actions = '<button class="button button--secondary" data-check-update type="button">Verificar novamente</button>'
        }
      } else if (state.status === 'error') {
        content = `<div class="form-alert is-visible" role="alert">${escapeHtml(state.message ?? 'Não foi possível verificar atualizações.')}</div>`
        actions = state.version
          ? '<button class="button button--primary" data-download-update type="button">Tentar baixar novamente</button>'
          : '<button class="button button--primary" data-check-update type="button">Verificar novamente</button>'
      }

      return `
        <dialog class="modal modal--update" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header"><p class="eyebrow">Atualizações</p><h2 id="dialog-title">${version}</h2></div>
          ${content}
          <div class="modal__actions">${actions}<button class="button button--secondary" data-close-dialog type="button">${state.status === 'downloaded' ? 'Instalar depois' : 'Fechar'}</button></div>
        </dialog>
      `
    }

    if (this.activeDialog === 'more-games') {
      return `
        <dialog class="modal modal--game-catalog" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header"><p class="eyebrow">Catálogo</p><h2 id="dialog-title">Jogos suportados</h2></div>
          <div class="field"><label class="visually-hidden" for="game-search">Buscar jogo</label><input id="game-search" data-game-search type="search" placeholder="Buscar jogo…" autocomplete="off" /></div>
          <div class="catalog-modal-list" data-game-search-results>
            ${this.games.map((game) => `<button data-select-game="${escapeHtml(game.slug)}" data-game-search-item="${escapeHtml(game.name.toLocaleLowerCase())}" type="button"><span class="game-list__icon">${this.renderGameIcon(game)}</span><span><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml(game.slug)}</small></span><i class="status-dot status-dot--small" aria-hidden="true"></i></button>`).join('') || '<p class="notification-empty">Nenhum jogo disponível no momento.</p>'}
          </div>
          <div class="modal__actions modal__actions--end"><button class="button button--secondary" data-close-dialog type="button">Fechar</button></div>
        </dialog>
      `
    }

    if (this.activeDialog === 'referrals') {
      const program = this.referralProgram
      const campaignEnd = program
        ? new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(program.campaign.ends_at))
        : null
      const ranking = program?.leaderboard ?? []
      const leaderScore = ranking[0]?.valid_referrals ?? 0
      const currentScore = program?.stats.valid ?? 0
      const scoreToLead = Math.max(0, leaderScore - currentScore + (program?.stats.position === 1 ? 0 : 1))
      const rankingProgress = leaderScore > 0
        ? Math.min(100, Math.round((currentScore / Math.max(leaderScore, 1)) * 100))
        : currentScore > 0 ? 100 : 0
      return `
        <dialog class="modal modal--referrals referral-variant--compact" id="app-dialog" aria-labelledby="dialog-title">
          <div class="referral-hero">
            <div>
              <p class="eyebrow">INDIQUE E GANHE</p>
              <h2 id="dialog-title">Convide amigos. Ganhe PRO.</h2>
              <p>Você recebe <strong>1 dia de PRO</strong> por indicação válida e ainda disputa planos vitalícios.</p>
            </div>
            <div class="referral-hero__mark" aria-hidden="true">${uiIcon('gift')}</div>
          </div>

          ${this.referralError ? `<div class="form-alert is-visible" role="alert">${escapeHtml(this.referralError)}</div>` : ''}
          ${this.referralLoading && !program ? '<div class="referral-loading"><span class="spinner spinner--green"></span><span>Validando indicações e carregando o ranking…</span></div>' : ''}
          ${program ? `
            <div class="referral-command-center">
              <section class="referral-invite" aria-label="Seu convite AltGrid">
                <div class="referral-invite__heading">
                  <span class="referral-invite__icon">${uiIcon('sparkles')}</span>
                  <span><small>SEU CONVITE EXCLUSIVO</small><strong>${escapeHtml(program.code)}</strong></span>
                  <span class="referral-live-pill"><i></i> Campanha ativa</span>
                </div>
                <p>Compartilhe este link. O código já chega preenchido no cadastro do seu amigo.</p>
                <div class="referral-link-box">
                  <input data-referral-url type="text" readonly value="${escapeHtml(program.share_url)}" aria-label="Link de indicação" />
                  <button class="button button--secondary" data-copy-referral type="button">${uiIcon('copy')} Copiar link</button>
                  <button class="button button--primary" data-share-referral type="button">${uiIcon('share')} Compartilhar</button>
                </div>
              </section>

              <aside class="referral-position" aria-label="Sua posição na campanha">
                <div class="referral-position__top"><span><small>SUA POSIÇÃO</small><strong>${program.stats.position ? `#${program.stats.position}` : '—'}</strong></span><i>${uiIcon('trophy')}</i></div>
                <div class="referral-position__progress"><i style="width:${rankingProgress}%"></i></div>
                <p>${program.stats.position === 1 ? 'Você está liderando a corrida.' : scoreToLead > 0 ? `${scoreToLead} ${scoreToLead === 1 ? 'indicação' : 'indicações'} para assumir a liderança.` : 'Faça sua primeira indicação para entrar no ranking.'}</p>
                <small>Campanha termina em ${escapeHtml(campaignEnd ?? '—')}</small>
              </aside>
            </div>

            <section class="referral-metrics" aria-label="Seus resultados">
              <article><i>${uiIcon('users')}</i><span><small>Convites enviados</small><strong>${program.stats.total}</strong></span></article>
              <article class="is-success"><i>${uiIcon('check')}</i><span><small>Indicações válidas</small><strong>${program.stats.valid}</strong></span></article>
              <article class="is-pending"><i>${uiIcon('clock')}</i><span><small>Em validação</small><strong>${program.stats.pending}</strong></span></article>
              <article class="is-reward"><i>${uiIcon('star')}</i><span><small>Recompensa acumulada</small><strong>${program.stats.pro_days}d PRO</strong></span></article>
            </section>

            <div class="referral-content-grid">
              <section class="referral-board referral-panel" aria-labelledby="referral-ranking-title">
                <div class="referral-section-heading"><div><p class="eyebrow">RANKING AO VIVO</p><h3 id="referral-ranking-title">Quem está no topo</h3></div><button class="referral-refresh" data-refresh-referrals type="button">${uiIcon('refresh')} Atualizar</button></div>
                <div class="referral-board__list">
                  ${ranking.length > 0 ? ranking.slice(0, 10).map((entry) => `
                    <div class="referral-rank-row ${entry.is_current_user ? 'is-current-user' : ''} ${entry.position <= 3 ? `is-top-${entry.position}` : ''}">
                      <span class="referral-rank-row__position">${entry.position <= 3 ? ['1', '2', '3'][entry.position - 1] : entry.position}</span>
                      <span class="referral-rank-row__avatar">${escapeHtml(entry.display_name.slice(0, 1).toUpperCase())}</span>
                      <span><strong>${escapeHtml(entry.display_name)}${entry.is_current_user ? ' <em>VOCÊ</em>' : ''}</strong><small>${entry.prize_plan ? `Premiação atual: ${entry.prize_plan === 'PRO_PLUS' ? 'PLUS' : entry.prize_plan}` : 'Subindo no ranking'}</small></span>
                      <b>${entry.valid_referrals}<small>${entry.valid_referrals === 1 ? ' indicação' : ' indicações'}</small></b>
                    </div>
                  `).join('') : '<div class="referral-empty"><span>✦</span><strong>O pódio está livre</strong><small>Compartilhe seu convite e seja o primeiro colocado.</small></div>'}
                </div>
              </section>

              <aside class="referral-side-stack">
                <section class="referral-podium referral-panel" aria-labelledby="referral-prizes-title">
                  <div class="referral-section-heading"><div><p class="eyebrow">PRÊMIOS VITALÍCIOS</p><h3 id="referral-prizes-title">Pódio da campanha</h3></div></div>
                  <div class="referral-podium__list">
                    <article class="is-founder"><span>1</span><img src="${planFounderBadgeUrl}" alt="" /><div><strong>FOUNDER</strong><small>Plano máximo vitalício</small></div></article>
                    <article class="is-plus"><span>2</span><img src="${planProPlusBadgeUrl}" alt="" /><div><strong>PLUS</strong><small>Plano Plus vitalício</small></div></article>
                    <article class="is-pro"><span>3</span><img src="${planProBadgeUrl}" alt="" /><div><strong>PRO</strong><small>Plano PRO vitalício</small></div></article>
                  </div>
                </section>

              </aside>
            </div>
            <p class="referral-validation-note">Indicações são validadas após 24h de uso. Conta, e-mail e dispositivo precisam ser únicos.</p>
          ` : ''}
          <div class="modal__actions modal__actions--end"><button class="button button--secondary" data-close-dialog type="button">Fechar</button></div>
        </dialog>
      `
    }

    if (this.activeDialog === 'settings') {
      const restore = localStorage.getItem('altgrid.preference.restore-session') !== 'false'
      const confirmClose = localStorage.getItem('altgrid.preference.confirm-close') !== 'false'
      const notifications = localStorage.getItem('altgrid.preference.notifications') !== 'false'
      const ecoModeAvailable = this.ecoModeSupported
        && this.permissionService.canUseFeature('eco_mode')
      const ecoModeNote = !this.permissionService.canUseFeature('eco_mode')
        ? 'Disponível nos planos PRO e FOUNDER.'
        : this.ecoModeSupported
          ? 'Reduz atividade de telas em segundo plano sem recarregar o jogo.'
          : 'Disponível no aplicativo instalado.'
      const updateChannel = this.configText('update_channel') === 'beta' ? 'Beta' : 'Estável'
      const totalPrivateKb = this.resourceUsage.reduce(
        (total, usage) => total + usage.privateKb,
        0,
      )
      const totalCpu = this.resourceUsage.reduce(
        (total, usage) => total + usage.cpuPercent,
        0,
      )
      const usageRows = this.resourceUsage.map((usage) => {
        const account = this.configuredAccounts.find((item) => item.id === usage.accountId)
        return `<div class="resource-row"><span><strong>${escapeHtml(account?.displayName ?? 'Conta')}</strong><small>${escapeHtml(account ? this.gameNameFor(account) : usage.accountId)}</small></span><b>${escapeHtml(formatMemoryKb(usage.privateKb))}<small>${usage.cpuPercent.toFixed(1)}% CPU</small></b></div>`
      }).join('')
      return `
        <dialog class="modal modal--settings" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header"><p class="eyebrow">Preferências</p><h2 id="dialog-title">Configurações</h2></div>
          <div class="settings-layout">
            <nav aria-label="Categorias das configurações">
              <button class="is-active" data-settings-tab="general" type="button">Geral</button><button data-settings-tab="accounts" type="button">Contas</button><button data-settings-tab="visual" type="button">Visual</button><button data-settings-tab="updates" type="button">Atualizações</button><button data-settings-tab="notifications" type="button">Notificações</button><button data-settings-tab="about" type="button">Sobre</button>
            </nav>
            <div class="settings-content">
              <section data-settings-panel="general"><h3>Geral</h3><label class="setting-toggle"><span><strong>Eco Mode adaptativo</strong><small>${ecoModeNote}</small></span><input data-preference="eco-mode" type="checkbox" ${this.ecoModeRequested ? 'checked' : ''} ${ecoModeAvailable ? '' : 'disabled'} /></label><label class="setting-select"><span><strong>Máximo em segundo plano</strong><small>A conta em uso fica limitada a 30 FPS. Com 4 ou 8 contas, o AltGrid reduz automaticamente as secundárias para 10 ou 5 FPS.</small></span><select data-eco-background-fps ${ecoModeAvailable ? '' : 'disabled'}><option value="10" ${this.ecoBackgroundFps === 10 ? 'selected' : ''}>Até 10 FPS</option><option value="20" ${this.ecoBackgroundFps === 20 ? 'selected' : ''}>Até 20 FPS</option><option value="30" ${this.ecoBackgroundFps === 30 ? 'selected' : ''}>Até 30 FPS</option></select></label><label class="setting-toggle"><span><strong>Restaurar última sessão</strong><small>Reabre as contas usadas na inicialização anterior.</small></span><input data-preference="restore-session" type="checkbox" ${restore ? 'checked' : ''} /></label><label class="setting-toggle"><span><strong>Confirmar antes de fechar</strong><small>Evita encerrar sessões por acidente.</small></span><input data-preference="confirm-close" type="checkbox" ${confirmClose ? 'checked' : ''} /></label></section>
              <section data-settings-panel="accounts" hidden><h3>Contas e desempenho</h3><p>Cookies, sessões e proxies ficam somente neste dispositivo, isolados por conta.</p><div class="resource-summary"><span><small>Uso das sessões</small><strong>${escapeHtml(formatMemoryKb(totalPrivateKb))} · ${totalCpu.toFixed(1)}% CPU</strong></span><button class="button button--secondary" data-refresh-resource-usage type="button" ${this.resourceUsageLoading ? 'disabled' : ''}>${this.resourceUsageLoading ? 'Medindo…' : 'Medir agora'}</button></div>${usageRows ? `<div class="resource-list">${usageRows}</div>` : '<p class="modal__note">Abra suas contas e clique em “Medir agora” para ver o consumo por sessão.</p>'}<p class="modal__note">O perfil de 10 FPS reduz trabalho de CPU/GPU das contas em segundo plano. Como cada jogo mantém um navegador isolado e ativo, a RAM só é totalmente liberada ao fechar a conta.</p></section>
              <section data-settings-panel="visual" hidden><h3>Visual</h3><p>O tema escuro premium acompanha automaticamente o AltGrid.</p></section>
              <section data-settings-panel="updates" hidden><h3>Atualizações</h3><p>Canal atual: <strong>${updateChannel}</strong> · instalada ${APP_VERSION}${this.configText('latest_version') ? ` · disponível ${escapeHtml(this.configText('latest_version')!)}` : ''}</p><button class="button button--secondary" data-check-update type="button">Verificar atualização</button></section>
              <section data-settings-panel="notifications" hidden><h3>Notificações</h3><label class="setting-toggle"><span><strong>Avisos do AltGrid</strong><small>Atualizações, anúncios e alertas do sistema.</small></span><input data-preference="notifications" type="checkbox" ${notifications ? 'checked' : ''} /></label></section>
              <section data-settings-panel="about" hidden><h3>Sobre</h3><p>AltGrid ${APP_VERSION}</p><p class="service-line"><i class="status-dot status-dot--small ${this.serviceStatusDotClass()}"></i> Serviços AltGrid: ${this.serviceStatusLabel()}</p></section>
            </div>
          </div>
          <div class="modal__actions modal__actions--end"><button class="button button--primary" data-close-dialog type="button">Concluir</button></div>
        </dialog>
      `
    }

    if (this.activeDialog === 'shortcuts') {
      return `
        <dialog class="modal" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header"><p class="eyebrow">Produtividade</p><h2 id="dialog-title">Atalhos</h2><p>Atalhos ativos no AltGrid.</p></div>
          <dl class="shortcut-list"><div><dt>Trocar para a conta 1–9</dt><dd><kbd>Ctrl</kbd> + <kbd>1…9</kbd></dd></div><div><dt>Sair de maximizado ou Somente telas</dt><dd><kbd>Esc</kbd></dd></div><div><dt>Abrir ou fechar chat</dt><dd><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd></dd></div></dl>
          <div class="modal__actions modal__actions--end"><button class="button button--secondary" data-close-dialog type="button">Fechar</button></div>
        </dialog>
      `
    }

    if (this.activeDialog === 'about') {
      return `
        <dialog class="modal" id="app-dialog" aria-labelledby="dialog-title">
          <div class="about-brand"><img src="${altgridLogoUrl}" alt="" /><div><p class="eyebrow">ALTGRID</p><h2 id="dialog-title">Gerencie suas sessões</h2></div></div>
          <p class="modal__note">Gerenciador multissessão para jogos e sites suportados. O AltGrid não automatiza gameplay e não envia credenciais dos jogos ao servidor.</p>
          <dl class="about-facts"><div><dt>Versão</dt><dd>${APP_VERSION}${this.configText('latest_version') ? ` · atual ${escapeHtml(this.configText('latest_version')!)}` : ''}</dd></div><div><dt>Serviços AltGrid</dt><dd><i class="status-dot status-dot--small ${this.serviceStatusDotClass()}"></i> ${this.serviceStatusLabel()}</dd></div><div><dt>Conta</dt><dd>${escapeHtml(this.session?.user.email ?? '—')}</dd></div></dl>
          <div class="modal__actions modal__actions--end"><button class="button button--secondary" data-close-dialog type="button">Fechar</button></div>
        </dialog>
      `
    }

    if (this.activeDialog === 'my-plan') {
      const currentPlan = this.permissionService.getCurrentPlan()
      const presentation = PLAN_PRESENTATION[currentPlan]
      const validity = currentPlan === 'FREE'
        ? 'Grátis para sempre'
        : this.me?.lifetime ? 'Vitalício'
        : this.me?.expires_at ? `Ativo até ${formatDate(this.me.expires_at)}` : 'Sem vencimento'
      return `
        <dialog class="modal modal--plan-summary" id="app-dialog" aria-labelledby="dialog-title">
          <header class="plan-summary-hero">
            <span class="plan-summary-hero__mark" aria-hidden="true">${uiIcon('gauge')}</span>
            <div><p class="eyebrow">Central da licença</p><h2 id="dialog-title">Meu plano AltGrid</h2><p>Seu acesso, seus benefícios e todos os níveis em uma visão simples.</p></div>
            <span class="plan-summary-hero__lifetime">${uiIcon('leaf')}<span><small>Licença</small><strong>${escapeHtml(validity)}</strong></span></span>
          </header>
          <div class="plan-summary__content">
            <section class="current-plan-card" aria-label="Resumo do plano atual">
              <div class="current-plan-card__heading"><span><i></i> Plano atual</span><small>Ativo e pronto para usar</small></div>
              <div class="current-plan-card__overview"><div><strong>${escapeHtml(this.renderPlanName())}</strong><p>${escapeHtml(presentation.capacity)}</p></div><span>${escapeHtml(validity)}</span></div>
              <p class="current-plan-card__summary">${escapeHtml(presentation.summary)}</p>
              <ul class="current-plan-card__features">${presentation.benefits.map((benefit) => `<li>${escapeHtml(benefit)}</li>`).join('')}</ul>
              <footer class="current-plan-card__progress"><div class="current-plan-card__meter"><span style="width:${currentPlan === 'FREE' ? '18' : currentPlan === 'PRO' ? '52' : currentPlan === 'PRO_PLUS' ? '76' : '100'}%"></span></div><small class="current-plan-card__hint">${currentPlan === 'FOUNDER' ? 'Você está no nível máximo do AltGrid' : 'Veja abaixo o que os próximos níveis acrescentam'}</small></footer>
            </section>
            <section class="plan-comparison" aria-labelledby="plan-comparison-title">
              <div class="plan-comparison__header"><div><p class="eyebrow">Comparativo completo</p><h3 id="plan-comparison-title">O que cada plano oferece</h3></div><p>${uiIcon('leaf')}<span><strong>Uma única compra.</strong> PRO, PLUS e FOUNDER são vitalícios e não têm mensalidade.</span></p></div>
              <div class="plan-summary-grid">${PLAN_ORDER.map((plan) => this.renderPlanSummaryCard(plan, currentPlan)).join('')}</div>
            </section>
          </div>
          <div class="modal__actions">${currentPlan !== 'FOUNDER' ? '<button class="button button--primary" data-show-plans type="button">Ver preços e opções de upgrade</button>' : ''}<button class="button button--secondary" data-close-dialog type="button">Fechar</button></div>
        </dialog>
      `
    }

    if (this.activeDialog === 'payment') {
      const payment = this.pixPayment
      const qrImage = payment?.qr_code_base64?.match(/^[A-Za-z0-9+/=\r\n]+$/)
        ? payment.qr_code_base64.replace(/\s/g, '')
        : null
      const approved = Boolean(payment && ['approved', 'paid', 'fulfilled'].includes(payment.status))
      const advertisingPayment = Boolean(this.appAdPaymentRequestId)
      return `
        <dialog class="modal modal--payment" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header"><p class="eyebrow">Pagamento seguro</p><h2 id="dialog-title">${approved ? 'Pagamento confirmado' : advertisingPayment ? 'Pagar campanha com PIX' : 'Ativar com PIX'}</h2>${advertisingPayment ? '<p>Plano e conteúdo aprovados pela equipe AltGrid. A campanha entra no ar somente após a confirmação do pagamento.</p>' : ''}</div>
          ${this.paymentError ? `<div class="form-alert is-visible" role="alert">${escapeHtml(this.paymentError)}</div>` : ''}
          ${payment
            ? `<div class="payment-summary"><strong>${escapeHtml(formatCurrency(payment.amount, payment.currency))}</strong><small>${advertisingPayment ? 'Campanha publicitária AltGrid' : escapeHtml(payment.product_code)}</small></div>${approved ? `<div class="payment-approved"><span aria-hidden="true">✓</span><strong>${advertisingPayment ? 'Pagamento confirmado. Sua campanha está sendo ativada.' : 'Seu plano está sendo ativado.'}</strong></div>` : `${qrImage ? `<img class="pix-qr" src="data:image/png;base64,${qrImage}" alt="QR Code PIX" />` : ''}<label class="field pix-copy"><span>Pix Copia e Cola</span><textarea readonly rows="3" data-pix-code>${escapeHtml(payment.qr_code ?? '')}</textarea></label><button class="button button--secondary" data-copy-pix type="button">Copiar código PIX</button><p class="payment-waiting"><i class="spinner spinner--green"></i> Aguardando pagamento…</p>`}`
            : '<div class="payment-waiting"><i class="spinner spinner--green"></i> Preparando seu PIX…</div>'}
          <div class="modal__actions">${payment && !approved ? `<button class="button button--primary" data-refresh-payment type="button" ${this.paymentLoading ? 'disabled' : ''}>${this.paymentLoading ? 'Atualizando…' : 'Atualizar status'}</button>` : ''}<button class="button button--secondary" data-close-dialog type="button">Fechar</button></div>
        </dialog>
      `
    }

    return null
  }

  private renderPlanOption(
    plan: PlanCode,
    currentPlan: PlanCode,
    product: PublicProduct | null,
    recommended = false,
    specialUpgrade = false,
  ): string {
    const presentation = PLAN_PRESENTATION[plan]
    const current = plan === currentPlan
    const included = PLAN_RANK[plan] < PLAN_RANK[currentPlan]
    const isFree = plan === 'FREE'
    const purchaseTerms = isFree
      ? 'Sem cobrança e sem prazo para acabar'
      : 'Pagamento único · licença vitalícia'
    const action = current
      ? '<span class="plan-option__badge">Plano atual</span>'
      : included
        ? '<span class="plan-option__badge plan-option__badge--included">Incluído no seu plano</span>'
        : isFree
          ? '<span class="plan-option__badge plan-option__badge--free">Grátis para sempre</span>'
          : product
            ? `<button class="button button--primary button--compact" data-buy-product="${escapeHtml(product.code)}" type="button">${product.code.endsWith('_UPGRADE') ? 'Fazer upgrade' : 'Ativar com PIX'}</button>`
            : '<span class="plan-option__badge">Preço indisponível</span>'

    return `
      <article class="plan-option ${current ? 'plan-option--current' : ''} ${recommended ? 'plan-option--recommended' : ''}" data-plan-code="${plan}">
        <header class="plan-option__header">
          <div class="plan-option__identity"><span>${escapeHtml(specialUpgrade ? 'Upgrade especial' : presentation.tierLabel)}</span><strong>${escapeHtml(presentation.displayName)}</strong></div>
          ${recommended && !current ? '<span class="plan-option__badge plan-option__badge--recommended">Mais escolhido</span>' : current ? '<span class="plan-option__badge">Atual</span>' : ''}
        </header>
        <div class="plan-option__body">
          <p class="plan-option__capacity">${escapeHtml(presentation.capacity)}</p>
          <p class="plan-option__summary">${escapeHtml(presentation.summary)}</p>
          <ul class="plan-option__features">${presentation.benefits.map((benefit) => `<li>${escapeHtml(benefit)}</li>`).join('')}</ul>
        </div>
        <footer class="plan-option__footer">
          <div class="plan-option__price">${product
            ? `<b>${escapeHtml(formatCurrency(product.price_amount, product.currency))}</b>${product.code.endsWith('_UPGRADE') ? '<span>valor do upgrade</span>' : ''}`
            : isFree ? '<b>R$ 0</b>' : '<b>—</b>'}<small>${purchaseTerms}</small></div>
          <div class="plan-option__actions">${action}</div>
        </footer>
      </article>
    `
  }

  private renderPlanSummaryCard(plan: PlanCode, currentPlan: PlanCode): string {
    const presentation = PLAN_PRESENTATION[plan]
    const current = plan === currentPlan
    const included = PLAN_RANK[plan] < PLAN_RANK[currentPlan]
    const status = current ? 'Seu plano' : included ? 'Já incluído' : 'Disponível'
    const order = String(PLAN_ORDER.indexOf(plan) + 1).padStart(2, '0')

    return `
      <article class="plan-summary-card ${current ? 'is-current' : ''}" data-plan-code="${plan}">
        <header><span class="plan-summary-card__index">${order}</span><div><span>${escapeHtml(presentation.tierLabel)}</span><strong>${escapeHtml(presentation.displayName)}</strong></div><small>${status}</small></header>
        <p>${escapeHtml(presentation.capacity)}</p>
        <small class="plan-summary-card__summary">${escapeHtml(presentation.summary)}</small>
        <ul>${presentation.benefits.map((benefit) => `<li>${escapeHtml(benefit)}</li>`).join('')}</ul>
        <footer>${plan === 'FREE' ? 'Grátis para sempre' : 'Pagamento único · vitalício · sem mensalidade'}</footer>
      </article>
    `
  }

  private renderDialogError(): string {
    return this.dialogError
      ? `<div class="form-alert is-visible" role="alert">${escapeHtml(this.dialogError)}</div>`
      : ''
  }

  private renderMessageCard(
    title: string,
    message: string,
    buttonLabel: string,
    destination: AuthView,
  ): string {
    return `
      <section class="auth-card auth-card--message" aria-labelledby="message-title">
        <span class="message-icon" aria-hidden="true">✓</span>
        <p class="eyebrow">Tudo certo</p>
        <h1 id="message-title">${title}</h1>
        <p class="auth-card__subtitle">${message}</p>
        <button class="button button--secondary" data-view="${destination}" type="button">
          ${buttonLabel}
        </button>
      </section>
    `
  }

  private renderEmailField(id: string): string {
    return `
      <div class="field">
        <label for="${id}">E-mail</label>
        <div class="field__control">
          <span class="field__leading-icon" aria-hidden="true">@</span>
          <input
            id="${id}"
            name="email"
            type="email"
            inputmode="email"
            autocomplete="email"
            placeholder="voce@exemplo.com"
            required
            aria-describedby="${id}-error"
          />
        </div>
        <span class="field__error" id="${id}-error"></span>
      </div>
    `
  }

  private renderPasswordField(
    id: string,
    label: string,
    autocomplete: 'current-password' | 'new-password',
  ): string {
    return `
      <div class="field">
        <label for="${id}">${label}</label>
        <div class="field__control">
          <span class="field__leading-icon field__leading-icon--lock" aria-hidden="true">●</span>
          <input
            id="${id}"
            name="${id.includes('confirmation') ? 'passwordConfirmation' : 'password'}"
            type="password"
            autocomplete="${autocomplete}"
            placeholder="${autocomplete === 'new-password' ? 'Mínimo de 6 caracteres' : 'Digite sua senha'}"
            required
            aria-describedby="${id}-error"
          />
          <button class="field__password-toggle" data-toggle-password="${id}" type="button" aria-label="Mostrar senha" aria-pressed="false">
            <span aria-hidden="true">◉</span>
          </button>
        </div>
        <span class="field__error" id="${id}-error"></span>
      </div>
    `
  }

  private renderAlertSlot(): string {
    const message = this.initialAlert
    this.initialAlert = null

    return `
      <div
        class="form-alert ${message ? 'is-visible' : ''}"
        id="form-alert"
        role="alert"
        aria-live="polite"
      >${message ? escapeHtml(message) : ''}</div>
    `
  }

  private bindViewActions(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-toggle-password]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = this.root.querySelector<HTMLInputElement>(
          `#${button.dataset.togglePassword ?? ''}`,
        )
        if (!input) return
        const visible = input.type === 'text'
        input.type = visible ? 'password' : 'text'
        button.setAttribute('aria-pressed', String(!visible))
        button.setAttribute('aria-label', visible ? 'Mostrar senha' : 'Ocultar senha')
        button.classList.toggle('is-visible', !visible)
      })
    })

    this.root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.addEventListener('click', () => {
        const destination = button.dataset.view as AuthView | undefined

        if (destination) {
          this.navigate(destination)
        }
      })
    })

    this.root
      .querySelector<HTMLButtonElement>('[data-retry-session]')
      ?.addEventListener('click', () => {
        void this.restoreSession()
      })

    this.bindLoginForm()
    this.bindSignupForm()
    this.bindConfirmationActions()
    this.bindGoogleAuthButtons()
    this.bindForgotPasswordForm()
    this.bindResetPasswordForm()
    this.bindAuthenticatedActions()
    this.bindDialogActions()
    this.bindLogoutButton()
  }

  private bindAuthenticatedActions(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-open-dialog]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const dialog = button.dataset.openDialog as ActiveDialog | undefined

          if (!dialog) {
            return
          }

          button.closest('details')?.removeAttribute('open')
          if (this.activeDialog === 'sponsored') this.selectedSponsoredAdId = null
          this.activeDialog = dialog
          this.dialogError = null
          this.render()
          if (dialog === 'referrals') {
            void this.loadReferralProgram()
          }
          if (dialog === 'advertise') {
            void this.loadMyAppAdRequests()
          }
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-extension-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)
          if (!account) return
          button.closest('details')?.removeAttribute('open')
          void this.openExtensionDialog(account)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-sponsored-link]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const ad = this.appAds.find((entry) => entry.id === button.dataset.sponsoredLink)
          if (!ad) return
          const placement = button.dataset.sponsoredPlacement === 'popup' ? 'popup' : 'sidebar'
          if (ad.id !== LOCAL_APP_AD_PREVIEW_ID) {
            void this.backendApi?.recordAppAdEvent?.(ad.id, 'click', placement)
              .catch(() => undefined)
          }
          void Promise.resolve(this.openExternalUrl(ad.destination_url)).catch(() => {
            this.showSessionAlert('Não foi possível abrir o link do anúncio.')
          })
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-preview-sponsored-popup]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const ad = this.appAds.find((entry) => entry.id === button.dataset.previewSponsoredPopup)
          if (!ad) return
          this.selectedSponsoredAdId = ad.id
          this.activeDialog = 'sponsored'
          this.dialogError = null
          this.render()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-proxy-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)

          if (!account) {
            return
          }

          button.closest('details')?.removeAttribute('open')
          void this.openProxyDialog(account)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-toggle-account-proxy]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)
          if (!account) return
          void this.toggleAccountProxy(account, button)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-account-tab]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const accountId = button.dataset.accountId
          const account = this.configuredAccounts.find(
            (candidate) => candidate.id === accountId,
          )

          if (!account) {
            return
          }

          this.workspaceMode = 'account'
          this.maximizedAccountId = null

          if (this.permissionService.isSessionActive(account.id)) {
            this.backgroundAccountIds.delete(account.id)
            this.focusedAccountId = account.id
            this.render()
            void Promise.resolve(this.sessionLauncher.focus(account)).catch(() => undefined)
            return
          }

          void this.openConfiguredAccount(account.id, button)
        })
      })

    this.root
      .querySelectorAll<HTMLElement>('[data-account-order-id]')
      .forEach((tab) => {
        if (tab.dataset.dragBound === 'true') {
          return
        }
        tab.dataset.dragBound = 'true'
        tab.addEventListener('dragstart', (event) => {
          const accountId = tab.dataset.accountOrderId
          if (!accountId || !event.dataTransfer) {
            return
          }
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', accountId)
          tab.classList.add('is-dragging')
        })
        tab.addEventListener('dragend', () => {
          tab.classList.remove('is-dragging')
          this.root.querySelectorAll<HTMLElement>('[data-account-order-id].is-drop-target')
            .forEach((target) => target.classList.remove('is-drop-target'))
        })
        tab.addEventListener('dragover', (event) => {
          event.preventDefault()
          tab.classList.add('is-drop-target')
        })
        tab.addEventListener('dragleave', () => tab.classList.remove('is-drop-target'))
        tab.addEventListener('drop', (event) => {
          event.preventDefault()
          const sourceId = event.dataTransfer?.getData('text/plain')
          const targetId = tab.dataset.accountOrderId
          const userId = this.session?.user.id
          const targetIndex = this.configuredAccounts.findIndex(
            (account) => account.id === targetId,
          )
          if (!sourceId || !userId || sourceId === targetId || targetIndex < 0) {
            return
          }
          this.configuredAccounts = this.accountService.moveTo(
            userId,
            sourceId,
            targetIndex,
          )
          this.reorderedAccountId = sourceId
          this.accountOrderChanged = true
          this.render()
          window.setTimeout(() => {
            this.root.querySelector<HTMLElement>(
              `[data-account-order-id="${CSS.escape(sourceId)}"]`,
            )?.classList.remove('is-reordered')
            this.reorderedAccountId = null
          }, 420)
        })
      })

    const accountScroller = this.root.querySelector<HTMLElement>('[data-account-tabs-scroll]')
    if (accountScroller && accountScroller.dataset.scrollBound !== 'true') {
      accountScroller.dataset.scrollBound = 'true'
      const previous = this.root.querySelector<HTMLButtonElement>(
        '[data-scroll-accounts="previous"]',
      )
      const next = this.root.querySelector<HTMLButtonElement>(
        '[data-scroll-accounts="next"]',
      )
      const updateNavigation = (): void => this.updateAccountTabNavigation()
      const scrollAccounts = (direction: -1 | 1): void => {
        accountScroller.scrollBy({
          behavior: 'smooth',
          left: direction * Math.max(150, accountScroller.clientWidth * 0.75),
        })
      }

      // A small movement threshold before engaging pointer capture keeps plain
      // clicks on account tabs working: capturing on every pointerdown redirects
      // the click event away from the tapped button, silently breaking taps.
      const DRAG_THRESHOLD_PX = 6
      let dragPointerId: number | null = null
      let dragging = false
      let draggedPastThreshold = false
      let dragStartX = 0
      let dragStartScrollLeft = 0
      accountScroller.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'mouse' || event.button !== 0) return
        dragPointerId = event.pointerId
        dragging = false
        draggedPastThreshold = false
        dragStartX = event.clientX
        dragStartScrollLeft = accountScroller.scrollLeft
      })
      accountScroller.addEventListener('pointermove', (event) => {
        if (dragPointerId !== event.pointerId) return
        const delta = event.clientX - dragStartX
        if (!dragging) {
          if (Math.abs(delta) < DRAG_THRESHOLD_PX) return
          dragging = true
          draggedPastThreshold = true
          accountScroller.classList.add('is-dragging')
          accountScroller.setPointerCapture(event.pointerId)
        }
        accountScroller.scrollLeft = dragStartScrollLeft - delta
      })
      const stopDragging = (event: PointerEvent): void => {
        if (dragPointerId !== event.pointerId) return
        if (dragging) {
          accountScroller.classList.remove('is-dragging')
          if (accountScroller.hasPointerCapture(event.pointerId)) {
            accountScroller.releasePointerCapture(event.pointerId)
          }
        }
        dragging = false
        dragPointerId = null
      }
      accountScroller.addEventListener('pointerup', stopDragging)
      accountScroller.addEventListener('pointercancel', stopDragging)
      accountScroller.addEventListener('click', (event) => {
        if (draggedPastThreshold) {
          draggedPastThreshold = false
          event.preventDefault()
          event.stopPropagation()
        }
      }, true)

      previous?.addEventListener('click', () => scrollAccounts(-1))
      next?.addEventListener('click', () => scrollAccounts(1))
      accountScroller.addEventListener('scroll', updateNavigation, { passive: true })
      accountScroller.addEventListener('wheel', (event) => {
        if (
          Math.abs(event.deltaY) <= Math.abs(event.deltaX)
          || accountScroller.scrollWidth <= accountScroller.clientWidth
        ) {
          return
        }
        const before = accountScroller.scrollLeft
        accountScroller.scrollBy({
          behavior: 'auto',
          left: event.deltaY,
        })
        if (accountScroller.scrollLeft !== before) {
          event.preventDefault()
        }
      }, { passive: false })
      accountScroller.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          scrollAccounts(event.key === 'ArrowLeft' ? -1 : 1)
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          accountScroller.scrollTo({
            behavior: 'smooth',
            left: event.key === 'Home' ? 0 : accountScroller.scrollWidth,
          })
        }
      })
      queueMicrotask(updateNavigation)
    }

    const sessionWorkspace = this.root.querySelector<HTMLElement>('[data-session-workspace]')
    if (sessionWorkspace && sessionWorkspace.dataset.scrollLayoutBound !== 'true') {
      sessionWorkspace.dataset.scrollLayoutBound = 'true'
      sessionWorkspace.addEventListener('scroll', () => {
        this.scheduleWorkspaceLayout()
      }, { passive: true })
    }

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-toggle-grid]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          if (this.permissionService.getActiveSessionCount() === 0) {
            this.showSessionAlert(
              this.sessionOpeningInFlight.size > 0
                ? 'Aguarde as contas terminarem de abrir.'
                : 'Abra pelo menos uma conta para usar Grades.',
            )
            return
          }

          this.showSessionAlert('')
          this.workspaceMode = this.workspaceMode === 'grid' ? 'account' : 'grid'
          this.maximizedAccountId = null
          this.gridPageIndex = 0
          this.render()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('.game-sidebar [data-select-game]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const gameSlug = button.dataset.selectGame
          const account = this.configuredAccounts.find(
            (candidate) => candidate.gameSlug === gameSlug,
          )

          if (account) {
            const tab = [...this.root.querySelectorAll<HTMLButtonElement>('[data-account-tab]')]
              .find((candidate) => candidate.dataset.accountId === account.id)

            if (tab) {
              tab.click()
              return
            }
          }

          this.activeDialog = 'add-account'
          this.dialogError = null
          this.render()
          queueMicrotask(() => {
            const form = this.root.querySelector<HTMLFormElement>('#add-account-form')
            const choice = [...(form?.querySelectorAll<HTMLInputElement>('input[name="gameSlug"]') ?? [])]
              .find((input) => input.value === gameSlug)
            if (form && choice) {
              choice.checked = true
              this.syncGamePicker(form)
            }
          })
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-read-notification]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const notificationId = button.dataset.readNotification
          if (notificationId) {
            this.notificationCenter.markRead(notificationId)
            this.render()
          }
        })
      })

    const markAllNotifications = this.root.querySelector<HTMLButtonElement>(
      '[data-read-all-notifications]',
    )
    if (markAllNotifications) {
      this.bindButtonOnce(markAllNotifications, () => {
        this.notificationCenter.markAllRead()
        this.render()
      })
    }

    const openUpdate = this.root.querySelector<HTMLButtonElement>('[data-open-update]')
    if (openUpdate) {
      this.bindButtonOnce(openUpdate, () => {
        this.activeDialog = 'update'
        this.render()
        if (this.updateState.status === 'idle') {
          void this.checkForUpdates(false)
        }
      })
    }

    const openChat = this.root.querySelector<HTMLButtonElement>('[data-open-chat]')
    if (openChat) {
      this.bindButtonOnce(openChat, () => {
        if (this.chatService?.getState().open) {
          this.chatService.close()
        } else if (!this.me?.profile.display_name?.trim()) {
          this.nicknameOnboarding = false
          this.activeDialog = 'chat-nickname'
          this.render()
        } else {
          void this.chatService?.open(this.focusedGameId())
        }
      })
    }

    const mobileHome = this.root.querySelector<HTMLButtonElement>('[data-mobile-home]')
    if (mobileHome) {
      this.bindButtonOnce(mobileHome, () => {
        this.chatService?.close()
        this.workspaceMode = 'account'
        this.maximizedAccountId = null
        this.render()
      })
    }

    const nicknameForm = this.root.querySelector<HTMLFormElement>('[data-chat-nickname-form]')
    if (nicknameForm && nicknameForm.dataset.actionBound !== 'true') {
      nicknameForm.dataset.actionBound = 'true'
      nicknameForm.addEventListener('submit', (event) => {
        event.preventDefault()
        void this.saveChatNickname(nicknameForm)
      })
    }

    const closeChat = this.root.querySelector<HTMLButtonElement>('[data-close-chat]')
    if (closeChat) {
      this.bindButtonOnce(closeChat, () => this.chatService?.close())
    }

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-chat-channel]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const channelId = button.dataset.chatChannel
          if (channelId) {
            void this.chatService?.selectChannel(channelId)
          }
        })
      })

    this.root
      .querySelectorAll<HTMLInputElement>('[data-chat-game-toggle]')
      .forEach((input) => {
        if (input.dataset.actionBound === 'true') {
          return
        }
        input.dataset.actionBound = 'true'
        input.addEventListener('change', () => {
          const channelId = input.dataset.chatGameToggle
          if (channelId) {
            this.setChatGameChannelVisible(channelId, input.checked)
          }
        })
      })

    const loadOlderMessages = this.root.querySelector<HTMLButtonElement>(
      '[data-chat-load-more]',
    )
    if (loadOlderMessages) {
      this.bindButtonOnce(loadOlderMessages, () => {
        void this.chatService?.loadMore()
      })
    }

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-block-chat-user]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const userId = button.dataset.blockChatUser
          if (userId) {
            this.chatService?.blockUser(userId)
          }
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-report-chat-message]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const messageId = button.dataset.reportChatMessage
          const reason = window.prompt('Motivo da denúncia:', 'Conteúdo inadequado')?.trim()
          if (messageId && reason) {
            void this.chatService?.report(messageId, reason)
              .then(() => this.showSessionAlert('Denúncia enviada para moderação.'))
              .catch(() => this.showSessionAlert('Não foi possível enviar a denúncia.'))
          }
        })
      })

    const chatForm = this.root.querySelector<HTMLFormElement>('#chat-form')
    if (chatForm && chatForm.dataset.actionBound !== 'true') {
      chatForm.dataset.actionBound = 'true'
      chatForm.addEventListener('submit', (event) => {
        event.preventDefault()
        const channelId = this.chatService?.getState().selectedChannelId
        const field = chatForm.elements.namedItem('message')
        if (!channelId || !(field instanceof HTMLTextAreaElement)) {
          return
        }
        void this.chatService?.send(field.value)
          .then(() => {
            field.value = ''
          })
          .catch((error) => this.showSessionAlert(
            error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.',
          ))
      })
    }

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-add-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          this.dialogError = null
          this.dialogReturnFocus = { type: 'add-account' }
          this.activeDialog = 'add-account'
          this.render()
          void this.refreshGamePresets()
        })
      })

    this.root
      .querySelector<HTMLButtonElement>('[data-retry-backend]')
      && this.bindButtonOnce(
        this.root.querySelector<HTMLButtonElement>('[data-retry-backend]')!,
        () => {
        if (this.session) {
          void this.loadApplicationData(this.session, true)
        }
        },
      )

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-open-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const accountId = button.dataset.accountId

          if (accountId) {
            void this.openConfiguredAccount(accountId, button)
          }
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-close-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const accountId = button.dataset.accountId

          if (accountId) {
            button.closest('details')?.removeAttribute('open')
            void this.closeConfiguredAccount(accountId, button)
          }
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('button[data-grid-mode]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const mode = button.dataset.gridMode as GridMode | undefined

          if (!mode || !this.gridLayoutService.listModes().some((item) => item.mode === mode)) {
            return
          }

          button.closest('details')?.removeAttribute('open')
          if (!this.gridLayoutService.isModeAvailable(mode)) {
            this.activeDialog = 'plans'
            this.render()
            return
          }

          this.gridMode = mode
          this.storeGridModePreference(mode)
          this.gridPageIndex = 0
          this.maximizedAccountId = null
          this.applyWorkspacePresentation()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-direct-chat-user]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const recipientId = button.dataset.directChatUser
          if (!recipientId) return
          void this.chatService?.startDirectConversation(recipientId)
            .catch((error) => this.showSessionAlert(
              error instanceof Error
                ? error.message
                : 'Não foi possível abrir a conversa direta.',
            ))
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-mention-chat-user]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const nickname = button.dataset.mentionChatUser?.trim()
          const field = this.root.querySelector<HTMLTextAreaElement>(
            '#chat-form textarea[name="message"]',
          )
          if (!nickname || !field) return
          const mention = `@${nickname} `
          const start = field.selectionStart ?? field.value.length
          const end = field.selectionEnd ?? start
          field.value = `${field.value.slice(0, start)}${mention}${field.value.slice(end)}`
          field.focus()
          field.setSelectionRange(start + mention.length, start + mention.length)
          button.closest('details')?.removeAttribute('open')
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-delete-direct-chat]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const channelId = button.dataset.deleteDirectChat
          const name = button.dataset.directChatName || 'esta pessoa'
          if (!channelId || !window.confirm(
            `Apagar sua conversa com ${name}? Ela será removida somente para você. Uma nova mensagem poderá reabri-la.`,
          )) return
          void this.chatService?.deleteDirectConversation(channelId)
            .then(() => this.showSessionAlert('Conversa privada apagada.'))
            .catch((error) => this.showSessionAlert(
              error instanceof Error ? error.message : 'Não foi possível apagar a conversa.',
            ))
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-select-grid-workspace]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          this.workspaceMode = 'grid'
          this.selectGridWorkspace(button.dataset.selectGridWorkspace || null)
          this.lastLayoutSignature = ''
          this.render()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-create-grid-workspace]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          void this.openGridManagerDialog(null)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-edit-grid-workspace]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const gridId = button.dataset.editGridWorkspace
          if (!gridId) return
          void this.openGridManagerDialog(gridId)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-grid-page]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const direction = button.dataset.gridPage
          this.gridPageIndex += direction === 'previous' ? -1 : 1
          this.applyWorkspacePresentation()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-toggle-screens-only]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          this.screensOnly = !this.screensOnly
          this.applyWorkspacePresentation()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-toggle-sidebar]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          this.sidebarCollapsed = !this.sidebarCollapsed
          try {
            localStorage.setItem(
              SIDEBAR_COLLAPSED_STORAGE_KEY,
              String(this.sidebarCollapsed),
            )
          } catch {
            // The HUD remains usable when persistent storage is unavailable.
          }
          this.lastLayoutSignature = ''
          this.render()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-exit-screens-only]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          if (this.mobileSessionMode) {
            this.maximizedAccountId = null
            this.setNativeFullscreen(false)
          }
          this.screensOnly = false
          this.lastLayoutSignature = ''
          this.applyWorkspacePresentation()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-toggle-utility-bar]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          this.utilityBarCollapsed = !this.utilityBarCollapsed
          try {
            localStorage.setItem(
              UTILITY_BAR_COLLAPSED_STORAGE_KEY,
              String(this.utilityBarCollapsed),
            )
          } catch {
            // The bar remains collapsible for the current session.
          }
          this.lastLayoutSignature = ''
          this.render()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-background-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)
          if (!account || this.mobileSessionMode) return
          button.closest('details')?.removeAttribute('open')
          this.backgroundAccountIds.add(account.id)
          if (this.maximizedAccountId === account.id) {
            this.maximizedAccountId = null
          }
          this.lastLayoutSignature = ''
          this.render()
          this.showSessionAlert(`${account.displayName} continua rodando em segundo plano.`)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-toggle-workspace-rest]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const targets = this.utilityRestTargets()
          if (targets.length === 0 || this.mobileSessionMode) return
          const wake = targets.every((account) => this.backgroundAccountIds.has(account.id))

          targets.forEach((account) => {
            if (wake) {
              this.backgroundAccountIds.delete(account.id)
            } else {
              this.backgroundAccountIds.add(account.id)
            }
          })
          if (wake) {
            this.focusedAccountId = targets[0]?.id ?? this.focusedAccountId
          }
          this.lastLayoutSignature = ''
          this.render()
          this.showSessionAlert(wake
            ? `${targets.length === 1 ? targets[0]!.displayName : `${targets.length} contas`} despertada${targets.length === 1 ? '' : 's'}.`
            : `${targets.length === 1 ? targets[0]!.displayName : `${targets.length} contas`} continua${targets.length === 1 ? '' : 'm'} rodando em descanso.`)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-restore-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)
          if (!account) return
          this.backgroundAccountIds.delete(account.id)
          this.focusedAccountId = account.id
          this.lastLayoutSignature = ''
          this.render()
          void Promise.resolve(this.sessionLauncher.focus(account)).catch(() => undefined)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-copy-proxy-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)
          if (!account) return
          button.closest('details')?.removeAttribute('open')
          void this.openCopyProxyDialog(account)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-maximize-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const accountId = button.dataset.accountId

          if (!accountId || !this.permissionService.isSessionActive(accountId)) {
            return
          }

          button.closest('details')?.removeAttribute('open')
          if (
            this.mobileSessionMode
            && this.screensOnly
            && this.maximizedAccountId === accountId
          ) {
            this.maximizedAccountId = null
            this.screensOnly = false
          } else {
            this.focusedAccountId = accountId
            this.maximizedAccountId = accountId
            if (this.mobileSessionMode) {
              this.screensOnly = true
            }
          }
          this.lastLayoutSignature = ''
          this.applyWorkspacePresentation()
          this.setNativeFullscreen(this.screensOnly)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-reload-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)

          if (!account) {
            return
          }

          button.closest('details')?.removeAttribute('open')
          button.disabled = true
          this.sessionIssues.delete(account.id)
          this.lastLayoutSignature = ''
          this.render()
          void Promise.resolve()
            .then(() => this.sessionLauncher.reload(account))
            .catch(() => {
              this.sessionIssues.set(account.id, 'Não foi possível carregar esta conta.')
              this.render()
              this.showSessionAlert('Não foi possível recarregar esta conta.')
            })
            .finally(() => {
              if (button.isConnected) {
                button.disabled = false
              }
            })
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-toggle-session-mute]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)

          if (!account) {
            return
          }

          button.closest('details')?.removeAttribute('open')
          const muted = !this.mutedAccountIds.has(account.id)
          button.disabled = true
          void Promise.resolve()
            .then(() => this.sessionLauncher.setMuted(account, muted))
            .then(() => {
              if (muted) {
                this.mutedAccountIds.add(account.id)
              } else {
                this.mutedAccountIds.delete(account.id)
              }
              this.render()
            })
            .catch(() => this.showSessionAlert('Não foi possível alterar o áudio desta conta.'))
            .finally(() => {
              if (button.isConnected) {
                button.disabled = false
              }
            })
        })
      })

    this.root
      .querySelectorAll<HTMLInputElement>('[data-session-frame-rate]')
      .forEach((input) => {
        if (input.dataset.actionBound === 'true') {
          return
        }

        input.dataset.actionBound = 'true'
        input.addEventListener('change', () => {
          const account = this.accountFromAction(input)
          if (!account) {
            return
          }

          const rawValue = input.value.trim()
          const fps = rawValue === '' ? 0 : Number(rawValue)
          if (!Number.isInteger(fps) || fps < 0 || fps > 240) {
            const previous = this.sessionFrameRateFor(account.id)
            input.value = previous === 0 ? '' : String(previous)
            this.showSessionAlert('Informe um FPS entre 1 e 240, ou deixe vazio para Auto.')
            return
          }

          void this.updateSessionFrameRate(account, fps, input)
        })
      })

    this.root
      .querySelectorAll<HTMLSelectElement>('[data-session-interface-scale]')
      .forEach((select) => {
        if (select.dataset.actionBound === 'true') {
          return
        }

        select.dataset.actionBound = 'true'
        select.addEventListener('change', () => {
          const account = this.accountFromAction(select)
          if (!account) {
            return
          }

          const scale = select.value === '' ? null : Number(select.value) / 100
          if (scale !== null && (!Number.isFinite(scale) || scale < 0.5 || scale > 1)) {
            const previous = this.sessionInterfaceScaleFor(account.id)
            select.value = previous === null ? '' : String(Math.round(previous * 100))
            this.showSessionAlert('Escolha uma escala entre 50% e 100%.')
            return
          }

          void this.updateSessionInterfaceScale(account, scale, select)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-reset-session-scale]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)
          const select = button.closest<HTMLElement>('[data-session-menu]')
            ?.querySelector<HTMLSelectElement>('[data-session-interface-scale]')
          if (!account || !select) return

          void this.updateSessionInterfaceScale(account, null, select).then((restored) => {
            if (!restored) return
            button.closest('details')?.removeAttribute('open')
            this.showSessionAlert(`Escala de ${account.displayName} restaurada sem apagar seus dados.`)
          })
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-clear-session-data]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)

          if (!account) {
            return
          }

          button.closest('details')?.removeAttribute('open')
          if (!window.confirm(
            `Limpar cookies e dados locais de ${account.displayName}? Você precisará entrar novamente no jogo.`,
          )) {
            return
          }

          void this.clearConfiguredAccountData(account, button)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-rename-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)

          if (!account) {
            return
          }

          button.closest('details')?.removeAttribute('open')
          this.dialogAccountId = account.id
          this.dialogReturnFocus = { accountId: account.id, type: 'account' }
          this.activeDialog = 'rename-account'
          this.dialogError = null
          this.render()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-delete-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)

          if (!account) {
            return
          }

          button.closest('details')?.removeAttribute('open')
          this.dialogAccountId = account.id
          this.dialogReturnFocus = { accountId: account.id, type: 'account' }
          this.activeDialog = 'delete-account'
          this.dialogError = null
          this.render()
        })
      })

    this.root
      .querySelectorAll<HTMLElement>('[data-focus-account]')
      .forEach((surface) => {
        if (surface.dataset.actionBound === 'true') {
          return
        }

        surface.dataset.actionBound = 'true'
        surface.addEventListener('pointerdown', () => {
          const accountId = surface.dataset.accountId
          const account = this.configuredAccounts.find((item) => item.id === accountId)
          if (account) {
            this.focusedAccountId = account.id
            this.updateWorkspaceContext(account)
            void Promise.resolve()
              .then(() => this.sessionLauncher.focus(account))
              .catch(() => undefined)
          }
        })
      })

    this.root
      .querySelectorAll<HTMLElement>('[data-session-card]')
      .forEach((card) => {
        if (card.dataset.doubleClickBound === 'true') {
          return
        }
        card.dataset.doubleClickBound = 'true'
        card.addEventListener('dblclick', () => {
          const accountId = card.dataset.accountId
          if (accountId && this.permissionService.isSessionActive(accountId)) {
            this.maximizedAccountId = accountId
            this.applyWorkspacePresentation()
          }
        })
      })

    this.root
      .querySelectorAll<HTMLDetailsElement>(
        'details[data-session-menu], details[data-toolbar-menu]',
      )
      .forEach((details) => {
        if (details.dataset.menuBound === 'true') {
          return
        }

        details.dataset.menuBound = 'true'
        details.addEventListener('toggle', () => {
          if (details.open) {
            this.root
              .querySelectorAll<HTMLDetailsElement>(
                'details[data-session-menu][open], details[data-toolbar-menu][open]',
              )
              .forEach((other) => {
                if (other !== details) {
                  other.removeAttribute('open')
                }
              })

            if (details.matches('[data-session-menu]')) {
              this.positionAccountMenu(details)
            }
          }

          // Native WebContentsViews always sit above renderer HTML. Parking
          // them while a menu is open keeps notifications, Layout and ⋯ usable.
          this.applyWorkspacePresentation()
        })
      })
  }

  private positionAccountMenu(details: HTMLDetailsElement): void {
    const trigger = details.querySelector<HTMLElement>('summary')
    const menu = details.querySelector<HTMLElement>('.menu-popover')

    if (!trigger || !menu) {
      return
    }

    requestAnimationFrame(() => {
      if (!details.open) {
        return
      }

      const margin = 8
      const triggerRect = trigger.getBoundingClientRect()
      menu.style.maxHeight = `${Math.max(160, window.innerHeight - margin * 2)}px`
      menu.style.overflowY = 'auto'
      const menuRect = menu.getBoundingClientRect()
      const left = Math.min(
        window.innerWidth - menuRect.width - margin,
        Math.max(margin, triggerRect.right - menuRect.width),
      )
      const below = triggerRect.bottom + 6
      const top = below + menuRect.height <= window.innerHeight - margin
        ? below
        : Math.max(margin, triggerRect.top - menuRect.height - 6)

      menu.style.left = `${left}px`
      menu.style.right = 'auto'
      menu.style.top = `${top}px`
      menu.style.bottom = 'auto'
    })
  }

  private updateWorkspaceContext(account: ConfiguredAccount): void {
    const context = this.root.querySelector<HTMLElement>('[data-workspace-context]')

    if (!context) {
      return
    }

    const gameName = this.gameNameFor(account)
    context.title = `${account.displayName} · ${gameName}`
    context.replaceChildren(
      document.createTextNode(gameName),
      Object.assign(document.createElement('span'), {
        ariaHidden: 'true',
        textContent: '·',
      }),
      document.createTextNode(account.displayName),
    )
  }

  private bindButtonOnce(button: HTMLButtonElement, listener: () => void): void {
    if (button.dataset.actionBound === 'true') {
      return
    }

    button.dataset.actionBound = 'true'
    button.addEventListener('click', listener)
  }

  private accountFromAction(element: HTMLElement): ConfiguredAccount | null {
    const accountId = element.dataset.accountId
    return this.configuredAccounts.find((account) => account.id === accountId) ?? null
  }

  private closeDialog(): void {
    const returnFocus = this.dialogReturnFocus
    if (
      this.activeDialog === 'sponsored'
      && this.selectedSponsoredAdId
      && this.selectedSponsoredAdId !== LOCAL_APP_AD_PREVIEW_ID
      && this.selectedSponsoredAdId !== HOUSE_APP_AD_ID
    ) {
      void this.backendApi?.recordAppAdEvent?.(
        this.selectedSponsoredAdId,
        'dismiss',
        'popup',
      ).catch(() => undefined)
    }
    if (this.activeDialog === 'sponsored') this.selectedSponsoredAdId = null
    if (this.activeDialog === 'advertise') {
      this.appAdSuccess = null
      this.appAdTestStage = 1
    }
    if (this.activeDialog === 'payment') {
      this.stopPaymentPolling()
      this.appAdPaymentRequestId = null
    }
    if (this.activeDialog === 'proxy' || this.activeDialog === 'copy-proxy') {
      this.proxyConfig = null
      this.proxyLoading = false
      this.proxySaving = false
      this.proxyTestResult = null
    }
    if (this.activeDialog === 'extension') {
      this.extensionConfig = null
      this.extensionLoading = false
      this.extensionSaving = false
    }
    this.activeDialog = null
    this.dialogError = null
    this.dialogAccountId = null
    this.dialogGridWorkspaceId = null
    this.render()

    queueMicrotask(() => {
      let target: HTMLButtonElement | null = null

      if (returnFocus?.type === 'add-account') {
        target = this.root.querySelector<HTMLButtonElement>(
          '[data-add-account]',
        )
      } else if (returnFocus?.type === 'account') {
        this.root
          .querySelectorAll<HTMLButtonElement>('[data-account-id]')
          .forEach((button) => {
            if (button.dataset.accountId === returnFocus.accountId) {
              target = button
            }
          })
      }

      target?.focus()
      this.dialogReturnFocus = null
    })
  }

  private completeAddedAccount(account: ConfiguredAccount): void {
    if (!this.session) {
      return
    }

    this.configuredAccounts = this.accountService.list(this.session.user.id)
    this.loadSavedGridWorkspaces(this.session.user.id)

    // Keep native game views hidden while transitioning directly from the
    // picker to the limit warning. This avoids a transient 1x1 view covering
    // the warning when the desktop layout queue is busy.
    if (!this.permissionService.canOpenAnotherSession(account.gameSlug)) {
      this.dialogReturnFocus = { accountId: account.id, type: 'account' }
      this.dialogAccountId = account.id
      this.activeDialog = 'free-limit'
      this.dialogError = null
      this.render()
      return
    }

    this.closeDialog()
    void this.openConfiguredAccount(account.id, document.createElement('button'))
  }

  private syncGamePicker(form: HTMLFormElement): void {
    const selected = form.querySelector<HTMLInputElement>(
      'input[name="gameSlug"]:checked',
    )?.value
    const customFields = form.querySelector<HTMLElement>(
      '[data-custom-game-url]',
    )
    const customInput = form.elements.namedItem('customLaunchUrl')
    const customSelected = selected === CUSTOM_GAME_SLUG

    if (customFields) {
      customFields.hidden = !customSelected
    }

    if (customInput instanceof HTMLInputElement) {
      customInput.required = customSelected
    }

  }

  private async submitAppAdRequest(form: HTMLFormElement): Promise<void> {
    if (!this.backendApi?.createAppAdRequest || this.appAdSubmitting) {
      this.dialogError = 'O envio de anúncios está indisponível no momento.'
      this.render()
      return
    }
    const data = new FormData(form)
    const destinationUrl = String(data.get('destination_url') ?? '').trim()
    const imageUrl = String(data.get('image_url') ?? '').trim()
    const catalogLaunchUrl = String(data.get('catalog_launch_url') ?? '').trim()
    const catalogIconUrl = String(data.get('catalog_icon_url') ?? '').trim()
    if (
      !normalizeSafeGameUrl(destinationUrl)
      || (imageUrl && !normalizeSafeGameUrl(imageUrl))
      || (catalogLaunchUrl && !normalizeSafeGameUrl(catalogLaunchUrl))
      || (catalogIconUrl && !normalizeSafeGameUrl(catalogIconUrl))
    ) {
      this.dialogError = 'Use somente links HTTPS válidos para o destino e para a imagem.'
      this.render()
      return
    }
    const input: CreateAppAdRequestInput = {
      plan_code: String(data.get('plan_code') ?? ''),
      category: String(data.get('category') ?? '') as CreateAppAdRequestInput['category'],
      game_slug: String(data.get('category') ?? '') === 'game'
        && String(data.get('game_slug') ?? '') !== '__request__'
        ? String(data.get('game_slug') ?? '').trim()
        : null,
      catalog_game_name: String(data.get('game_slug') ?? '') === '__request__'
        ? String(data.get('catalog_game_name') ?? '').trim()
        : null,
      catalog_launch_url: String(data.get('game_slug') ?? '') === '__request__'
        ? catalogLaunchUrl
        : null,
      catalog_icon_url: String(data.get('game_slug') ?? '') === '__request__'
        ? catalogIconUrl
        : null,
      advertiser_name: String(data.get('advertiser_name') ?? '').trim(),
      title: String(data.get('title') ?? '').trim(),
      description: String(data.get('description') ?? '').trim(),
      destination_url: destinationUrl,
      image_url: imageUrl || null,
      cta_label: String(data.get('cta_label') ?? '').trim(),
      requested_days: Number(data.get('requested_days')),
    }
    this.appAdSubmitting = true
    this.dialogError = null
    this.render()
    try {
      const response = await this.backendApi.createAppAdRequest(input)
      this.appAdSuccess = `Pedido enviado com estimativa de ${formatCurrency(response.request.quoted_amount, response.request.currency)} para ${response.request.requested_days} dias. Aguarde sua análise administrativa; o PIX ainda não foi gerado.`
      await this.loadMyAppAdRequests(false)
    } catch (error) {
      this.dialogError = backendErrorMessage(error)
    } finally {
      this.appAdSubmitting = false
      this.render()
    }
  }

  private async loadMyAppAdRequests(renderLoading = true): Promise<void> {
    if (!this.backendApi?.getMyAppAdRequests || this.myAppAdRequestsLoading) return
    this.myAppAdRequestsLoading = true
    if (renderLoading) this.render()
    try {
      const response = await this.backendApi.getMyAppAdRequests()
      this.myAppAdRequests = response.requests
    } catch (error) {
      this.dialogError = backendErrorMessage(error)
    } finally {
      this.myAppAdRequestsLoading = false
      this.render()
    }
  }

  private async createAppAdPixPayment(requestId: string, button: HTMLButtonElement): Promise<void> {
    if (!this.backendApi?.createAppAdPixPayment) {
      this.dialogError = 'O pagamento PIX para anúncios está indisponível no momento.'
      this.render()
      return
    }
    this.appAdPaymentRequestId = requestId
    this.activeDialog = 'payment'
    this.pixPayment = null
    this.paymentError = null
    this.paymentLoading = true
    button.disabled = true
    this.render()
    try {
      const response = await this.backendApi.createAppAdPixPayment(requestId)
      this.pixPayment = response.payment
      this.startPaymentPolling()
    } catch (error) {
      this.paymentError = backendErrorMessage(error)
    } finally {
      this.paymentLoading = false
      this.render()
    }
  }

  private async createPixPayment(
    productCode: string,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (!this.backendApi?.createPixPayment) {
      this.dialogError = 'O pagamento PIX está indisponível no momento.'
      this.render()
      return
    }

    this.activeDialog = 'payment'
    this.appAdPaymentRequestId = null
    this.pixPayment = null
    this.paymentError = null
    this.paymentLoading = true
    button.disabled = true
    this.render()

    try {
      const response = await this.backendApi.createPixPayment(productCode)
      this.pixPayment = response.payment
      this.startPaymentPolling()
    } catch (error) {
      this.paymentError = backendErrorMessage(error)
    } finally {
      this.paymentLoading = false
      this.render()
    }
  }

  private async refreshPixPayment(button?: HTMLButtonElement): Promise<void> {
    if (!this.pixPayment) {
      return
    }

    this.paymentLoading = true
    this.paymentError = null
    if (button) button.disabled = true

    try {
      const response = this.appAdPaymentRequestId
        ? await this.backendApi?.getAppAdPayment?.(this.appAdPaymentRequestId)
        : await this.backendApi?.getPayment?.(this.pixPayment.id)
      if (!response) throw new Error('Consulta de pagamento indisponível.')
      this.pixPayment = response.payment
      if (
        this.session
        && ['approved', 'fulfilled', 'paid'].includes(response.payment.status)
      ) {
        if (this.appAdPaymentRequestId) {
          void this.loadMyAppAdRequests(false)
        } else {
          void this.loadApplicationData(this.session, true)
        }
        this.stopPaymentPolling()
      }
    } catch (error) {
      this.paymentError = backendErrorMessage(error)
    } finally {
      this.paymentLoading = false
      this.render()
    }
  }

  private startPaymentPolling(): void {
    this.stopPaymentPolling()
    const poll = async (): Promise<void> => {
      if (
        this.destroyed
        || this.activeDialog !== 'payment'
        || !this.pixPayment
        || ['approved', 'fulfilled', 'paid', 'cancelled', 'rejected', 'refunded']
          .includes(this.pixPayment.status)
      ) {
        this.stopPaymentPolling()
        return
      }
      if (!this.paymentLoading) {
        await this.refreshPixPayment()
      }
      if (this.activeDialog === 'payment' && this.paymentPollTimer === null) {
        this.paymentPollTimer = setTimeout(() => {
          this.paymentPollTimer = null
          void poll()
        }, 5_000)
      }
    }
    this.paymentPollTimer = setTimeout(() => {
      this.paymentPollTimer = null
      void poll()
    }, 5_000)
  }

  private stopPaymentPolling(): void {
    if (this.paymentPollTimer !== null) {
      clearTimeout(this.paymentPollTimer)
      this.paymentPollTimer = null
    }
  }

  private startAdminPaymentAlerts(): void {
    if (
      !this.adminAccess
      || !this.backendApi?.getAdminPaymentLogs
      || this.adminPaymentAlertTimer !== null
      || this.destroyed
    ) {
      return
    }

    void this.refreshAdminPaymentAlerts()
    this.adminPaymentAlertTimer = setInterval(() => {
      void this.refreshAdminPaymentAlerts()
    }, 10_000)
  }

  private stopAdminPaymentAlerts(): void {
    if (this.adminPaymentAlertTimer !== null) {
      clearInterval(this.adminPaymentAlertTimer)
      this.adminPaymentAlertTimer = null
    }
    this.adminPaymentAlertLoading = false
    this.adminPaymentsInitialized = false
    this.adminAdRequestsInitialized = false
    this.adminChatReportsInitialized = false
    this.adminPaymentStates.clear()
    this.adminAdRequestStates.clear()
    this.adminChatReportIds.clear()
  }

  private async refreshAdminPaymentAlerts(): Promise<void> {
    const backendApi = this.backendApi
    if (
      !this.adminAccess
      || !backendApi?.getAdminPaymentLogs
      || this.adminPaymentAlertLoading
    ) {
      return
    }

    this.adminPaymentAlertLoading = true
    try {
      const [paymentsResult, adsResult, reportsResult] = await Promise.allSettled([
        backendApi.getAdminPaymentLogs(1, 25),
        backendApi.getAdminAppAdRequests?.(null) ?? Promise.resolve({ requests: [] }),
        backendApi.getAdminChatReports?.('pending', 1, 25)
          ?? Promise.resolve({ reports: [], pagination: { has_more: false, page: 1, page_size: 25, total: 0 } }),
      ])
      const nextStates = new Map<string, string>()
      const confirmedStatuses = new Set(['approved', 'fulfilled', 'paid'])
      let supplementalNotificationAdded = false

      if (paymentsResult.status === 'fulfilled') {
        for (const payment of [...paymentsResult.value.payments].reverse()) {
          nextStates.set(payment.id, payment.status)
          if (!this.adminPaymentsInitialized) continue

          const previousStatus = this.adminPaymentStates.get(payment.id)
          const confirmed = confirmedStatuses.has(payment.status)
          const becameConfirmed = previousStatus !== undefined
            && !confirmedStatuses.has(previousStatus)
            && confirmed

          if (previousStatus === undefined || becameConfirmed) {
            await this.notifyAdminPayment(payment, confirmed)
          }
        }
        this.adminPaymentStates.clear()
        nextStates.forEach((status, paymentId) => this.adminPaymentStates.set(paymentId, status))
        this.adminPaymentsInitialized = true
      }

      if (adsResult.status === 'fulfilled') {
        const nextAds = new Map<string, string>()
        for (const request of [...adsResult.value.requests].reverse()) {
          nextAds.set(request.id, request.status)
          if (this.adminAdRequestsInitialized && !this.adminAdRequestStates.has(request.id)) {
            this.notificationCenter.upsertSystemNotification({
              id: `admin-ad-request:${request.id}`,
              occurredAt: request.created_at,
              title: 'Novo pedido de anúncio',
              summary: `${request.advertiser_name} · ${request.plan_name} · ${request.requested_days} dias · ${formatCurrency(request.quoted_amount, request.currency)}`,
            })
            playAdminPaymentAlertSound(false)
            supplementalNotificationAdded = true
          }
        }
        this.adminAdRequestStates.clear()
        nextAds.forEach((status, requestId) => this.adminAdRequestStates.set(requestId, status))
        this.adminAdRequestsInitialized = true
      }

      if (reportsResult.status === 'fulfilled') {
        const nextReportIds = new Set(reportsResult.value.reports.map((report) => report.id))
        if (this.adminChatReportsInitialized) {
          for (const report of reportsResult.value.reports) {
            if (this.adminChatReportIds.has(report.id)) continue
            this.notificationCenter.upsertSystemNotification({
              id: `admin-chat-report:${report.id}`,
              occurredAt: report.created_at,
              title: 'Nova denúncia no chat',
              summary: `${report.reason} · mensagem ${report.message_id}`,
            })
            playAdminPaymentAlertSound(false)
            supplementalNotificationAdded = true
          }
        }
        this.adminChatReportIds.clear()
        nextReportIds.forEach((reportId) => this.adminChatReportIds.add(reportId))
        this.adminChatReportsInitialized = true
      }
      if (supplementalNotificationAdded) this.render()
    } catch {
      // Administrative alerts retry on the next polling cycle.
    } finally {
      this.adminPaymentAlertLoading = false
    }
  }

  private async notifyAdminPayment(
    payment: AdminPaymentLog,
    confirmed: boolean,
  ): Promise<void> {
    let user: AdminUserDetail | null = null
    try {
      user = this.backendApi?.getAdminUser
        ? (await this.backendApi.getAdminUser(payment.user_id)).user
        : null
    } catch {
      // The payment alert remains useful with the immutable user id.
    }

    const nickname = user?.display_name?.trim()
    const identity = nickname
      ? `${nickname}${user?.email ? ` · ${user.email}` : ''}`
      : user?.email ?? payment.user_id
    this.notificationCenter.upsertSystemNotification({
      id: `admin-payment:${payment.id}:${confirmed ? 'confirmed' : 'attempt'}`,
      occurredAt: payment.updated_at || payment.created_at,
      summary: `${identity} · ${payment.product_code} · ${formatCurrency(payment.amount, payment.currency)}`,
      title: confirmed ? 'Compra aprovada' : 'Nova tentativa de compra',
    })
    playAdminPaymentAlertSound(confirmed)
    this.render()
  }

  private bindDialogActions(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-close-dialog]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          this.closeDialog()
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-test-ad-stage]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          if (!LOCAL_AD_TEST_MODE) return
          const stage = Number(button.dataset.testAdStage)
          if (![1, 2, 3, 4].includes(stage)) return
          this.appAdTestStage = stage as 1 | 2 | 3 | 4
          this.dialogError = null
          this.render()
        })
      })

    const advertiseForm = this.root.querySelector<HTMLFormElement>('[data-advertise-form]')
    if (advertiseForm && advertiseForm.dataset.actionBound !== 'true') {
      advertiseForm.dataset.actionBound = 'true'
      const updateQuote = (): void => {
        const selected = advertiseForm.querySelector<HTMLInputElement>('input[name="plan_code"]:checked')
        const daysInput = advertiseForm.querySelector<HTMLInputElement>('[data-ad-days]')
        const quote = advertiseForm.querySelector<HTMLElement>('[data-ad-quote]')
        if (!selected || !daysInput || !quote) return
        const minimum = Number(selected.dataset.minDays ?? 1)
        const maximum = Number(selected.dataset.maxDays ?? 365)
        daysInput.min = String(minimum)
        daysInput.max = String(maximum)
        const current = Number(daysInput.value)
        if (!Number.isInteger(current) || current < minimum || current > maximum) {
          daysInput.value = String(minimum)
        }
        const plan = this.appAdPlans.find((entry) => entry.code === selected.value)
        quote.textContent = plan
          ? formatCurrency(plan.price_per_day * Number(daysInput.value), plan.currency)
          : '—'
      }
      const syncGameField = (): void => {
        const category = advertiseForm.querySelector<HTMLSelectElement>('[data-ad-category]')
        const field = advertiseForm.querySelector<HTMLElement>('[data-ad-game-field]')
        const game = advertiseForm.elements.namedItem('game_slug')
        const newGameFields = advertiseForm.querySelector<HTMLElement>('[data-ad-new-game]')
        const isGame = category?.value === 'game'
        const requestsNewGame = isGame
          && game instanceof HTMLSelectElement
          && game.value === '__request__'
        if (field) field.hidden = !isGame
        if (game instanceof HTMLSelectElement) {
          game.disabled = !isGame
          game.required = isGame
        }
        if (newGameFields) newGameFields.hidden = !requestsNewGame
        for (const name of ['catalog_game_name', 'catalog_launch_url', 'catalog_icon_url']) {
          const input = advertiseForm.elements.namedItem(name)
          if (input instanceof HTMLInputElement) {
            input.disabled = !requestsNewGame
            input.required = requestsNewGame
          }
        }
      }
      advertiseForm.querySelectorAll<HTMLInputElement>('[data-ad-plan]')
        .forEach((input) => input.addEventListener('change', updateQuote))
      advertiseForm.querySelector<HTMLInputElement>('[data-ad-days]')
        ?.addEventListener('input', updateQuote)
      advertiseForm.querySelector<HTMLSelectElement>('[data-ad-category]')
        ?.addEventListener('change', syncGameField)
      const gameSelect = advertiseForm.elements.namedItem('game_slug')
      if (gameSelect instanceof HTMLSelectElement) {
        gameSelect.addEventListener('change', syncGameField)
      }
      syncGameField()
      advertiseForm.addEventListener('submit', (event) => {
        event.preventDefault()
        void this.submitAppAdRequest(advertiseForm)
      })
    }

    const chooseExtension = this.root.querySelector<HTMLButtonElement>('[data-choose-extension]')
    if (chooseExtension) this.bindButtonOnce(chooseExtension, () => { void this.chooseAccountExtension() })

    const extensionEnabled = this.root.querySelector<HTMLInputElement>('[data-extension-enabled]')
    if (extensionEnabled && extensionEnabled.dataset.actionBound !== 'true') {
      extensionEnabled.dataset.actionBound = 'true'
      extensionEnabled.addEventListener('change', () => {
        void this.setAccountExtensionEnabled(extensionEnabled.checked)
      })
    }

    const removeExtension = this.root.querySelector<HTMLButtonElement>('[data-remove-extension]')
    if (removeExtension) {
      this.bindButtonOnce(removeExtension, () => {
        if (window.confirm('Remover a extensão desta conta?')) void this.removeAccountExtension()
      })
    }

    const gridWorkspaceForm = this.root.querySelector<HTMLFormElement>(
      '#grid-workspace-form',
    )
    if (gridWorkspaceForm && gridWorkspaceForm.dataset.actionBound !== 'true') {
      gridWorkspaceForm.dataset.actionBound = 'true'
      const accountChecks = () => [...gridWorkspaceForm.querySelectorAll<HTMLInputElement>(
        'input[name="accountIds"]',
      )]

      gridWorkspaceForm
        .querySelectorAll<HTMLButtonElement>('[data-grid-select]')
        .forEach((button) => {
          this.bindButtonOnce(button, () => {
            const action = button.dataset.gridSelect
            const openIds = new Set(this.getActiveAccounts().map((account) => account.id))
            accountChecks().forEach((input) => {
              input.checked = action === 'all'
                || (action === 'open' && openIds.has(input.value))
            })
          })
        })

      gridWorkspaceForm
        .querySelectorAll<HTMLButtonElement>('[data-grid-select-game]')
        .forEach((button) => {
          this.bindButtonOnce(button, () => {
            const gameSlug = button.dataset.gridSelectGame
            const accountIds = new Set(this.configuredAccounts
              .filter((account) => account.gameSlug === gameSlug)
              .map((account) => account.id))
            accountChecks().forEach((input) => { input.checked = accountIds.has(input.value) })
          })
        })

      gridWorkspaceForm.addEventListener('submit', (event) => {
        event.preventDefault()
        const userId = this.session?.user.id
        if (!userId) return
        const name = this.valueOf(gridWorkspaceForm, 'name').trim()
        const accountIds = accountChecks().filter((input) => input.checked).map((input) => input.value)
        if (!name) {
          this.showSessionAlert('Digite um nome para a grade.')
          return
        }
        if (accountIds.length === 0) {
          this.showSessionAlert('Selecione pelo menos uma conta para esta grade.')
          return
        }
        const saved = this.gridWorkspaceService.save(userId, {
          accountIds,
          id: this.dialogGridWorkspaceId,
          name,
        })
        if (!saved) {
          this.showSessionAlert('Não foi possível salvar esta grade.')
          return
        }
        this.savedGridWorkspaces = this.gridWorkspaceService.list(
          userId,
          this.configuredAccounts.map((account) => account.id),
        )
        this.workspaceMode = 'grid'
        this.selectGridWorkspace(saved.id)
        this.closeDialog()
      })
    }

    const createGameGrids = this.root.querySelector<HTMLButtonElement>(
      '[data-create-game-grids]',
    )
    if (createGameGrids) {
      this.bindButtonOnce(createGameGrids, () => {
        const userId = this.session?.user.id
        if (!userId || this.configuredAccounts.length === 0) return
        const grids = this.gridWorkspaceService.createForGames(
          userId,
          this.configuredAccounts,
          (account) => this.gameNameFor(account),
        )
        this.savedGridWorkspaces = this.gridWorkspaceService.list(
          userId,
          this.configuredAccounts.map((account) => account.id),
        )
        this.workspaceMode = 'grid'
        this.selectGridWorkspace(grids[0]?.id ?? null)
        this.closeDialog()
        this.showSessionAlert(`${grids.length} ${grids.length === 1 ? 'grade criada' : 'grades criadas'} por jogo.`)
      })
    }

    const deleteGridWorkspace = this.root.querySelector<HTMLButtonElement>(
      '[data-delete-grid-workspace]',
    )
    if (deleteGridWorkspace) {
      this.bindButtonOnce(deleteGridWorkspace, () => {
        const userId = this.session?.user.id
        const gridId = this.dialogGridWorkspaceId
        if (!userId || !gridId || !window.confirm('Excluir esta grade? As contas continuarão salvas e abertas.')) return
        this.gridWorkspaceService.remove(userId, gridId)
        if (this.selectedGridWorkspaceId === gridId) this.selectGridWorkspace(null)
        this.savedGridWorkspaces = this.gridWorkspaceService.list(
          userId,
          this.configuredAccounts.map((account) => account.id),
        )
        this.closeDialog()
      })
    }

    const showPlansButton =
      this.root.querySelector<HTMLButtonElement>('[data-show-plans]')
    if (showPlansButton) {
      this.bindButtonOnce(showPlansButton, () => {
        this.activeDialog = 'plans'
        this.dialogError = null
        this.render()
      })
    }

    const gameSearch = this.root.querySelector<HTMLInputElement>('[data-game-search]')
    if (gameSearch && gameSearch.dataset.actionBound !== 'true') {
      gameSearch.dataset.actionBound = 'true'
      gameSearch.addEventListener('input', () => {
        const query = gameSearch.value.trim().toLocaleLowerCase()
        this.root.querySelectorAll<HTMLElement>('[data-game-search-item]')
          .forEach((item) => {
            item.toggleAttribute(
              'hidden',
              Boolean(query) && !(item.dataset.gameSearchItem ?? '').includes(query),
            )
          })
      })
    }

    this.root
      .querySelectorAll<HTMLButtonElement>('#app-dialog [data-select-game]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const gameSlug = button.dataset.selectGame
          this.activeDialog = 'add-account'
          this.dialogError = null
          this.render()
          queueMicrotask(() => {
            const form = this.root.querySelector<HTMLFormElement>('#add-account-form')
            const choice = [...(form?.querySelectorAll<HTMLInputElement>('input[name="gameSlug"]') ?? [])]
              .find((input) => input.value === gameSlug)
            if (form && choice) {
              choice.checked = true
              this.syncGamePicker(form)
              form.elements.namedItem('displayName') instanceof HTMLInputElement
                && (form.elements.namedItem('displayName') as HTMLInputElement).focus()
            }
          })
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-settings-tab]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const selected = button.dataset.settingsTab
          this.root.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')
            .forEach((candidate) => candidate.classList.toggle(
              'is-active',
              candidate.dataset.settingsTab === selected,
            ))
          this.root.querySelectorAll<HTMLElement>('[data-settings-panel]')
            .forEach((panel) => panel.toggleAttribute(
              'hidden',
              panel.dataset.settingsPanel !== selected,
            ))
        })
      })

    this.root
      .querySelectorAll<HTMLInputElement>('[data-preference]')
      .forEach((input) => {
        if (input.dataset.actionBound === 'true') {
          return
        }
        input.dataset.actionBound = 'true'
        input.addEventListener('change', () => {
          const key = input.dataset.preference
          if (key === 'eco-mode') {
            void this.updateEcoModePreference(input.checked, input)
            return
          }
          if (key) {
            localStorage.setItem(`altgrid.preference.${key}`, String(input.checked))
          }
        })
      })

    const ecoBackgroundFps = this.root.querySelector<HTMLSelectElement>(
      '[data-eco-background-fps]',
    )
    if (ecoBackgroundFps && ecoBackgroundFps.dataset.actionBound !== 'true') {
      ecoBackgroundFps.dataset.actionBound = 'true'
      ecoBackgroundFps.addEventListener('change', () => {
        const fps = Number(ecoBackgroundFps.value)
        if (fps === 10 || fps === 20 || fps === 30) {
          void this.updateEcoBackgroundFpsPreference(fps, ecoBackgroundFps)
        }
      })
    }

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-toggle-eco-mode]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          void this.updateEcoModePreference(!this.ecoModeRequested, button)
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-open-rmt]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          void Promise.resolve(this.openExternalUrl(RMT_DISCORD_URL)).catch((error) => {
            this.showSessionAlert(error instanceof Error ? error.message : 'Não foi possível abrir o Discord.')
          })
        })
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-buy-product]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const productCode = button.dataset.buyProduct
          if (productCode) {
            void this.createPixPayment(productCode, button)
          }
        })
      })

    const refreshPayment = this.root.querySelector<HTMLButtonElement>(
      '[data-refresh-payment]',
    )
    if (refreshPayment) {
      this.bindButtonOnce(refreshPayment, () => {
        void this.refreshPixPayment(refreshPayment)
      })
    }

    const copyPix = this.root.querySelector<HTMLButtonElement>('[data-copy-pix]')
    if (copyPix) {
      this.bindButtonOnce(copyPix, () => {
        const code = this.root.querySelector<HTMLTextAreaElement>('[data-pix-code]')?.value
        if (!code) {
          return
        }
        void navigator.clipboard.writeText(code)
          .then(() => {
            copyPix.textContent = 'Código copiado'
          })
          .catch(() => this.showSessionAlert('Não foi possível copiar o código PIX.'))
      })

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-pay-app-ad]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const requestId = button.dataset.payAppAd
          if (requestId) void this.createAppAdPixPayment(requestId, button)
        })
      })
    }

    const copyReferral = this.root.querySelector<HTMLButtonElement>(
      '[data-copy-referral]',
    )
    if (copyReferral) {
      this.bindButtonOnce(copyReferral, () => {
        const url = this.root.querySelector<HTMLInputElement>('[data-referral-url]')?.value
        if (!url) return
        void navigator.clipboard.writeText(url)
          .then(() => { copyReferral.textContent = 'Link copiado' })
          .catch(() => this.showSessionAlert('Não foi possível copiar o link.'))
      })
    }

    const shareReferral = this.root.querySelector<HTMLButtonElement>(
      '[data-share-referral]',
    )
    if (shareReferral) {
      this.bindButtonOnce(shareReferral, () => {
        const url = this.referralProgram?.share_url
        if (!url) return
        const text = `Entre no AltGrid pelo meu convite ${this.referralProgram?.code} e conheça o gerenciador multissessão.`
        if (navigator.share) {
          void navigator.share({ title: 'Convite AltGrid', text, url })
            .catch(() => undefined)
          return
        }
        void navigator.clipboard.writeText(`${text}\n${url}`)
          .then(() => { shareReferral.textContent = 'Convite copiado' })
          .catch(() => this.showSessionAlert('Não foi possível compartilhar o convite.'))
      })
    }

    const refreshReferrals = this.root.querySelector<HTMLButtonElement>(
      '[data-refresh-referrals]',
    )
    if (refreshReferrals) {
      this.bindButtonOnce(refreshReferrals, () => {
        void this.loadReferralProgram(true)
      })
    }

    const refreshResourceUsage = this.root.querySelector<HTMLButtonElement>(
      '[data-refresh-resource-usage]',
    )
    if (refreshResourceUsage) {
      this.bindButtonOnce(refreshResourceUsage, () => {
        void this.refreshResourceUsage()
      })
    }

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-check-update]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          this.activeDialog = 'update'
          void this.checkForUpdates(true)
        })
      })

    const downloadUpdate = this.root.querySelector<HTMLButtonElement>(
      '[data-download-update]',
    )
    if (downloadUpdate) {
      this.bindButtonOnce(downloadUpdate, () => {
        if (!this.updater) {
          return
        }
        downloadUpdate.disabled = true
        void this.updater.downloadUpdate()
          .then((state) => this.applyUpdateState(state))
          .catch(() => this.applyUpdateState({
            message: 'Não foi possível baixar a atualização.',
            status: 'error',
            supported: true,
          }))
      })
    }

    const installUpdate = this.root.querySelector<HTMLButtonElement>(
      '[data-install-update]',
    )
    if (installUpdate) {
      this.bindButtonOnce(installUpdate, () => {
        if (!this.updater) {
          return
        }
        const active = this.permissionService.getActiveSessionCount()
        if (
          active > 0
          && !window.confirm(
            `${active} ${active === 1 ? 'sessão será encerrada' : 'sessões serão encerradas'} para instalar agora. Continuar?`,
          )
        ) {
          return
        }
        installUpdate.disabled = true
        void this.updater.quitAndInstall()
          .then((started) => {
            if (!started) {
              this.applyUpdateState({
                message: 'Não foi possível iniciar a instalação.',
                status: 'error',
                supported: true,
              })
            }
          })
          .catch(() => this.applyUpdateState({
            message: 'Não foi possível iniciar a instalação.',
            status: 'error',
            supported: true,
          }))
      })
    }

    const addAccountForm =
      this.root.querySelector<HTMLFormElement>('#add-account-form')

    if (addAccountForm && addAccountForm.dataset.actionBound !== 'true') {
      addAccountForm.dataset.actionBound = 'true'
      addAccountForm
        .querySelectorAll<HTMLInputElement>('input[name="gameSlug"]')
        .forEach((input) => {
          input.addEventListener('change', () => {
            this.dialogError = null
            this.syncGamePicker(addAccountForm)
          })
        })
      this.syncGamePicker(addAccountForm)
      addAccountForm.addEventListener('submit', (event) => {
      event.preventDefault()

      if (!this.session) {
        return
      }

      const displayName = this.valueOf(addAccountForm, 'displayName').trim()
      const gameSlug = this.valueOf(addAccountForm, 'gameSlug')
      const customLaunchUrl = this.valueOf(
        addAccountForm,
        'customLaunchUrl',
      )

      if (!displayName) {
        this.dialogError = 'Digite um nome para a conta.'
        this.render()
        return
      }

      if (gameSlug === CUSTOM_GAME_SLUG) {
        const validation = validateSafeGameUrl(customLaunchUrl)

        if (!validation.ok) {
          this.dialogError = validation.message
          this.render()
          return
        }

        const account = this.accountService.add(this.session.user.id, {
          customLaunchUrl: validation.url,
          displayName,
          gameSlug: CUSTOM_GAME_SLUG,
        })
        this.completeAddedAccount(account)
        return
      }

      const game = this.games.find((candidate) => candidate.slug === gameSlug)

      if (!game || !normalizeSafeGameUrl(game.launch_url)) {
        this.dialogError = 'Selecione um jogo disponível.'
        this.render()
        return
      }

      const account = this.accountService.add(this.session.user.id, {
        displayName,
        gameSlug,
      })
      this.completeAddedAccount(account)
      })
    }

    const renameAccountForm =
      this.root.querySelector<HTMLFormElement>('#rename-account-form')

    if (renameAccountForm && renameAccountForm.dataset.actionBound !== 'true') {
      renameAccountForm.dataset.actionBound = 'true'
      renameAccountForm.addEventListener('submit', (event) => {
      event.preventDefault()

      if (!this.session || !this.dialogAccountId) {
        return
      }

      const displayName = this.valueOf(renameAccountForm, 'displayName').trim()

      if (!displayName) {
        this.dialogError = 'Digite um nome para a conta.'
        this.render()
        return
      }

      const renamed = this.accountService.rename(
        this.session.user.id,
        this.dialogAccountId,
        displayName,
      )

      if (!renamed) {
        this.dialogError = 'Não foi possível renomear esta conta.'
        this.render()
        return
      }

      this.configuredAccounts = this.accountService.list(this.session.user.id)
      this.closeDialog()
      })
    }

    const proxyForm = this.root.querySelector<HTMLFormElement>('#proxy-form')
    if (proxyForm && proxyForm.dataset.actionBound !== 'true') {
      proxyForm.dataset.actionBound = 'true'
      proxyForm.addEventListener('submit', (event) => {
        event.preventDefault()
        void this.saveProxyConfiguration(proxyForm)
      })
    }

    const copyProxyForm = this.root.querySelector<HTMLFormElement>('#copy-proxy-form')
    if (copyProxyForm && copyProxyForm.dataset.actionBound !== 'true') {
      copyProxyForm.dataset.actionBound = 'true'
      copyProxyForm.addEventListener('submit', (event) => {
        event.preventDefault()
        void this.copyProxyToAccount(copyProxyForm)
      })
    }

    const testProxyButton = this.root.querySelector<HTMLButtonElement>('[data-test-proxy]')
    if (testProxyButton) {
      this.bindButtonOnce(testProxyButton, () => {
        void this.testProxyConfiguration(testProxyButton)
      })
    }

    const removeProxyButton = this.root.querySelector<HTMLButtonElement>('[data-remove-proxy]')
    if (removeProxyButton) {
      this.bindButtonOnce(removeProxyButton, () => {
        void this.removeProxyConfiguration(removeProxyButton)
      })
    }

    const deleteButton = this.root.querySelector<HTMLButtonElement>(
      '[data-confirm-delete-account]',
    )
    if (deleteButton) {
      this.bindButtonOnce(deleteButton, () => {
        void this.deleteConfiguredAccount(deleteButton)
      })
    }

    const dialog = this.root.querySelector<HTMLDialogElement>('#app-dialog')

    if (dialog && dialog.dataset.cancelBound !== 'true') {
      dialog.dataset.cancelBound = 'true'
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault()
        this.closeDialog()
      })
    }

    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) {
      dialog.showModal()
      if (dialog.matches('.modal--plans, .modal--plan-summary')) {
        dialog.focus({ preventScroll: true })
        dialog.scrollTop = 0
      }
    }
  }

  private async deleteConfiguredAccount(button: HTMLButtonElement): Promise<void> {
    if (!this.session || !this.dialogAccountId) {
      return
    }

    const userId = this.session.user.id
    const accountId = this.dialogAccountId
    const account = this.configuredAccounts.find((item) => item.id === accountId)

    if (!account) {
      return
    }

    button.disabled = true
    button.textContent = 'Excluindo…'

    try {
      await this.sessionOpeningInFlight.get(accountId)

      if (this.destroyed || this.session?.user.id !== userId) {
        return
      }

      if (this.permissionService.isSessionActive(accountId)) {
        await this.permissionService.closeSession(
          accountId,
          () => this.sessionLauncher.close(account),
        )
      }

      if (this.destroyed || this.session?.user.id !== userId) {
        return
      }

      this.accountService.remove(userId, accountId)
      await Promise.resolve(this.sessionLauncher.removeProxy?.(account)).catch(() => undefined)
      await Promise.resolve(this.sessionLauncher.removeExtension?.(account)).catch(() => undefined)
      this.configuredAccounts = this.accountService.list(userId)
      this.loadSavedGridWorkspaces(userId)
      this.sessionFrameRates.delete(accountId)
      this.storeSessionFrameRatePreferences()
      this.sessionInterfaceScales.delete(accountId)
      this.storeSessionInterfaceScalePreferences()
      this.mutedAccountIds.delete(accountId)
      this.sessionIssues.delete(accountId)
      this.backgroundAccountIds.delete(accountId)
      this.accountProxyStates.delete(accountId)
      this.proxyStateLoadingAccountIds.delete(accountId)
      this.accountExtensionStates.delete(accountId)
      this.extensionStateLoadingAccountIds.delete(accountId)
      this.maximizedAccountId = this.maximizedAccountId === accountId
        ? null
        : this.maximizedAccountId
      this.closeDialog()
    } catch {
      if (this.destroyed || this.session?.user.id !== userId) {
        return
      }

      this.dialogError = 'Não foi possível excluir esta configuração.'
      this.render()
    }
  }

  private async openCopyProxyDialog(source: ConfiguredAccount): Promise<void> {
    if (!this.proxyControlAvailable() || !this.sessionLauncher.getProxy || !this.sessionLauncher.copyProxy) {
      this.showSessionAlert('A cópia de proxy por conta está disponível no plano Founder para computador.')
      return
    }
    if (!this.configuredAccounts.some((account) => account.id !== source.id)) {
      this.showSessionAlert('Adicione outra conta para receber este proxy.')
      return
    }

    this.dialogAccountId = source.id
    this.dialogReturnFocus = { accountId: source.id, type: 'account' }
    this.activeDialog = 'copy-proxy'
    this.dialogError = null
    this.proxyConfig = null
    this.proxyLoading = true
    this.render()

    try {
      this.proxyConfig = await this.sessionLauncher.getProxy(source)
      this.accountProxyStates.set(source.id, this.proxyConfig)
      if (!this.proxyConfig) {
        this.dialogError = `Configure um proxy em ${source.displayName} antes de copiá-lo.`
      }
    } catch (error) {
      this.dialogError = error instanceof Error
        ? error.message
        : 'Não foi possível ler o proxy da conta de origem.'
    } finally {
      this.proxyLoading = false
      if (this.activeDialog === 'copy-proxy' && this.dialogAccountId === source.id) {
        this.render()
      }
    }
  }

  private async copyProxyToAccount(form: HTMLFormElement): Promise<void> {
    const source = this.configuredAccounts.find(
      (account) => account.id === this.dialogAccountId,
    )
    const targetId = this.valueOf(form, 'targetAccountId')
    const target = this.configuredAccounts.find(
      (account) => account.id === targetId && account.id !== source?.id,
    )
    if (!source || !target || !this.sessionLauncher.copyProxy || this.proxySaving) {
      this.dialogError = 'Escolha uma conta de destino válida.'
      this.render()
      return
    }

    this.proxySaving = true
    this.dialogError = null
    this.render()
    try {
      const copied = await this.sessionLauncher.copyProxy(source, target)
      if (!copied) {
        throw new Error(`Configure um proxy em ${source.displayName} antes de copiá-lo.`)
      }
      this.accountProxyStates.set(target.id, copied)
      this.closeDialog()
      this.showSessionAlert(`Proxy de ${source.displayName} copiado e aplicado em ${target.displayName}.`)
    } catch (error) {
      this.dialogError = error instanceof Error
        ? error.message
        : 'Não foi possível copiar o proxy para esta conta.'
      this.proxySaving = false
      this.render()
    }
  }

  private extensionControlAvailable(): boolean {
    return !this.mobileSessionMode
      && this.permissionService.getCurrentPlan() !== 'FREE'
      && typeof this.sessionLauncher.getExtension === 'function'
      && typeof this.sessionLauncher.chooseExtension === 'function'
  }

  private extensionAccountLimit(): number {
    return extensionAccountLimitForPlan(this.permissionService.getCurrentPlan())
  }

  private configuredExtensionAccountIds(): string[] {
    return this.configuredAccounts
      .filter((account) => this.accountExtensionStates.get(account.id) != null)
      .map((account) => account.id)
  }

  private configuredExtensionCount(): number {
    return this.configuredExtensionAccountIds().length
  }

  private canAssignAccountExtension(accountId: string): boolean {
    if (this.accountExtensionStates.get(accountId) != null) {
      return this.isAccountExtensionWithinLimit(accountId)
    }
    return this.configuredExtensionCount() < this.extensionAccountLimit()
  }

  private isAccountExtensionWithinLimit(accountId: string): boolean {
    if (this.accountExtensionStates.get(accountId) == null) return false
    const limit = this.extensionAccountLimit()
    if (limit === UNLIMITED_ACCOUNT_LIMIT) return true
    const index = this.configuredExtensionAccountIds().indexOf(accountId)
    return index >= 0 && index < limit
  }

  private extensionLimitMessage(): string {
    const plan = this.permissionService.getCurrentPlan()
    const limit = this.extensionAccountLimit()
    return `O plano ${PLAN_PRESENTATION[plan].displayName} permite extensão em até ${limit} contas. Remova a extensão de outra conta ou escolha um plano com mais vagas.`
  }

  private async ensureAccountExtensionStates(): Promise<void> {
    if (this.extensionStatesReady) return
    await this.refreshAccountExtensionStates()
  }

  private async refreshAccountExtensionStates(): Promise<void> {
    if (!this.extensionControlAvailable() || !this.sessionLauncher.getExtension) {
      this.accountExtensionStates.clear()
      this.extensionStatesReady = true
      return
    }
    if (this.extensionStateRefreshInFlight) {
      await this.extensionStateRefreshInFlight
      return
    }
    const userId = this.session?.user.id
    if (!userId) return
    const accounts = [...this.configuredAccounts]
    accounts.forEach((account) => this.extensionStateLoadingAccountIds.add(account.id))
    const request = (async (): Promise<void> => {
      const states = await Promise.all(accounts.map(async (account) => {
        try {
          return [account.id, await this.sessionLauncher.getExtension!(account)] as const
        } catch {
          return [account.id, null] as const
        }
      }))
      if (this.destroyed || this.session?.user.id !== userId) return
      for (const [accountId, state] of states) {
        this.extensionStateLoadingAccountIds.delete(accountId)
        this.accountExtensionStates.set(accountId, state)
      }
      this.extensionStatesReady = true
      if (this.currentView === 'authenticated') this.render()
    })()
    this.extensionStateRefreshInFlight = request
    try {
      await request
    } finally {
      if (this.extensionStateRefreshInFlight === request) {
        this.extensionStateRefreshInFlight = null
      }
    }
  }

  private async openExtensionDialog(account: ConfiguredAccount): Promise<void> {
    if (!this.extensionControlAvailable() || !this.sessionLauncher.getExtension) {
      this.showSessionAlert('Extensões por conta estão disponíveis nos planos pagos do aplicativo para computador.')
      return
    }
    this.dialogAccountId = account.id
    this.dialogReturnFocus = { accountId: account.id, type: 'account' }
    this.activeDialog = 'extension'
    this.dialogError = null
    this.extensionConfig = null
    this.extensionLoading = true
    this.render()
    try {
      await this.ensureAccountExtensionStates()
      this.extensionConfig = await this.sessionLauncher.getExtension(account)
      this.accountExtensionStates.set(account.id, this.extensionConfig)
    } catch (error) {
      this.dialogError = error instanceof Error ? error.message : 'Não foi possível verificar a extensão.'
    } finally {
      this.extensionLoading = false
      if (this.activeDialog === 'extension' && this.dialogAccountId === account.id) this.render()
    }
  }

  private async chooseAccountExtension(): Promise<void> {
    const account = this.configuredAccounts.find((candidate) => candidate.id === this.dialogAccountId)
    if (!account || !this.sessionLauncher.chooseExtension || this.extensionSaving) return
    await this.ensureAccountExtensionStates()
    if (!this.canAssignAccountExtension(account.id)) {
      this.dialogError = this.extensionLimitMessage()
      this.render()
      return
    }
    this.extensionSaving = true
    this.dialogError = null
    this.render()
    try {
      const selected = await this.sessionLauncher.chooseExtension(account)
      if (selected) {
        this.extensionConfig = selected
        this.accountExtensionStates.set(account.id, selected)
        this.showSessionAlert(`${selected.name} foi aplicada somente em ${account.displayName}.`)
      }
    } catch (error) {
      this.dialogError = error instanceof Error
        ? error.message
        : 'A extensão não é compatível com o AltGrid.'
    } finally {
      this.extensionSaving = false
      if (this.activeDialog === 'extension') this.render()
    }
  }

  private async setAccountExtensionEnabled(enabled: boolean): Promise<void> {
    const account = this.configuredAccounts.find((candidate) => candidate.id === this.dialogAccountId)
    if (!account || !this.sessionLauncher.setExtensionEnabled || this.extensionSaving) return
    await this.ensureAccountExtensionStates()
    if (enabled && !this.isAccountExtensionWithinLimit(account.id)) {
      this.dialogError = this.extensionLimitMessage()
      this.render()
      return
    }
    this.extensionSaving = true
    try {
      const updated = await this.sessionLauncher.setExtensionEnabled(account, enabled)
      this.extensionConfig = updated
      this.accountExtensionStates.set(account.id, updated)
      this.showSessionAlert(`${updated.name} ${enabled ? 'ativada' : 'desativada'} em ${account.displayName}.`)
    } catch (error) {
      this.dialogError = error instanceof Error ? error.message : 'Não foi possível alterar a extensão.'
    } finally {
      this.extensionSaving = false
      if (this.activeDialog === 'extension') this.render()
    }
  }

  private async removeAccountExtension(): Promise<void> {
    const account = this.configuredAccounts.find((candidate) => candidate.id === this.dialogAccountId)
    if (!account || !this.sessionLauncher.removeExtension || this.extensionSaving) return
    this.extensionSaving = true
    try {
      await this.sessionLauncher.removeExtension(account)
      this.extensionConfig = null
      this.accountExtensionStates.set(account.id, null)
      this.showSessionAlert(`Extensão removida de ${account.displayName}.`)
    } catch (error) {
      this.dialogError = error instanceof Error ? error.message : 'Não foi possível remover a extensão.'
    } finally {
      this.extensionSaving = false
      if (this.activeDialog === 'extension') this.render()
    }
  }

  private proxyControlAvailable(): boolean {
    return !this.mobileSessionMode
      && typeof this.sessionLauncher.getProxy === 'function'
      && typeof this.sessionLauncher.setProxy === 'function'
      && this.permissionService.canUseFeature('account_proxy')
  }

  private async refreshAccountProxyStates(): Promise<void> {
    if (!this.proxyControlAvailable() || !this.sessionLauncher.getProxy) {
      this.accountProxyStates.clear()
      return
    }

    const userId = this.session?.user.id
    if (!userId) return
    const accounts = [...this.configuredAccounts]
    accounts.forEach((account) => this.proxyStateLoadingAccountIds.add(account.id))

    const states = await Promise.all(accounts.map(async (account) => {
      try {
        return [account.id, await this.sessionLauncher.getProxy!(account)] as const
      } catch {
        return [account.id, null] as const
      }
    }))

    if (this.destroyed || this.session?.user.id !== userId) return
    for (const [accountId, state] of states) {
      this.proxyStateLoadingAccountIds.delete(accountId)
      this.accountProxyStates.set(accountId, state)
    }
    if (this.currentView === 'authenticated') {
      this.render()
    }
  }

  private async toggleAccountProxy(
    account: ConfiguredAccount,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (!this.proxyControlAvailable() || !this.sessionLauncher.setProxy) {
      this.showSessionAlert('O proxy por conta é exclusivo do Founder no aplicativo para computador.')
      return
    }

    let state = this.accountProxyStates.get(account.id)
    if (state === undefined && this.sessionLauncher.getProxy) {
      button.disabled = true
      this.proxyStateLoadingAccountIds.add(account.id)
      try {
        state = await this.sessionLauncher.getProxy(account)
        this.accountProxyStates.set(account.id, state)
      } finally {
        this.proxyStateLoadingAccountIds.delete(account.id)
      }
    }

    if (!state) {
      button.disabled = false
      await this.openProxyDialog(account)
      return
    }

    button.disabled = true
    try {
      const updated = await this.sessionLauncher.setProxy(account, {
        enabled: !state.enabled,
        host: state.host,
        port: state.port,
        preservePassword: state.hasPassword,
        protocol: state.protocol,
        username: state.username,
      })
      this.accountProxyStates.set(account.id, updated)
      this.render()
      this.showSessionAlert(updated.enabled
        ? `Proxy ativado em ${account.displayName}. A tela está reconectando pela rota salva.`
        : `Proxy desativado em ${account.displayName}. A tela está voltando à conexão direta.`)
    } catch (error) {
      this.showSessionAlert(error instanceof Error
        ? error.message
        : 'Não foi possível alterar o proxy desta conta.')
    } finally {
      if (button.isConnected) button.disabled = false
    }
  }

  private async openProxyDialog(account: ConfiguredAccount): Promise<void> {
    if (!this.proxyControlAvailable() || !this.sessionLauncher.getProxy) {
      this.showSessionAlert('O proxy por conta é exclusivo do Founder no aplicativo para computador.')
      return
    }

    this.dialogAccountId = account.id
    this.dialogReturnFocus = { accountId: account.id, type: 'account' }
    this.activeDialog = 'proxy'
    this.dialogError = null
    this.proxyConfig = null
    this.proxyTestResult = null
    this.proxyLoading = true
    this.render()

    try {
      this.proxyConfig = await this.sessionLauncher.getProxy(account)
      this.accountProxyStates.set(account.id, this.proxyConfig)
    } catch (error) {
      this.dialogError = error instanceof Error
        ? error.message
        : 'Não foi possível abrir o cofre de proxies.'
    } finally {
      this.proxyLoading = false
      if (this.activeDialog === 'proxy' && this.dialogAccountId === account.id) {
        this.render()
      }
    }
  }

  private async saveProxyConfiguration(
    form: HTMLFormElement,
    validateAfterSave = false,
  ): Promise<void> {
    const account = this.configuredAccounts.find(
      (candidate) => candidate.id === this.dialogAccountId,
    )
    if (!account || !this.sessionLauncher.setProxy || this.proxySaving) return

    const compact = this.valueOf(form, 'compact')
    let protocol = this.valueOf(form, 'protocol') as SessionProxyInput['protocol']
    let host = this.valueOf(form, 'host')
    let port = Number(this.valueOf(form, 'port'))
    let username = this.valueOf(form, 'username')
    let password = this.valueOf(form, 'password')
    if (compact) {
      try {
        const parsed = parseProxyLine(compact, protocol)
        protocol = parsed.protocol
        host = parsed.host
        port = parsed.port
        username = parsed.username
        password = parsed.password
      } catch (error) {
        this.dialogError = error instanceof Error ? error.message : 'Linha de proxy inválida.'
        this.render()
        return
      }
    }
    const enabled = form.elements.namedItem('enabled') instanceof HTMLInputElement
      && (form.elements.namedItem('enabled') as HTMLInputElement).checked

    if (validateAfterSave && !enabled) {
      this.dialogError = 'Ative “Usar proxy nesta conta” antes de validar a rota.'
      this.proxyTestResult = null
      this.render()
      return
    }

    this.proxySaving = true
    this.dialogError = null
    this.proxyTestResult = null
    try {
      this.proxyConfig = await this.sessionLauncher.setProxy(account, {
        enabled,
        host,
        password: password || undefined,
        port,
        preservePassword: Boolean(this.proxyConfig?.hasPassword && !password),
        protocol,
        username,
      })
      this.accountProxyStates.set(account.id, this.proxyConfig)
      this.proxyTestResult = validateAfterSave && enabled && this.sessionLauncher.testProxy
        ? await this.sessionLauncher.testProxy(account)
        : {
            latencyMs: 0,
            message: enabled ? 'Proxy salvo e aplicado.' : 'Proxy salvo, mas desativado.',
            ok: true,
            route: enabled ? `${protocol.toUpperCase()} ${this.proxyConfig.host}:${this.proxyConfig.port}` : 'DIRECT',
          }
    } catch (error) {
      this.dialogError = error instanceof Error ? error.message : 'Não foi possível salvar o proxy.'
    } finally {
      this.proxySaving = false
      this.render()
    }
  }

  private async testProxyConfiguration(button: HTMLButtonElement): Promise<void> {
    const form = this.root.querySelector<HTMLFormElement>('#proxy-form')
    if (!form || !this.sessionLauncher.testProxy) return
    button.disabled = true
    button.textContent = 'Salvando e validando…'
    await this.saveProxyConfiguration(form, true)
  }

  private async removeProxyConfiguration(button: HTMLButtonElement): Promise<void> {
    const account = this.configuredAccounts.find(
      (candidate) => candidate.id === this.dialogAccountId,
    )
    if (!account || !this.sessionLauncher.removeProxy) return
    button.disabled = true
    this.dialogError = null
    try {
      await this.sessionLauncher.removeProxy(account)
      this.proxyConfig = null
      this.accountProxyStates.set(account.id, null)
      this.proxyTestResult = {
        latencyMs: 0,
        message: 'Proxy removido. A conta voltou para a conexão direta.',
        ok: true,
        route: 'DIRECT',
      }
    } catch (error) {
      this.dialogError = error instanceof Error ? error.message : 'Não foi possível remover o proxy.'
    }
    this.render()
  }

  private async refreshResourceUsage(): Promise<void> {
    if (!this.sessionLauncher.getResourceUsage || this.resourceUsageLoading) return
    this.resourceUsageLoading = true
    this.updateUtilityMetrics()
    try {
      this.resourceUsage = await this.sessionLauncher.getResourceUsage()
      this.dialogError = null
    } catch {
      if (this.activeDialog === 'settings') {
        this.dialogError = 'Não foi possível medir o desempenho das sessões.'
      }
    } finally {
      this.resourceUsageLoading = false
      this.updateUtilityMetrics()
      if (this.activeDialog === 'settings') {
        this.render()
        this.activateSettingsTab('accounts')
      }
    }
  }

  private startResourceMonitoring(): void {
    if (
      this.mobileSessionMode
      || !this.sessionLauncher.getResourceUsage
      || this.resourceUsageTimer !== null
      || this.destroyed
    ) {
      return
    }

    void this.refreshResourceUsage()
    this.resourceUsageTimer = setInterval(() => {
      if (this.currentView === 'authenticated' && !document.hidden) {
        void this.refreshResourceUsage()
      }
    }, RESOURCE_USAGE_REFRESH_INTERVAL_MS)
  }

  private stopResourceMonitoring(): void {
    if (this.resourceUsageTimer !== null) {
      clearInterval(this.resourceUsageTimer)
      this.resourceUsageTimer = null
    }
    this.resourceUsageLoading = false
  }

  private updateUtilityMetrics(): void {
    const utility = this.root.querySelector<HTMLElement>('[data-workspace-utility]')
    if (!utility) return

    const totalPrivateKb = this.resourceUsage.reduce(
      (total, usage) => total + finiteResourceValue(usage.privateKb),
      0,
    )
    const totalCpu = Math.min(999, this.resourceUsage.reduce(
      (total, usage) => total + finiteResourceValue(usage.cpuPercent),
      0,
    ))
    const cpu = utility.querySelector<HTMLElement>('[data-utility-cpu]')
    const memory = utility.querySelector<HTMLElement>('[data-utility-memory]')
    const liveDot = utility.querySelector<HTMLElement>('.utility-live-dot')
    const refresh = utility.querySelector<HTMLButtonElement>('[data-refresh-resource-usage]')

    if (cpu) {
      cpu.textContent = this.resourceUsage.length > 0
        ? `${totalCpu.toFixed(totalCpu >= 100 ? 0 : 1)}%`
        : '—'
    }
    if (memory) {
      memory.textContent = this.resourceUsage.length > 0
        ? formatMemoryKb(totalPrivateKb)
        : '—'
    }
    liveDot?.classList.toggle('is-loading', this.resourceUsageLoading)
    if (refresh) refresh.disabled = this.resourceUsageLoading
  }

  private activateSettingsTab(tabName: string): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.settingsTab === tabName)
    })
    this.root.querySelectorAll<HTMLElement>('[data-settings-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== tabName
    })
  }

  private resolveSessionLaunchTarget(
    account: ConfiguredAccount,
  ): AccountSessionLaunchTarget | null {
    if (account.gameSlug === CUSTOM_GAME_SLUG) {
      const launchUrl = normalizeSafeGameUrl(account.customLaunchUrl)

      return launchUrl
          ? {
            allowExtension: this.isAccountExtensionWithinLimit(account.id),
            allowProxy: this.permissionService.canUseFeature('account_proxy'),
            game: null,
            kind: 'custom',
            launchUrl,
          }
        : null
    }

    const game = this.games.find(
      (candidate) => candidate.slug === account.gameSlug,
    )
    const launchUrl = normalizeSafeGameUrl(game?.launch_url)

    return game && launchUrl
      ? {
          allowExtension: this.isAccountExtensionWithinLimit(account.id),
          allowProxy: this.permissionService.canUseFeature('account_proxy'),
          game,
          kind: 'preset',
          launchUrl,
        }
      : null
  }

  private async openConfiguredAccount(
    accountId: string,
    button: HTMLButtonElement,
  ): Promise<void> {
    const account = this.configuredAccounts.find(
      (candidate) => candidate.id === accountId,
    )

    if (!account) {
      return
    }

    if (this.extensionControlAvailable()) {
      await this.ensureAccountExtensionStates()
    }
    const launchTarget = this.resolveSessionLaunchTarget(account)

    if (
      !launchTarget
      && (this.gamePresetService || account.gameSlug === CUSTOM_GAME_SLUG)
    ) {
      this.showSessionAlert(
        account.gameSlug === CUSTOM_GAME_SLUG
          ? 'A URL personalizada desta conta é inválida.'
          : 'Este jogo não está disponível no catálogo atual.',
      )
      return
    }

    const existingOpening = this.sessionOpeningInFlight.get(accountId)

    if (existingOpening) {
      button.disabled = true
      await existingOpening
      if (button.isConnected) {
        button.disabled = false
      }
      return
    }

    let finishOpening!: (succeeded: boolean) => void
    const openingTracker = new Promise<boolean>((resolve) => {
      finishOpening = resolve
    })
    this.sessionOpeningInFlight.set(accountId, openingTracker)

    const revision = this.backendStateRevision
    const userId = this.session?.user.id ?? null
    let openingSucceeded = true
    button.disabled = true
    button.textContent = 'Abrindo…'

    try {
      const pendingRelease = this.sessionReleaseInFlight.get(account.id)

      if (pendingRelease) {
        await pendingRelease
      }

      if (this.failedSessionReleaseIds.has(account.id)) {
        await Promise.resolve().then(() => this.sessionLauncher.close(account))
        this.failedSessionReleaseIds.delete(account.id)
      }

      if (
        this.destroyed
        || revision !== this.backendStateRevision
        || this.session?.user.id !== userId
      ) {
        return
      }

      const result = await this.permissionService.openSession(
        account.id,
        // A null target is retained only for headless/legacy integrations that
        // construct AuthApp without a backend. The shipped app always supplies
        // a validated remote preset or custom URL here.
        () => this.sessionLauncher.open(account, launchTarget),
        () => this.sessionLauncher.focus(account),
        () => this.sessionLauncher.close(account),
        account.gameSlug,
      )

      if (
        this.destroyed
        || revision !== this.backendStateRevision
        || this.session?.user.id !== userId
      ) {
        return
      }

      if (result === 'limit_reached') {
        this.dialogReturnFocus = { accountId, type: 'account' }
        this.dialogAccountId = accountId
        this.activeDialog = 'free-limit'
      } else if (result === 'opened' || result === 'already_open') {
        this.focusedAccountId = accountId
        let sessionPreferencesApplied = true
        if (this.frameRateControlSupported) {
          await Promise.resolve(
            this.sessionLauncher.setFrameRate(
              account,
              this.sessionFrameRateFor(account.id),
            ),
          ).catch(() => {
            sessionPreferencesApplied = false
          })
        }
        if (this.interfaceScaleControlSupported) {
          await Promise.resolve(
            this.sessionLauncher.setInterfaceScale?.(
              account,
              this.sessionInterfaceScaleFor(account.id),
            ),
          ).catch(() => {
            sessionPreferencesApplied = false
          })
        }
        this.showSessionAlert(sessionPreferencesApplied
          ? ''
          : 'A conta abriu, mas não foi possível aplicar todas as preferências de exibição.')
      }

      this.render()
    } catch (error) {
      if (error instanceof SessionCancellationCleanupError) {
        this.failedSessionReleaseIds.add(accountId)
      }
      openingSucceeded = false
      if (
        this.destroyed
        || revision !== this.backendStateRevision
        || this.session?.user.id !== userId
      ) {
        return
      }

      const message = error instanceof Error && error.message.trim()
        ? error.message
        : 'Não foi possível abrir esta conta.'
      this.render()
      this.showSessionAlert(message)
    } finally {
      finishOpening(openingSucceeded)
      if (this.sessionOpeningInFlight.get(accountId) === openingTracker) {
        this.sessionOpeningInFlight.delete(accountId)
      }
    }
  }

  private async closeConfiguredAccount(
    accountId: string,
    button: HTMLButtonElement,
  ): Promise<void> {
    const account = this.configuredAccounts.find(
      (candidate) => candidate.id === accountId,
    )

    if (!account) {
      return
    }

    const revision = this.backendStateRevision
    const userId = this.session?.user.id ?? null
    button.disabled = true
    button.textContent = 'Encerrando…'

    try {
      await this.permissionService.closeSession(
        account.id,
        () => this.sessionLauncher.close(account),
      )
      this.mutedAccountIds.delete(account.id)
      this.sessionIssues.delete(account.id)
      this.backgroundAccountIds.delete(account.id)

      if (this.focusedAccountId === accountId) {
        this.focusedAccountId = this.getActiveAccounts()[0]?.id ?? null
      }

      if (this.workspaceMode === 'grid' && this.getActiveAccounts().length <= 1) {
        this.workspaceMode = 'account'
        this.gridPageIndex = 0
      }

      if (
        this.destroyed
        || revision !== this.backendStateRevision
        || this.session?.user.id !== userId
      ) {
        return
      }

      this.render()
    } catch {
      if (
        this.destroyed
        || revision !== this.backendStateRevision
        || this.session?.user.id !== userId
      ) {
        return
      }

      const alert = this.root.querySelector<HTMLElement>('#session-alert')

      if (alert) {
        alert.textContent = 'Não foi possível encerrar esta conta.'
        alert.classList.add('is-visible')
      }

      button.disabled = false
      button.textContent = 'Encerrar'
    }
  }


  private async clearConfiguredAccountData(
    account: ConfiguredAccount,
    button: HTMLButtonElement,
  ): Promise<void> {
    const revision = this.backendStateRevision
    const userId = this.session?.user.id ?? null
    button.disabled = true
    button.textContent = 'Limpando…'

    try {
      await this.sessionOpeningInFlight.get(account.id)

      if (this.permissionService.isSessionActive(account.id)) {
        await this.permissionService.closeSession(
          account.id,
          () => this.sessionLauncher.clearData(account),
        )
      } else {
        await Promise.resolve().then(() => this.sessionLauncher.clearData(account))
      }

      this.mutedAccountIds.delete(account.id)
      this.sessionIssues.delete(account.id)
      if (this.focusedAccountId === account.id) {
        this.focusedAccountId = this.getActiveAccounts()[0]?.id ?? null
      }
      if (this.workspaceMode === 'grid' && this.getActiveAccounts().length <= 1) {
        this.workspaceMode = 'account'
        this.gridPageIndex = 0
      }

      if (
        this.destroyed
        || revision !== this.backendStateRevision
        || this.session?.user.id !== userId
      ) {
        return
      }

      this.render()
      this.showSessionAlert('Dados locais da conta removidos.')
    } catch {
      if (
        this.destroyed
        || revision !== this.backendStateRevision
        || this.session?.user.id !== userId
      ) {
        return
      }

      this.showSessionAlert('Não foi possível limpar os dados desta conta.')
      if (button.isConnected) {
        button.disabled = false
        button.textContent = 'Limpar dados'
      }
    }
  }

  private bindLoginForm(): void {
    const form = this.root.querySelector<HTMLFormElement>('#login-form')

    form?.addEventListener('submit', async (event) => {
      event.preventDefault()
      this.clearFormFeedback(form)
      const email = this.valueOf(form, 'email')
      const password = this.valueOf(form, 'password')
      const errors: FieldErrors = {
        email: validateEmail(email),
        password: password ? null : 'Digite sua senha.',
      }

      if (!this.applyFieldErrors(form, errors)) {
        return
      }

      this.setFormBusy(form, true, 'Entrando…')

      try {
        const session = await this.authService.signIn(email, password)
        this.prepareAuthenticatedSession(session)
        this.render()
        void this.loadApplicationData(session)
      } catch (error) {
        this.showFormAlert(form, errorMessage(error))
      } finally {
        this.setFormBusy(form, false)
      }
    })
  }

  private bindGoogleAuthButtons(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-google-auth]')
      .forEach((button) => {
        this.bindButtonOnce(button, async () => {
          button.disabled = true
          const originalLabel = button.innerHTML
          button.innerHTML = '<span class="spinner spinner--google" aria-hidden="true"></span><span>Abrindo Google…</span>'

          try {
            const authorizationUrl = await this.authService.startGoogleSignIn(
              googleAuthRedirectUrl(),
            )
            await Promise.resolve(this.openExternalUrl(authorizationUrl))
          } catch (error) {
            const card = button.closest<HTMLElement>('.auth-card')
            const form = card?.querySelector<HTMLFormElement>('form')
            if (form) {
              this.showFormAlert(form, errorMessage(error))
            }
          } finally {
            if (button.isConnected) {
              button.disabled = false
              button.innerHTML = originalLabel
            }
          }
        })
      })
  }

  private bindConfirmationActions(): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-resend-confirmation]')
    if (!button || !this.pendingConfirmationEmail) return

    this.bindButtonOnce(button, async () => {
      this.confirmationResendStatus = 'sending'
      this.confirmationResendMessage = 'Solicitando um novo e-mail…'
      this.render()

      try {
        await this.authService.resendSignupConfirmation(this.pendingConfirmationEmail)
        this.confirmationResendStatus = 'sent'
        this.confirmationResendMessage = 'Novo e-mail enviado. Aguarde alguns instantes e confira também o Spam.'
      } catch (error) {
        this.confirmationResendStatus = 'error'
        this.confirmationResendMessage = errorMessage(error)
      }

      this.render()
    })
  }

  private bindSignupForm(): void {
    const form = this.root.querySelector<HTMLFormElement>('#signup-form')

    form?.addEventListener('submit', async (event) => {
      event.preventDefault()
      this.clearFormFeedback(form)
      const email = this.valueOf(form, 'email')
      const password = this.valueOf(form, 'password')
      const confirmation = this.valueOf(form, 'passwordConfirmation')
      const referralCode = normalizeReferralCode(this.valueOf(form, 'referralCode'))
      const errors: FieldErrors = {
        email: validateEmail(email),
        password: validatePassword(password),
        passwordConfirmation: validatePasswordConfirmation(
          password,
          confirmation,
        ),
        referralCode: validateReferralCode(referralCode),
      }

      if (!this.applyFieldErrors(form, errors)) {
        return
      }

      this.setFormBusy(form, true, 'Criando…')

      try {
        const result: SignUpResult = await this.authService.signUp(
          email,
          password,
          referralCode,
        )

        if (referralCode) {
          this.signupReferralCode = ''
          try {
            localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY)
          } catch {
            // Storage is optional; signup already succeeded.
          }
        }

        if (result.session && !result.needsEmailConfirmation) {
          this.prepareAuthenticatedSession(result.session)
        } else {
          this.session = result.session
          this.pendingConfirmationEmail = email.trim()
          this.confirmationResendStatus = 'idle'
          this.confirmationResendMessage = ''
          this.currentView = 'confirm-email'
        }
        this.render()

        if (result.session && !result.needsEmailConfirmation) {
          void this.loadApplicationData(result.session)
        }
      } catch (error) {
        this.showFormAlert(form, errorMessage(error))
      } finally {
        this.setFormBusy(form, false)
      }
    })
  }

  private bindForgotPasswordForm(): void {
    const form = this.root.querySelector<HTMLFormElement>('#forgot-form')

    form?.addEventListener('submit', async (event) => {
      event.preventDefault()
      this.clearFormFeedback(form)
      const email = this.valueOf(form, 'email')

      if (!this.applyFieldErrors(form, { email: validateEmail(email) })) {
        return
      }

      this.setFormBusy(form, true, 'Enviando…')

      try {
        await this.authService.resetPassword(
          email,
          passwordRecoveryRedirectUrl(),
        )
        this.currentView = 'forgot-sent'
        this.render()
      } catch (error) {
        this.showFormAlert(form, errorMessage(error))
      } finally {
        this.setFormBusy(form, false)
      }
    })
  }

  private bindResetPasswordForm(): void {
    const form = this.root.querySelector<HTMLFormElement>('#reset-form')

    form?.addEventListener('submit', async (event) => {
      event.preventDefault()
      this.clearFormFeedback(form)
      const password = this.valueOf(form, 'password')
      const confirmation = this.valueOf(form, 'passwordConfirmation')
      const errors: FieldErrors = {
        password: validatePassword(password),
        passwordConfirmation: validatePasswordConfirmation(
          password,
          confirmation,
        ),
      }

      if (!this.applyFieldErrors(form, errors)) {
        return
      }

      this.setFormBusy(form, true, 'Salvando…')

      try {
        await this.authService.updatePassword(password)
        this.recoveryMode = false
        this.currentView = 'password-updated'
        window.history.replaceState({}, '', window.location.pathname)
        this.render()
      } catch (error) {
        this.showFormAlert(form, errorMessage(error))
      } finally {
        this.setFormBusy(form, false)
      }
    })
  }

  private bindLogoutButton(): void {
    const button = this.root.querySelector<HTMLButtonElement>('#logout-button')

    if (!button) {
      return
    }

    this.bindButtonOnce(button, async () => {
      button.disabled = true
      button.textContent = 'Saindo…'

      try {
        await this.authService.signOut()
        const sessionsReleased = await this.releaseTrackedSessions()
        this.session = null
        this.clearAuthenticatedState()
        this.currentView = 'login'
        if (!sessionsReleased) {
          this.initialAlert = 'Algumas telas não puderam ser encerradas. Reinicie o aplicativo antes de abri-las novamente.'
        }
        this.render()
      } catch (error) {
        const alert = this.root.querySelector<HTMLElement>('#session-alert')

        if (alert) {
          alert.textContent = errorMessage(error)
          alert.classList.add('is-visible')
        }

        button.disabled = false
        button.textContent = 'Sair da conta'
      }
    })
  }

  private valueOf(form: HTMLFormElement, fieldName: string): string {
    return String(new FormData(form).get(fieldName) ?? '')
  }

  private clearFormFeedback(form: HTMLFormElement): void {
    form.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
      input.removeAttribute('aria-invalid')
    })
    form.querySelectorAll<HTMLElement>('.field__error').forEach((element) => {
      element.textContent = ''
    })
    this.showFormAlert(form, '')
  }

  private applyFieldErrors(
    form: HTMLFormElement,
    errors: FieldErrors,
  ): boolean {
    let isValid = true

    Object.entries(errors).forEach(([fieldName, message]) => {
      if (!message) {
        return
      }

      isValid = false
      const input = form.elements.namedItem(fieldName)

      if (input instanceof HTMLInputElement) {
        input.setAttribute('aria-invalid', 'true')
        const errorElement = document.querySelector<HTMLElement>(
          `#${input.id}-error`,
        )

        if (errorElement) {
          errorElement.textContent = message
        }
      }
    })

    if (!isValid) {
      form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
    }

    return isValid
  }

  private showFormAlert(form: HTMLFormElement, message: string): void {
    const alert = form.parentElement?.querySelector<HTMLElement>('#form-alert')

    if (!alert) {
      return
    }

    alert.textContent = message
    alert.classList.toggle('is-visible', Boolean(message))
  }

  private setFormBusy(
    form: HTMLFormElement,
    isBusy: boolean,
    busyLabel?: string,
  ): void {
    if (!form.isConnected) {
      return
    }

    form.setAttribute('aria-busy', String(isBusy))
    form.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
      input.readOnly = isBusy
    })
    const button = form.querySelector<HTMLButtonElement>('[data-submit]')

    if (!button) {
      return
    }

    if (isBusy) {
      button.dataset.idleLabel = button.textContent?.trim() ?? ''
      button.disabled = true
      button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(
        busyLabel ?? 'Aguarde…',
      )}`
    } else {
      button.disabled = false
      button.textContent = button.dataset.idleLabel ?? button.textContent
    }
  }

  private updateConnectivityBanner(): void {
    const banner = this.root.querySelector<HTMLElement>('#connectivity-banner')
    const topbarStatus = this.root.querySelector<HTMLElement>('.topbar__status span:last-child')

    banner?.classList.toggle('is-hidden', navigator.onLine)

    if (topbarStatus) {
      topbarStatus.textContent = navigator.onLine ? 'Conectado à internet' : 'Sem conexão'
    }
  }

  private showSessionAlert(message: string): void {
    if (this.sessionAlertTimer) {
      clearTimeout(this.sessionAlertTimer)
      this.sessionAlertTimer = null
    }
    const alert = this.root.querySelector<HTMLElement>('#session-alert')

    if (!alert) {
      return
    }

    alert.textContent = message
    alert.classList.toggle('is-visible', Boolean(message))
    if (message) {
      this.sessionAlertTimer = setTimeout(() => {
        this.sessionAlertTimer = null
        const currentAlert = this.root.querySelector<HTMLElement>('#session-alert')
        if (!currentAlert || currentAlert.textContent !== message) return
        currentAlert.classList.remove('is-visible')
        currentAlert.textContent = ''
      }, 4_500)
    }
  }

  private focusCurrentView(): void {
    queueMicrotask(() => {
      const heading = this.activeDialog
        ? this.root.querySelector<HTMLElement>('#dialog-title')
        : this.root.querySelector<HTMLElement>('h1')

      if (heading) {
        heading.tabIndex = -1
        heading.focus()
      }
    })
  }
}
