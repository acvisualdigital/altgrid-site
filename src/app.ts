import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import altgridLogoUrl from './assets/altgrid-mark.png'
import planFounderBadgeUrl from './assets/plans/plan-founder.png'
import planFreeBadgeUrl from './assets/plans/plan-free.png'
import planProBadgeUrl from './assets/plans/plan-pro.png'
import planProPlusBadgeUrl from './assets/plans/plan-pro-plus.png'

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
  GridLayoutService,
  type ConcreteGridMode,
  type GridLayout,
  type GridMode,
} from './services/grid-layout-service'
import { SessionSurfaceManager } from './services/session-surface-manager'
import { ChatService, type ChatState } from './services/chat-service'
import { NotificationCenterService } from './services/notification-center-service'
import type {
  OfflineLicenseService,
  OfflineLicenseSource,
} from './services/license-snapshot-service'
import type {
  AppMetricsResponse,
  MeResponse,
  PixPayment,
  PublicAnnouncement,
  PublicConfigResponse,
  PublicGame,
  PublicProduct,
  ReferralProgramResponse,
  ResolvedEntitlements,
} from './types/backend-api'
import type { PlanCode } from './types/database'
import type {
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
  | 'delete-account'
  | 'chat-nickname'
  | 'free-limit'
  | 'more-games'
  | 'my-plan'
  | 'payment'
  | 'plans'
  | 'proxy'
  | 'rename-account'
  | 'referrals'
  | 'settings'
  | 'shortcuts'
  | 'update'
  | null
type BackendLoadStatus = 'error' | 'idle' | 'loading' | 'ready'
type ServiceStatus = 'checking' | 'offline' | 'online' | 'unknown'
type WorkspaceMode = 'account' | 'grid'
const CHAT_GAME_SELECTION_STORAGE_KEY = 'altgrid.chat.visible-game-channels.v1'
const CHAT_BOTTOM_THRESHOLD_PX = 48
const RMT_DISCORD_URL = 'https://discord.gg/jqbWgSPVe'
const STONEGY_BOT_FEATURE = 'stonegy_bot'

export function isStonegyLaunchUrl(input: unknown): boolean {
  if (typeof input !== 'string') {
    return false
  }

  try {
    const url = new URL(input)
    return url.protocol === 'https:' && (
      url.hostname === 'stonegy-online.com'
      || url.hostname.endsWith('.stonegy-online.com')
    )
  } catch {
    return false
  }
}

export function stonegyBotMenuLabel(entitled: boolean, enabled: boolean): string {
  if (!entitled) return 'AltGrid Bot · plano pago'
  return enabled ? 'Desativar AltGrid Bot' : 'Ativar AltGrid Bot'
}

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
    | 'createPixPayment'
    | 'getAppConfig'
    | 'getAppMetrics'
    | 'getAnnouncements'
    | 'getHealth'
    | 'getAdminSession'
    | 'getPayment'
    | 'getProducts'
    | 'getReferralProgram'
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
  focus(account: ConfiguredAccount): Promise<void> | void
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
  removeProxy?(account: ConfiguredAccount): Promise<boolean>
  setEcoMode(enabled: boolean, backgroundFps: EcoBackgroundFps): Promise<boolean> | boolean
  setFrameRate(account: ConfiguredAccount, fps: number): Promise<void> | void
  setInterfaceScale?(
    account: ConfiguredAccount,
    scale: number | null,
  ): Promise<void> | void
  setFullscreen?(enabled: boolean): Promise<void> | void
  setMuted(account: ConfiguredAccount, muted: boolean): Promise<void> | void
  setStonegyBot?(account: ConfiguredAccount, enabled: boolean): Promise<void> | void
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
    | 'stonegy-bot-failed'
    | 'stonegy-bot-ready'
}

export interface AccountSessionLaunchTarget {
  allowProxy: boolean
  kind: 'custom' | 'preset'
  launchUrl: string
  game: PublicGame | null
  stonegyBotEnabled?: boolean
}

export interface AuthAppOptions {
  accountService?: ConfiguredAccountService
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
const APP_VERSION = __APP_VERSION__
const ECO_MODE_STORAGE_KEY = 'altgrid.preference.eco-mode.v1'
const ECO_BACKGROUND_FPS_STORAGE_KEY = 'altgrid.preference.eco-background-fps.v1'
const SESSION_FPS_STORAGE_KEY = 'altgrid.preference.session-fps.v1'
const SESSION_INTERFACE_SCALE_STORAGE_KEY = 'altgrid.preference.session-interface-scale.v1'
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'altgrid.preference.sidebar-collapsed.v1'
const REFERRAL_CODE_STORAGE_KEY = 'altgrid.referral-code.v1'

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
  | 'chevron'
  | 'globe'
  | 'grid'
  | 'leaf'
  | 'refresh'
  | 'screens'
  | 'settings'

const UI_ICON_PATHS: Record<UiIconName, string> = {
  add: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  chat: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  leaf: '<path d="M20 4C11 4 5 7 5 13c0 3.9 3.1 7 7 7 6 0 8-7 8-16Z"/><path d="M4 20c3-4 6-7 12-9"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/>',
  screens: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>',
}

function uiIcon(name: UiIconName): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_ICON_PATHS[name]}</svg>`
}

export function passwordRecoveryRedirectUrl(
  location: Pick<Location, 'origin' | 'protocol'> = window.location,
): string {
  if (
    location.protocol === 'altgrid:'
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

function formatMemoryKb(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB'
  const megabytes = value / 1_024
  return megabytes >= 1_024
    ? `${(megabytes / 1_024).toFixed(2)} GB`
    : `${Math.round(megabytes)} MB`
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
  private freePlanPromptShown = false
  private configuredAccounts: ConfiguredAccount[] = []
  private games: PublicGame[] = []
  private gameCatalogError: string | null = null
  private me: MeResponse | null = null
  private announcements: PublicAnnouncement[] = []
  private products: PublicProduct[] = []
  private appMetrics: AppMetricsResponse | null = null
  private referralProgram: ReferralProgramResponse | null = null
  private referralLoading = false
  private referralError: string | null = null
  private signupReferralCode = initialReferralCode()
  private presenceHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  private presenceUserId: string | null = null
  private pixPayment: PixPayment | null = null
  private paymentLoading = false
  private paymentError: string | null = null
  private paymentPollTimer: ReturnType<typeof setTimeout> | null = null
  private proxyConfig: SessionProxySummary | null = null
  private proxyLoading = false
  private proxySaving = false
  private proxyTestResult: SessionProxyTestResult | null = null
  private resourceUsage: SessionResourceUsage[] = []
  private resourceUsageLoading = false
  private chatNicknameSaving = false
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
  private maximizedAccountId: string | null = null
  private dialogAccountId: string | null = null
  private workspaceResizeObserver: ResizeObserver | null = null
  private workspaceResizeFrame: number | null = null
  private lastLayoutSignature = ''
  private renderedDialogSignature = ''
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
    } catch {
      this.sidebarCollapsed = false
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
      focus: (account) => sessionLauncher?.focus?.(account),
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
      setStonegyBot: sessionLauncher?.setStonegyBot
        ? (account, enabled) => sessionLauncher.setStonegyBot!(account, enabled)
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
    this.unsubscribeFromSessionEscape =
      this.sessionLauncher.registerEscapeHandler(this.handleSessionEscape)
      ?? null
    this.unsubscribeFromSessionStatus =
      this.sessionLauncher.registerStatusHandler(this.handleSessionStatus)
      ?? null

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
    this.stopPaymentPolling()
    this.stopPresenceTracking()
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

    if (!this.destroyed && this.currentView === 'authenticated') {
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
  }

  private readonly handleWorkspaceResize = (): void => {
    this.scheduleWorkspaceLayout()
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

    if (event.type === 'stonegy-bot-failed') {
      this.showSessionAlert(event.detail ?? 'Não foi possível iniciar o AltGrid Bot.')
      return
    }

    if (event.type === 'stonegy-bot-ready') {
      this.showSessionAlert(event.detail ?? 'AltGrid Bot ativo nesta conta.')
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
      this.render()
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
      this.freePlanPromptShown = false
      this.me = null
      this.games = this.gamePresetService?.getCachedGames() ?? []
      this.gameCatalogError = null
      this.announcements = []
      this.products = []
      this.appMetrics = null
      this.notificationCenter.setAnnouncements([])
      this.pixPayment = null
      this.paymentError = null
      this.activeDialog = null
      this.dialogAccountId = null
      this.dialogReturnFocus = null
      this.gridMode = 'auto'
      this.workspaceMode = 'account'
      this.gridPageIndex = 0
      this.previousAutoMode = undefined
      this.screensOnly = false
      this.maximizedAccountId = null
      this.focusedAccountId = null
      this.sessionIssues.clear()
      this.mutedAccountIds.clear()
      this.permissionService.updateEntitlements(SAFE_FREE_ENTITLEMENTS)
      this.ecoModeEffective = false
      void this.syncEcoMode()
      this.configuredAccounts = this.accountService.list(session.user.id)
      void this.chatService?.start()
    }

    this.session = session
    this.currentView = 'authenticated'
    this.startPresenceTracking(session.user.id)
  }

  private clearAuthenticatedState(): void {
    this.stopPresenceTracking()
    this.stopPaymentPolling()
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
    this.me = null
    this.games = []
    this.announcements = []
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
    this.sessionSurfaceManager = null
    this.disconnectWorkspaceObserver()
    this.permissionService.updateEntitlements(SAFE_FREE_ENTITLEMENTS)
    this.ecoModeEffective = false
    void this.syncEcoMode()
    this.chatService?.reset()
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
      !backendApi?.sendPresenceHeartbeat
      || !backendApi.getAppMetrics
      || this.destroyed
      || this.session?.user.id !== userId
      || !navigator.onLine
    ) {
      return
    }

    const [, metricsResult] = await Promise.allSettled([
      backendApi.sendPresenceHeartbeat(),
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

      this.adminAccess = adminResult.status === 'fulfilled'
        && adminResult.value !== null

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
        && !this.freePlanPromptShown
        && !this.activeDialog
        && this.permissionService.getCurrentPlan() === 'FREE'
      ) {
        this.freePlanPromptShown = true
        this.activeDialog = 'plans'
      }
      this.render()
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
    if (
      this.currentView === 'authenticated'
      && this.session
      && this.updateAuthenticatedShell()
    ) {
      return
    }

    this.disconnectWorkspaceObserver()
    this.sessionSurfaceManager = null
    const authenticated = this.currentView === 'authenticated'
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
          ${this.renderView()}
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

  private updateAuthenticatedShell(): boolean {
    const shell = this.root.querySelector<HTMLElement>('[data-authenticated-shell]')

    if (!shell || shell.dataset.userId !== this.session?.user.id) {
      return false
    }

    const toolbar = this.root.querySelector<HTMLElement>('.topbar__workspace-tools')
    const backendRegion = shell.querySelector<HTMLElement>('[data-backend-region]')
    const sidebarRegion = shell.querySelector<HTMLElement>('[data-sidebar-region]')
    const mobileNavigationRegion = shell.querySelector<HTMLElement>(
      '[data-mobile-navigation-region]',
    )
    const gridControlsRegion = shell.querySelector<HTMLElement>('[data-grid-controls-region]')
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
      toolbar.innerHTML = this.renderWorkspaceToolbar()
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
      backendRegion.innerHTML = this.renderBackendStatus()
    }
    if (sidebarRegion) {
      sidebarRegion.outerHTML = this.renderSidebar()
    }
    if (mobileNavigationRegion) {
      mobileNavigationRegion.outerHTML = this.renderMobileNavigation()
    }
    if (gridControlsRegion) {
      gridControlsRegion.innerHTML = this.renderGridControls()
    }
    if (chatRegion) {
      chatRegion.innerHTML = this.renderChat()
      this.restoreChatScroll(chatRegion, previousChatScroll)
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
                  : this.activeDialog === 'proxy'
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
      : plan
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
            const selected = this.workspaceMode === 'account'
              && active
              && account.id === this.focusedAccountId
            return `
              <div class="account-tab-shell ${selected ? 'is-active' : ''} ${active ? 'is-open' : ''} ${account.id === this.reorderedAccountId ? 'is-reordered' : ''}" draggable="${this.mobileSessionMode ? 'false' : 'true'}" data-account-order-id="${escapeHtml(account.id)}">
                <button
                  class="account-tab ${selected ? 'is-active' : ''} ${active ? 'is-open' : ''}"
                  data-account-tab
                  data-account-id="${escapeHtml(account.id)}"
                  type="button"
                  ${selected ? 'aria-current="page"' : ''}
                >
                  <span class="account-tab__game-icon">${this.renderAccountGameIcon(account)}</span>
                  <span class="account-tab__copy">
                    <strong>${escapeHtml(account.displayName)}</strong>
                    <small><i class="account-tab__indicator ${active ? 'is-online' : ''}" aria-hidden="true"></i>${escapeHtml(this.gameNameFor(account))} · ${active ? (this.mobileSessionMode ? 'Conectada' : 'Conectado') : (this.mobileSessionMode ? 'Salva' : 'Offline')}</small>
                  </span>
                </button>
                ${active
                  ? `<button class="account-tab__close" data-close-account data-account-id="${escapeHtml(account.id)}" type="button" aria-label="Fechar sessão ${escapeHtml(account.displayName)}" title="Fechar sessão">×</button>`
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
          ${this.sidebarCollapsed ? `<button class="header-icon-button sidebar-restore-button" data-toggle-sidebar type="button" aria-label="Mostrar jogos e perfil" title="Mostrar menu lateral">›</button>` : ''}
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
            <button class="header-command-button ${this.screensOnly ? 'is-active' : ''}" data-toggle-screens-only type="button" aria-label="Somente telas" aria-pressed="${this.screensOnly}">
              ${uiIcon('screens')}
              <span>Somente telas</span>
            </button>
          </div>
          <div class="header-utility-actions" role="group" aria-label="Comunicação e preferências">
            <button class="header-command-button" data-open-rmt type="button" aria-label="Abrir RMT no Discord">
              <span aria-hidden="true">RMT</span>
            </button>
            <button class="header-command-button eco-mode-button ${this.ecoModeEffective ? 'is-active' : ''}" data-toggle-eco-mode type="button" aria-label="${this.ecoModeSupported ? 'Desativar' : 'Eco Mode indisponível'} Eco Mode" aria-pressed="${this.ecoModeEffective}" ${this.ecoModeSupported ? '' : 'disabled'}>
              ${uiIcon('leaf')}
              <span>Eco <small>${this.ecoModeEffective ? `ON · ${this.ecoBackgroundFps}` : 'OFF'}</small></span>
            </button>
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
      <section class="auth-card" aria-labelledby="signup-title">
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
    return this.renderMessageCard(
      'Verifique seu e-mail',
      'Sua conta foi criada. Use o link enviado para confirmar o e-mail e entrar.',
      'Ir para o login',
      'login',
    )
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
    const iconUrl = normalizeSafeGameUrl(game.icon_url)

    return iconUrl
      ? `<img src="${escapeHtml(iconUrl)}" alt="" loading="lazy" />`
      : `<span aria-hidden="true">${escapeHtml(game.name.slice(0, 2).toUpperCase())}</span>`
  }

  private renderSidebar(): string {
    const activeAccount = this.configuredAccounts.find(
      (account) => account.id === this.focusedAccountId,
    )
    const selectedSlug = activeAccount?.gameSlug ?? this.games[0]?.slug
    const visibleGames = this.games.slice(0, 6)
    const activeSessions = this.permissionService.getActiveSessionCount()
    const currentPlan = this.permissionService.getCurrentPlan()
    const profilePlanBadge = renderPlanBadge(currentPlan, this.me?.founder_number ?? null)

    return `
      <aside class="game-sidebar" data-sidebar-region aria-label="Navegação principal">
        <div class="game-sidebar__catalog">
          <div class="sidebar-heading">
            <p class="sidebar-label">Jogos suportados</p>
            <button class="sidebar-collapse-button" data-toggle-sidebar type="button" aria-label="Ocultar menu lateral" title="Ocultar menu lateral">‹</button>
          </div>
          <nav class="game-list" aria-label="Jogos suportados">
            ${visibleGames.length > 0
              ? visibleGames.map((game) => `
                <button class="game-list__item ${game.slug === selectedSlug ? 'is-selected' : ''}" data-select-game="${escapeHtml(game.slug)}" type="button">
                  <span class="game-list__icon">${this.renderGameIcon(game)}</span>
                  <span>${escapeHtml(game.name)}</span>
                  <i aria-label="${game.slug === selectedSlug ? 'Selecionado' : 'Disponível'}"></i>
                </button>
              `).join('')
              : '<p class="sidebar-empty">O catálogo será carregado quando os serviços estiverem disponíveis.</p>'}
          </nav>
          <button class="sidebar-more" data-open-dialog="more-games" type="button"><span aria-hidden="true">▦</span> Ver mais jogos</button>
        </div>

        <nav class="sidebar-menu" aria-label="Preferências">
          ${this.chatService ? `<button data-open-chat type="button" aria-pressed="${this.chatService.getState().open}"><span aria-hidden="true">◉</span> ${this.chatService.getState().open ? 'Fechar chat' : 'Chat'}</button>` : ''}
          <button data-open-dialog="referrals" type="button"><span aria-hidden="true">✦</span> Indique e ganhe</button>
          <button data-open-dialog="settings" type="button"><span aria-hidden="true">⚙</span> Configurações</button>
          <button data-open-dialog="shortcuts" type="button"><span aria-hidden="true">⌨</span> Atalhos</button>
          <button data-open-dialog="about" type="button"><span aria-hidden="true">ⓘ</span> Sobre o AltGrid</button>
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
              <div><span class="profile-name-with-plan"><strong>${escapeHtml(this.profileDisplayName())}</strong>${profilePlanBadge}</span><small>Conta AltGrid</small></div>
            </div>
            <div class="sidebar-profile-popover__plan">
              <div class="sidebar-profile-popover__plan-label"><small>Plano atual</small><span class="sidebar-profile-popover__plan-dot"></span></div>
              <div><strong>${escapeHtml(this.renderPlanName())}</strong><span>${escapeHtml(this.renderSessionLimitSummary(activeSessions))}</span></div>
            </div>
            <div class="sidebar-profile-popover__actions">
              <button class="menu-item" data-open-dialog="my-plan" type="button"><span><i aria-hidden="true">◆</i>Meu plano</span><b aria-hidden="true">›</b></button>
              <button class="menu-item" data-open-dialog="referrals" type="button"><span><i aria-hidden="true">✦</i>Indique e ganhe</span><b aria-hidden="true">›</b></button>
              <button class="menu-item" data-open-dialog="about" type="button"><span><i aria-hidden="true">◎</i>Minha conta</span><b aria-hidden="true">›</b></button>
              <button class="menu-item" data-open-dialog="settings" type="button"><span><i aria-hidden="true">⚙</i>Configurações</span><b aria-hidden="true">›</b></button>
            </div>
            <div class="sidebar-profile-popover__footer-actions">
              ${this.adminAccess ? '<a class="menu-item" href="/admin"><span><i aria-hidden="true">▣</i>Painel administrativo</span><b aria-hidden="true">↗</b></a>' : ''}
              <button class="menu-item menu-item--danger" id="logout-button" type="button"><span><i aria-hidden="true">↪</i>Sair</span></button>
            </div>
          </div>
        </details>
      </aside>
    `
  }

  private renderMobileNavigation(): string {
    const chatOpen = Boolean(this.chatService?.getState().open)
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
          <button class="mobile-navigation__item ${chatOpen ? 'is-active' : ''}" data-open-chat type="button" aria-pressed="${chatOpen}">
            ${uiIcon('chat')}
            <span>Chat</span>
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
      return `<button
        class="menu-item ${selected ? 'is-selected' : ''}"
        data-grid-mode="${item.mode}"
        type="button"
        role="menuitemradio"
        aria-checked="${selected}"
        ${item.available ? '' : 'data-grid-locked="true"'}
      >
        <span>${item.mode === 'auto' ? 'Auto' : item.mode}</span>
        ${item.available ? (selected ? '<span aria-hidden="true">✓</span>' : '') : '<span class="menu-lock">PRO</span>'}
      </button>`
    }).join('')

    return `
      <div class="workspace-modebar">
        <span><b aria-hidden="true">▦</b> Organizar telas</span>
        <details class="toolbar-menu" data-toolbar-menu>
          <summary class="tool-button" aria-label="Escolher layout">Layout <small data-grid-mode-label>${this.gridMode === 'auto' ? 'Auto' : this.gridMode}</small></summary>
          <div class="menu-popover menu-popover--grid" role="menu" aria-label="Layouts de sessão">${modes}</div>
        </details>
      </div>
    `
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
        this.ecoModeEffective = confirmed === target
      })

    this.ecoModeOperation = operation.catch(() => {
      this.ecoModeEffective = false
    })
    return operation
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
      await this.syncEcoMode()
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
      await this.syncEcoMode()
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
  ): Promise<void> {
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
    } catch {
      select.value = previous === null ? '' : String(Math.round(previous * 100))
      this.showSessionAlert('Não foi possível alterar a escala desta conta.')
    } finally {
      if (select.isConnected) {
        select.disabled = false
      }
    }
  }

  private requiresMinimumVersion(): boolean {
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

    const game = this.gameForChatChannel(channel)
    return game ? this.renderGameIcon(game) : uiIcon('chat')
  }

  private visibleChatChannels(channels: ChatState['channels']): ChatState['channels'] {
    const global = channels.filter((channel) => channel.type === 'global')
    const games = channels.filter((channel) => channel.type !== 'global')
      .filter((channel) => (
        this.selectedChatGameChannelIds === null
        || this.selectedChatGameChannelIds.has(channel.id)
      ))
    return [...global, ...games]
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
        : new Set(channels.filter((channel) => channel.type !== 'global').map((channel) => channel.id))
    } catch {
      this.selectedChatGameChannelIds = new Set(
        channels.filter((channel) => channel.type !== 'global').map((channel) => channel.id),
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
            <div><strong>Chat</strong><small>${escapeHtml(currentChannel?.name ?? 'AltGrid')}</small>${communityStats}</div>
          </div>
          <button data-close-chat type="button" aria-label="Fechar chat">×</button>
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
            ${state.channels.filter((channel) => channel.type !== 'global').map((channel) => `
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
              : '<p class="chat-empty">Seja a primeira pessoa a conversar por aqui.</p>'}
        </div>
        ${state.banned || state.mutedUntil
          ? `<p class="chat-moderation">${state.banned ? 'Seu acesso ao chat está bloqueado.' : `Silenciado até ${escapeHtml(formatDate(state.mutedUntil))}.`} ${escapeHtml(state.moderationReason ?? '')}</p>`
          : ''}
        ${state.error ? `<p class="chat-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        <form class="chat-composer" id="chat-form">
          <textarea name="message" maxlength="500" rows="2" placeholder="Escreva uma mensagem…" aria-label="Mensagem" ${state.banned ? 'disabled' : ''}></textarea>
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
    this.render()
    try {
      const response = await this.backendApi.updateProfile({ display_name: field.value })
      if (this.me) this.me = { ...this.me, profile: response.profile }
      this.activeDialog = null
      await this.chatService?.open(this.focusedGameId())
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
      <section class="session-shell ${this.mobileSessionMode ? 'is-mobile-session' : ''} ${chatOpen ? 'has-chat-open' : ''} ${this.sidebarCollapsed ? 'is-sidebar-collapsed' : ''}" data-authenticated-shell data-user-id="${userId}" aria-labelledby="accounts-title">
        <h1 class="visually-hidden" id="accounts-title">Minhas contas e sessões</h1>
        ${this.mobileSessionMode ? '' : this.renderSidebar()}
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
              <span aria-hidden="true">▦</span>
              <p><strong>Nenhuma conta aberta</strong><small>Adicione uma conta para começar.</small></p>
              <button class="button button--primary" data-add-account type="button">＋ Adicionar conta</button>
            </div>
          </div>
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
    const frameRate = this.sessionFrameRateFor(account.id)
    const interfaceScale = this.sessionInterfaceScaleFor(account.id)
    const mobileFullscreen = this.mobileSessionMode
      && this.screensOnly
      && this.maximizedAccountId === account.id

    return `
      <article class="session-card" data-session-card data-account-id="${escapeHtml(account.id)}">
        <header class="session-card__header">
          <div class="session-card__identity">
            <strong data-session-name>${escapeHtml(account.displayName)}</strong>
            <span data-session-game>${escapeHtml(this.gameNameFor(account))}</span>
          </div>
          <details class="session-menu" data-session-menu>
            <summary class="session-menu__trigger" aria-label="Opções de ${escapeHtml(account.displayName)}">⋯</summary>
            <div class="menu-popover" role="menu">
              <button class="menu-item" data-rename-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Renomear</button>
              <button class="menu-item" data-reload-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Recarregar</button>
              <button class="menu-item" data-maximize-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">${this.mobileSessionMode ? (mobileFullscreen ? 'Sair da tela cheia' : 'Tela cheia · zoom automático') : 'Maximizar'}</button>
              <button class="menu-item" data-toggle-session-mute data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">${muted ? 'Ativar som' : 'Silenciar'}</button>
              ${this.renderStonegyBotMenuItem(account)}
              ${this.proxyControlAvailable() ? `<button class="menu-item" data-proxy-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Proxy exclusivo</button>` : ''}
              ${this.frameRateControlSupported ? `<label class="menu-item menu-item--field">
                <span>FPS desta conta<small>0 ou vazio = Auto</small></span>
                <input data-session-frame-rate data-account-id="${escapeHtml(account.id)}" type="number" inputmode="numeric" min="0" max="240" step="1" value="${frameRate === 0 ? '' : frameRate}" placeholder="Auto" aria-label="FPS de ${escapeHtml(account.displayName)}" />
              </label>` : ''}
              ${this.interfaceScaleControlSupported ? `<label class="menu-item menu-item--field">
                <span>Escala da interface<small>Menor mostra mais itens do HUD</small></span>
                <select data-session-interface-scale data-account-id="${escapeHtml(account.id)}" aria-label="Escala da interface de ${escapeHtml(account.displayName)}">
                  <option value="" ${interfaceScale === null ? 'selected' : ''}>Automático</option>
                  ${[50, 55, 60, 67, 75, 80, 90, 100].map((percent) => `<option value="${percent}" ${interfaceScale === percent / 100 ? 'selected' : ''}>${percent}%</option>`).join('')}
                </select>
              </label>` : ''}
              <button class="menu-item" data-close-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Fechar</button>
              <button class="menu-item menu-item--danger" data-clear-session-data data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Limpar dados</button>
              <button class="menu-item menu-item--danger" data-delete-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">Excluir configuração</button>
            </div>
          </details>
        </header>
        <div class="session-surface" data-session-surface-id="${escapeHtml(account.id)}" ${this.mobileSessionMode ? `data-native-session-host role="region" aria-label="Jogo ${escapeHtml(this.gameNameFor(account))} da conta ${escapeHtml(account.displayName)}"` : 'data-focus-account'} data-account-id="${escapeHtml(account.id)}" tabindex="0">
          ${this.renderSessionSurfaceContent(account)}
        </div>
      </article>
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
                  ${this.renderStonegyBotMenuItem(account)}
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
        const name = card.querySelector<HTMLElement>('[data-session-name]')
        const game = card.querySelector<HTMLElement>('[data-session-game]')
        const surface = card.querySelector<HTMLElement>('[data-session-surface-id]')
        const muteButton = card.querySelector<HTMLButtonElement>('[data-toggle-session-mute]')
        const stonegyBotButton = card.querySelector<HTMLButtonElement>('[data-stonegy-bot-account]')
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
          const contentSignature = issue ? `issue:${issue}` : 'ready'

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
        if (stonegyBotButton) {
          stonegyBotButton.textContent = stonegyBotMenuLabel(
            this.permissionService.canUseFeature(STONEGY_BOT_FEATURE),
            account.stonegyBotEnabled === true,
          )
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

    const activeIds = this.getActiveAccounts().map((account) => account.id)
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

    let layout = resolution.layout
    const viewportRows = layout.rows
    const scrollingGrid = this.workspaceMode === 'grid' && !this.maximizedAccountId
    const hasScrollableOverflow = scrollingGrid && layout.pageCount > 1

    if (hasScrollableOverflow) {
      const rows = Math.max(viewportRows, Math.ceil(layoutIds.length / layout.columns))
      const verticalGap = this.screensOnly ? 4 : 10
      const usableWidth = width - verticalGap * (layout.columns - 1)
      const usableViewportHeight = Math.max(
        1,
        height - verticalGap * (viewportRows - 1),
      )
      const rowHeight = viewportRows === 1
        ? Math.max(1, height)
        : Math.max(1, Math.floor(usableViewportHeight / viewportRows))
      layout = {
        ...layout,
        capacity: layout.columns * rows,
        overflowSessionIds: [],
        pageCount: 1,
        pageIndex: 0,
        rows,
        slots: layoutIds.map((sessionId, index) => ({
          bounds: (() => {
            const column = index % layout.columns
            const row = Math.floor(index / layout.columns)
            const left = Math.round(column * usableWidth / layout.columns)
            const right = Math.round((column + 1) * usableWidth / layout.columns)

            return {
              height: rowHeight,
              width: right - left,
              x: rectangle.x + left + column * verticalGap,
              y: rectangle.y + row * (rowHeight + verticalGap),
            }
          })(),
          column: index % layout.columns,
          index,
          row: Math.floor(index / layout.columns),
          sessionId,
        })),
      }
    }

    this.gridPageIndex = layout.pageIndex
    this.resolvedGridMode = layout.resolvedMode
    if (this.gridMode === 'auto' && !this.maximizedAccountId) {
      this.previousAutoMode = layout.resolvedMode
    }

    const rows = layout.rows
    const visibleIds = layout.slots.map((slot) => slot.sessionId)
    grid.style.setProperty('--grid-columns', String(layout.columns))
    grid.style.setProperty('--grid-rows', String(rows))
    if (scrollingGrid) {
      const verticalGap = this.screensOnly ? 4 : 10
      const availableHeight = Math.max(1, height - verticalGap * (viewportRows - 1))
      const rowHeight = viewportRows === 1
        ? Math.max(1, height)
        : Math.max(1, Math.floor(availableHeight / viewportRows))
      grid.style.setProperty('--grid-row-height', `${rowHeight}px`)
    } else {
      grid.style.setProperty('--grid-row-height', '')
    }
    grid.dataset.resolvedGrid = layout.resolvedMode
    this.sessionSurfaceManager?.applyPresentation({
      layout: `grid-${layout.resolvedMode}`,
      maximizedAccountId: this.maximizedAccountId,
      screensOnly: this.screensOnly,
      visibleAccountIds: visibleIds,
    })

    const pagination = shell.querySelector<HTMLElement>('[data-session-pagination]')
    const pageStatus = pagination?.querySelector<HTMLElement>('[data-grid-page-status]')
    const previousPage = pagination?.querySelector<HTMLButtonElement>('[data-grid-page="previous"]')
    const nextPage = pagination?.querySelector<HTMLButtonElement>('[data-grid-page="next"]')
    const paginationVisible = !this.maximizedAccountId
      && !this.screensOnly
      && layout.pageCount > 1

    pagination?.toggleAttribute('hidden', !paginationVisible)
    if (pageStatus) {
      pageStatus.textContent = `${layout.pageIndex + 1}/${layout.pageCount}`
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
      const surface = this.sessionSurfaceManager?.get(slot.sessionId)?.surface

      if (!surface) {
        return []
      }

      const bounds = surface.getBoundingClientRect()
      // Only pagination overflow needs this all-or-nothing guard: when every
      // session already fits on one page, a tiny scroll/rounding difference
      // must not hide an otherwise-visible account behind the placeholder.
      if (hasScrollableOverflow) {
        const fullyInsideViewport = bounds.x >= rectangle.x - 1
          && bounds.y >= rectangle.y - 1
          && bounds.x + bounds.width <= rectangle.x + rectangle.width + 1
          && bounds.y + bounds.height <= rectangle.y + rectangle.height + 1

        // Native WebContentsViews are direct window children and cannot be
        // clipped by DOM overflow. Keep offscreen rows hidden, then reuse and
        // reposition the same views as their cards enter the scroll viewport.
        if (!fullyInsideViewport) {
          return []
        }
      }
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
            <p class="eyebrow">Primeiro acesso ao chat</p>
            <h2 id="dialog-title">Como quer ser chamado?</h2>
            <p>Escolha um nick para aparecer nas suas mensagens.</p>
          </div>
          <form class="chat-nickname-form" data-chat-nickname-form>
            <label for="chat-nickname">Nick</label>
            <input id="chat-nickname" name="display_name" minlength="2" maxlength="24" autocomplete="nickname" placeholder="Seu nick" required />
            <small>Use de 2 a 24 caracteres.</small>
            <div class="modal__actions">
              <button class="button button--primary" type="submit" ${this.chatNicknameSaving ? 'disabled' : ''}>${this.chatNicknameSaving ? 'Salvando…' : 'Entrar no chat'}</button>
            </div>
          </form>
        </dialog>
      `
    }

    const utilityDialog = this.renderUtilityDialog()

    if (utilityDialog !== null) {
      return utilityDialog
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
            <p>Esta conta usa uma rota própria. A senha fica criptografada pelo Windows e nunca aparece na interface.</p>
          </div>
          ${this.renderDialogError()}
          ${this.proxyLoading ? '<div class="proxy-loading"><i class="spinner spinner--green"></i> Abrindo cofre seguro…</div>' : `
            <form id="proxy-form">
              <label class="setting-toggle proxy-enable"><span><strong>Usar proxy nesta conta</strong><small>Aplicado antes de abrir o jogo e isolado das outras contas.</small></span><input name="enabled" type="checkbox" ${config?.enabled ? 'checked' : ''} /></label>
              <div class="proxy-grid">
                <label class="field"><span>Protocolo</span><select name="protocol"><option value="http" ${config?.protocol === 'http' || !config ? 'selected' : ''}>HTTP</option><option value="https" ${config?.protocol === 'https' ? 'selected' : ''}>HTTPS</option><option value="socks5" ${config?.protocol === 'socks5' ? 'selected' : ''}>SOCKS5</option><option value="socks4" ${config?.protocol === 'socks4' ? 'selected' : ''}>SOCKS4</option></select></label>
                <label class="field proxy-host"><span>Servidor</span><input name="host" value="${escapeHtml(config?.host ?? '')}" placeholder="proxy.exemplo.com" autocomplete="off" required /></label>
                <label class="field"><span>Porta</span><input name="port" type="number" min="1" max="65535" value="${config?.port || 8080}" required /></label>
                <label class="field"><span>Usuário <small>(opcional)</small></span><input name="username" value="${escapeHtml(config?.username ?? '')}" autocomplete="off" /></label>
                <label class="field"><span>Senha <small>(opcional)</small></span><input name="password" type="password" placeholder="${config?.hasPassword ? 'Senha protegida — deixe vazio para manter' : 'Senha do proxy'}" autocomplete="new-password" /></label>
              </div>
              <div class="proxy-security"><span aria-hidden="true">◆</span><p><strong>Credencial local protegida</strong><small>O AltGrid usa a proteção de dados do Windows. O servidor AltGrid não recebe esta senha.</small></p></div>
              ${this.proxyTestResult ? `<div class="proxy-result ${resultClass}" role="status"><strong>${escapeHtml(this.proxyTestResult.message)}</strong><span>${escapeHtml(this.proxyTestResult.route)} · ${this.proxyTestResult.latencyMs} ms</span></div>` : ''}
              <div class="modal__actions">
                <button class="button button--primary" type="submit" ${this.proxySaving ? 'disabled' : ''}>${this.proxySaving ? 'Salvando…' : 'Salvar e aplicar'}</button>
                <button class="button button--secondary" data-test-proxy type="button" ${!config?.enabled || !active || this.proxySaving ? 'disabled' : ''}>Validar rota</button>
                ${config ? '<button class="text-button text-button--danger" data-remove-proxy type="button">Remover proxy</button>' : ''}
                <button class="button button--secondary" data-close-dialog type="button">Fechar</button>
              </div>
              <p class="modal__note">${active ? 'Ao salvar, somente esta conta será recarregada.' : 'Abra a conta após salvar para usar a nova rota.'}</p>
            </form>
          `}
        </dialog>
      `
    }

    if (this.activeDialog === 'add-account') {
      const availableGames = this.games.filter(
        (game) => game.slug !== CUSTOM_GAME_SLUG,
      )
      const gameChoices = availableGames.map((game, index) => {
        const iconUrl = normalizeSafeGameUrl(game.icon_url)

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
    const currentLimit = this.permissionService.getAccountLimit()
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
          <p class="eyebrow">Escolha seu plano</p>
          <h2 id="dialog-title">Planos AltGrid</h2>
          <p>Mais sessões, a mesma privacidade local.</p>
        </div>
        <div class="plan-list">
          ${this.renderPlanOption('FREE', '3 Huntera · 2 nos demais jogos', 'Entrada', currentPlan, null, ['Recursos essenciais', 'Presets de jogos', 'Privacidade local'])}
          ${this.renderPlanOption(
            'PRO',
            currentPlan === 'PRO' ? `Seu plano atual · até ${currentLimit} contas` : 'Até 6 contas simultâneas',
            'Plano avançado',
            currentPlan,
            productFor('PRO'),
            ['Grades avançadas', 'Eco mode', 'Restauração de sessões'],
          )}
          ${this.renderPlanOption(
            'PLUS',
            currentPlan === 'PRO_PLUS' ? `Seu plano atual · até ${currentLimit} contas` : 'Até 10 contas simultâneas',
            'Melhor custo-benefício',
            currentPlan,
            productFor('PRO_PLUS'),
            ['Tudo do PRO', 'Até 10 sessões', 'Prioridade nas novidades'],
            true,
          )}
          ${this.renderPlanOption(
            'FOUNDER',
            currentPlan === 'FOUNDER'
              ? `Seu plano atual · ${this.renderAccountLimit(currentLimit)} contas`
              : founderUpgradeEligible ? 'Upgrade com crédito do PRO' : 'Contas simultâneas ilimitadas',
            founderUpgradeEligible ? 'Upgrade especial' : 'Plano máximo',
            currentPlan,
            productFor('FOUNDER'),
            ['Benefícios Founder', 'Recursos beta', 'Badge especial no chat'],
          )}
        </div>
        ${this.products.length === 0 ? '<p class="modal__note">Os preços estarão disponíveis quando os serviços AltGrid reconectarem.</p>' : ''}
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
        content = `<div class="update-summary"><strong>Nova versão disponível</strong><span>${version}</span>${notes ? `<ul>${notes}</ul>` : ''}<small>O AltGrid baixará o instalador completo e verificará sua integridade automaticamente.</small></div>`
        actions = '<button class="button button--primary" data-download-update type="button">Baixar atualização</button>'
      } else if (state.status === 'downloading') {
        content = `<div class="update-summary"><strong>Baixando atualização</strong><span>Você pode continuar usando o AltGrid.</span><progress max="100" value="${progress}">${progress}%</progress><small>${Math.round(progress)}%</small></div>`
        actions = ''
      } else if (state.status === 'downloaded') {
        content = `<div class="update-summary"><strong>Atualização verificada e pronta</strong><span>${version}</span>${notes ? `<ul>${notes}</ul>` : ''}<small>No Windows, o AltGrid fechará as sessões, instalará a versão completa e abrirá novamente. No Android, o sistema pedirá sua confirmação.</small></div>`
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
      const recent = program?.recent_referrals ?? []
      const statusLabel: Record<string, string> = {
        pending: 'Em validação',
        qualified: 'Qualificado',
        rewarded: 'Recompensado',
        rejected: 'Não elegível',
      }

      return `
        <dialog class="modal modal--referrals" id="app-dialog" aria-labelledby="dialog-title">
          <div class="referral-hero">
            <div>
              <p class="eyebrow">PROGRAMA DE INDICAÇÕES</p>
              <h2 id="dialog-title">Convide. Suba no ranking. Faça história.</h2>
              <p>Cada amigo válido rende <strong>1 dia de PRO</strong>. No fim da campanha, os três líderes recebem planos vitalícios.</p>
            </div>
            <div class="referral-hero__mark" aria-hidden="true">✦</div>
          </div>

          ${this.referralError ? `<div class="form-alert is-visible" role="alert">${escapeHtml(this.referralError)}</div>` : ''}
          ${this.referralLoading && !program ? '<div class="referral-loading"><span class="spinner spinner--green"></span><span>Validando indicações e carregando o ranking…</span></div>' : ''}
          ${program ? `
            <section class="referral-share" aria-label="Seu link de indicação">
              <div>
                <small>SEU CÓDIGO INDIVIDUAL</small>
                <strong>${escapeHtml(program.code)}</strong>
                <span>Envie seu link. O código entra automaticamente no cadastro.</span>
              </div>
              <div class="referral-share__actions">
                <button class="button button--primary" data-share-referral type="button">Compartilhar link</button>
                <button class="button button--secondary" data-copy-referral type="button">Copiar</button>
              </div>
              <input data-referral-url type="text" readonly value="${escapeHtml(program.share_url)}" aria-label="Link de indicação" />
            </section>

            <div class="referral-stats" aria-label="Seus resultados">
              <article><small>Indicações válidas</small><strong>${program.stats.valid}</strong><span>+${program.stats.pro_days} ${program.stats.pro_days === 1 ? 'dia' : 'dias'} de PRO</span></article>
              <article><small>Sua posição</small><strong>${program.stats.position ? `#${program.stats.position}` : '—'}</strong><span>${program.stats.position ? 'no ranking atual' : 'convide para entrar'}</span></article>
              <article><small>Em validação</small><strong>${program.stats.pending}</strong><span>confirmação automática</span></article>
            </div>

            <section class="referral-prizes" aria-labelledby="referral-prizes-title">
              <div class="referral-section-heading"><div><p class="eyebrow">PÓDIO VITALÍCIO</p><h3 id="referral-prizes-title">Os três maiores indicadores vencem</h3></div><small>Encerra em ${escapeHtml(campaignEnd ?? '—')}</small></div>
              <div class="referral-prize-grid">
                <article class="referral-prize referral-prize--founder"><span>1º LUGAR</span><img src="${planFounderBadgeUrl}" alt="" /><div><strong>FOUNDER</strong><small>Plano máximo vitalício</small></div></article>
                <article class="referral-prize referral-prize--plus"><span>2º LUGAR</span><img src="${planProPlusBadgeUrl}" alt="" /><div><strong>PLUS</strong><small>Plano Plus vitalício</small></div></article>
                <article class="referral-prize referral-prize--pro"><span>3º LUGAR</span><img src="${planProBadgeUrl}" alt="" /><div><strong>PRO</strong><small>Plano PRO vitalício</small></div></article>
              </div>
            </section>

            <section class="referral-board" aria-labelledby="referral-ranking-title">
              <div class="referral-section-heading"><div><p class="eyebrow">RANKING AO VIVO</p><h3 id="referral-ranking-title">Corrida de indicações</h3></div><button class="text-button" data-refresh-referrals type="button">Atualizar</button></div>
              <div class="referral-board__list">
                ${ranking.length > 0 ? ranking.slice(0, 10).map((entry) => `
                  <div class="referral-rank-row ${entry.is_current_user ? 'is-current-user' : ''} ${entry.position <= 3 ? `is-top-${entry.position}` : ''}">
                    <span class="referral-rank-row__position">${entry.position <= 3 ? ['🥇', '🥈', '🥉'][entry.position - 1] : `#${entry.position}`}</span>
                    <span class="referral-rank-row__avatar">${escapeHtml(entry.display_name.slice(0, 1).toUpperCase())}</span>
                    <span><strong>${escapeHtml(entry.display_name)}${entry.is_current_user ? ' (você)' : ''}</strong><small>${entry.prize_plan ? `Prêmio atual: ${entry.prize_plan === 'PRO_PLUS' ? 'PLUS' : entry.prize_plan}` : 'Na disputa'}</small></span>
                    <b>${entry.valid_referrals} ${entry.valid_referrals === 1 ? 'indicação' : 'indicações'}</b>
                  </div>
                `).join('') : '<div class="referral-empty"><strong>O pódio ainda está aberto.</strong><span>Seja o primeiro a registrar uma indicação válida.</span></div>'}
              </div>
            </section>

            <div class="referral-lower-grid">
              <section class="referral-rules"><p class="eyebrow">COMO FUNCIONA</p><ol><li><b>1</b><span>Compartilhe seu link individual.</span></li><li><b>2</b><span>Seu amigo cria e confirma a conta pelo código.</span></li><li><b>3</b><span>Após 24h e uso em dispositivo válido, você recebe 1 dia de PRO.</span></li></ol></section>
              <section class="referral-integrity"><p class="eyebrow">RANKING PROTEGIDO</p><h3>Validação contra abuso</h3><p>E-mail confirmado, espera mínima, conta única e dispositivo exclusivo. Autoindicação, repetição de dispositivo e crédito duplicado não contam.</p></section>
            </div>

            ${recent.length > 0 ? `<section class="referral-recent"><div class="referral-section-heading"><h3>Suas indicações recentes</h3></div>${recent.slice(0, 6).map((entry) => `<div><span class="referral-rank-row__avatar">${escapeHtml(entry.display_name.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(entry.display_name)}</strong><small>${new Intl.DateTimeFormat('pt-BR').format(new Date(entry.created_at))}</small></span><b class="referral-status referral-status--${entry.status}">${escapeHtml(statusLabel[entry.status] ?? entry.status)}</b></div>`).join('')}</section>` : ''}
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
      const usageRows = this.resourceUsage.map((usage) => {
        const account = this.configuredAccounts.find((item) => item.id === usage.accountId)
        return `<div class="resource-row"><span><strong>${escapeHtml(account?.displayName ?? 'Conta')}</strong><small>${escapeHtml(account ? this.gameNameFor(account) : usage.accountId)}</small></span><b>${escapeHtml(formatMemoryKb(usage.privateKb))}</b></div>`
      }).join('')
      return `
        <dialog class="modal modal--settings" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header"><p class="eyebrow">Preferências</p><h2 id="dialog-title">Configurações</h2></div>
          <div class="settings-layout">
            <nav aria-label="Categorias das configurações">
              <button class="is-active" data-settings-tab="general" type="button">Geral</button><button data-settings-tab="accounts" type="button">Contas</button><button data-settings-tab="visual" type="button">Visual</button><button data-settings-tab="updates" type="button">Atualizações</button><button data-settings-tab="notifications" type="button">Notificações</button><button data-settings-tab="about" type="button">Sobre</button>
            </nav>
            <div class="settings-content">
              <section data-settings-panel="general"><h3>Geral</h3><label class="setting-toggle"><span><strong>Eco Mode</strong><small>${ecoModeNote}</small></span><input data-preference="eco-mode" type="checkbox" ${this.ecoModeRequested ? 'checked' : ''} ${ecoModeAvailable ? '' : 'disabled'} /></label><label class="setting-select"><span><strong>FPS em segundo plano</strong><small>A conta em uso permanece suave; as demais economizam recursos.</small></span><select data-eco-background-fps ${ecoModeAvailable ? '' : 'disabled'}><option value="10" ${this.ecoBackgroundFps === 10 ? 'selected' : ''}>10 FPS</option><option value="20" ${this.ecoBackgroundFps === 20 ? 'selected' : ''}>20 FPS</option><option value="30" ${this.ecoBackgroundFps === 30 ? 'selected' : ''}>30 FPS</option></select></label><label class="setting-toggle"><span><strong>Restaurar última sessão</strong><small>Reabre as contas usadas na inicialização anterior.</small></span><input data-preference="restore-session" type="checkbox" ${restore ? 'checked' : ''} /></label><label class="setting-toggle"><span><strong>Confirmar antes de fechar</strong><small>Evita encerrar sessões por acidente.</small></span><input data-preference="confirm-close" type="checkbox" ${confirmClose ? 'checked' : ''} /></label></section>
              <section data-settings-panel="accounts" hidden><h3>Contas e memória</h3><p>Cookies, sessões e proxies ficam somente neste dispositivo, isolados por conta.</p><div class="resource-summary"><span><small>Memória privada das sessões</small><strong>${escapeHtml(formatMemoryKb(totalPrivateKb))}</strong></span><button class="button button--secondary" data-refresh-resource-usage type="button" ${this.resourceUsageLoading ? 'disabled' : ''}>${this.resourceUsageLoading ? 'Medindo…' : 'Medir agora'}</button></div>${usageRows ? `<div class="resource-list">${usageRows}</div>` : '<p class="modal__note">Abra suas contas e clique em “Medir agora” para ver o consumo por sessão.</p>'}<p class="modal__note">O perfil de 10 FPS reduz trabalho de CPU/GPU das contas em segundo plano. Como cada jogo mantém um navegador isolado e ativo, a RAM só é totalmente liberada ao fechar a conta.</p></section>
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
      const currentLimit = this.permissionService.getAccountLimit()
      const planSummary = currentPlan === 'FREE'
        ? 'Começo essencial para organizar suas primeiras sessões.'
        : currentPlan === 'PRO'
          ? 'Seu plano atual libera grades avançadas, eco mode e restauração de sessões.'
          : 'Acesso máximo, recursos beta e presença Founder no chat.'
      const validity = this.me?.lifetime
        ? 'Vitalício'
        : this.me?.expires_at ? `Ativo até ${formatDate(this.me.expires_at)}` : 'Sem vencimento'
      return `
        <dialog class="modal modal--plan-summary" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header"><p class="eyebrow">Assinatura</p><h2 id="dialog-title">Meu plano</h2><p>Benefícios vinculados à sua conta AltGrid.</p></div>
          <div class="current-plan-card"><div class="current-plan-card__heading"><span>${escapeHtml(this.renderPlanName())}</span><small>${escapeHtml(validity)}</small></div><strong>${currentPlan === 'FREE' ? 'Huntera: 3 · demais jogos: 2' : `${this.renderAccountLimit(currentLimit)} contas simultâneas`}</strong><p>${escapeHtml(planSummary)}</p><div class="current-plan-card__meter"><span style="width:${currentPlan === 'FREE' ? '18' : currentPlan === 'PRO' ? '55' : '100'}%"></span></div><small class="current-plan-card__hint">${currentPlan === 'FOUNDER' ? 'Nível máximo do AltGrid' : 'Veja o próximo nível e seus benefícios'}</small></div>
          <div class="modal__actions">${currentPlan !== 'FOUNDER' ? '<button class="button button--primary" data-show-plans type="button">Ver opções de upgrade</button>' : ''}<button class="button button--secondary" data-close-dialog type="button">Fechar</button></div>
        </dialog>
      `
    }

    if (this.activeDialog === 'payment') {
      const payment = this.pixPayment
      const qrImage = payment?.qr_code_base64?.match(/^[A-Za-z0-9+/=\r\n]+$/)
        ? payment.qr_code_base64.replace(/\s/g, '')
        : null
      const approved = Boolean(payment && ['approved', 'paid', 'fulfilled'].includes(payment.status))
      return `
        <dialog class="modal modal--payment" id="app-dialog" aria-labelledby="dialog-title">
          <div class="modal__header"><p class="eyebrow">Pagamento seguro</p><h2 id="dialog-title">${approved ? 'Pagamento confirmado' : 'Ativar com PIX'}</h2></div>
          ${this.paymentError ? `<div class="form-alert is-visible" role="alert">${escapeHtml(this.paymentError)}</div>` : ''}
          ${payment
            ? `<div class="payment-summary"><strong>${escapeHtml(formatCurrency(payment.amount, payment.currency))}</strong><small>${escapeHtml(payment.product_code)}</small></div>${approved ? '<div class="payment-approved"><span aria-hidden="true">✓</span><strong>Seu plano está sendo ativado.</strong></div>' : `${qrImage ? `<img class="pix-qr" src="data:image/png;base64,${qrImage}" alt="QR Code PIX" />` : ''}<label class="field pix-copy"><span>Pix Copia e Cola</span><textarea readonly rows="3" data-pix-code>${escapeHtml(payment.qr_code ?? '')}</textarea></label><button class="button button--secondary" data-copy-pix type="button">Copiar código PIX</button><p class="payment-waiting"><i class="spinner spinner--green"></i> Aguardando pagamento…</p>`}`
            : '<div class="payment-waiting"><i class="spinner spinner--green"></i> Preparando seu PIX…</div>'}
          <div class="modal__actions">${payment && !approved ? `<button class="button button--primary" data-refresh-payment type="button" ${this.paymentLoading ? 'disabled' : ''}>${this.paymentLoading ? 'Atualizando…' : 'Atualizar status'}</button>` : ''}<button class="button button--secondary" data-close-dialog type="button">Fechar</button></div>
        </dialog>
      `
    }

    return null
  }

  private renderPlanOption(
    plan: string,
    description: string,
    label: string,
    currentPlan: string,
    product: PublicProduct | null,
    benefits: string[],
    recommended = false,
  ): string {
    const current = plan === currentPlan

    return `
      <div class="plan-option ${current ? 'plan-option--current' : ''} ${recommended ? 'plan-option--recommended' : ''}">
        <div>
          <strong>${plan}</strong>
          <span>${escapeHtml(label)} · ${escapeHtml(description)}</span>
          <ul>${benefits.map((benefit) => `<li>${escapeHtml(benefit)}</li>`).join('')}</ul>
          ${product ? `<b>${escapeHtml(formatCurrency(product.price_amount, product.currency))}${product.code.endsWith('_UPGRADE') ? '<small> com desconto</small>' : ''}</b>` : ''}
        </div>
        ${current
          ? '<span class="plan-option__badge">Plano atual</span>'
          : `<div class="plan-option__actions">${recommended ? '<span class="plan-option__badge">Mais escolhido</span>' : ''}${product
            ? `<button class="button button--primary button--compact" data-buy-product="${escapeHtml(product.code)}" type="button">${product.code.endsWith('_UPGRADE') ? 'Fazer upgrade' : 'Ativar com PIX'}</button>`
            : '<span class="plan-option__badge">Indisponível</span>'}</div>`}
      </div>
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
        <input
          id="${id}"
          name="${id.includes('confirmation') ? 'passwordConfirmation' : 'password'}"
          type="password"
          autocomplete="${autocomplete}"
          required
          aria-describedby="${id}-error"
        />
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
          this.activeDialog = dialog
          this.dialogError = null
          this.render()
          if (dialog === 'referrals') {
            void this.loadReferralProgram()
          }
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
      .querySelectorAll<HTMLButtonElement>('[data-stonegy-bot-account]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          const account = this.accountFromAction(button)
          if (!account) {
            return
          }

          button.closest('details')?.removeAttribute('open')
          void this.toggleStonegyBot(account, button)
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
      const updateNavigation = (): void => {
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
          this.gridPageIndex = 0
          this.maximizedAccountId = null
          this.applyWorkspacePresentation()
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

      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const margin = 8
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
    if (this.activeDialog === 'payment') {
      this.stopPaymentPolling()
    }
    if (this.activeDialog === 'proxy') {
      this.proxyConfig = null
      this.proxyLoading = false
      this.proxySaving = false
      this.proxyTestResult = null
    }
    this.activeDialog = null
    this.dialogError = null
    this.dialogAccountId = null
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
    if (!this.backendApi?.getPayment || !this.pixPayment) {
      return
    }

    this.paymentLoading = true
    this.paymentError = null
    if (button) button.disabled = true

    try {
      const response = await this.backendApi.getPayment(this.pixPayment.id)
      this.pixPayment = response.payment
      if (
        this.session
        && ['approved', 'fulfilled', 'paid'].includes(response.payment.status)
      ) {
        void this.loadApplicationData(this.session, true)
        this.stopPaymentPolling()
      }
    } catch (error) {
      this.paymentError = backendErrorMessage(error)
    } finally {
      this.paymentLoading = false
      this.render()
    }
  }

  private renderStonegyBotMenuItem(account: ConfiguredAccount): string {
    if (!this.stonegyBotControlSupported() || !this.isStonegyAccount(account)) {
      return ''
    }

    const entitled = this.permissionService.canUseFeature(STONEGY_BOT_FEATURE)
    const label = stonegyBotMenuLabel(entitled, account.stonegyBotEnabled === true)

    return `<button class="menu-item" data-stonegy-bot-account data-account-id="${escapeHtml(account.id)}" type="button" role="menuitem">${label}</button>`
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

  private bindDialogActions(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-close-dialog]')
      .forEach((button) => {
        this.bindButtonOnce(button, () => {
          this.closeDialog()
        })
      })

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
      this.configuredAccounts = this.accountService.list(userId)
      this.sessionFrameRates.delete(accountId)
      this.storeSessionFrameRatePreferences()
      this.sessionInterfaceScales.delete(accountId)
      this.storeSessionInterfaceScalePreferences()
      this.mutedAccountIds.delete(accountId)
      this.sessionIssues.delete(accountId)
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

  private proxyControlAvailable(): boolean {
    return !this.mobileSessionMode
      && typeof this.sessionLauncher.getProxy === 'function'
      && typeof this.sessionLauncher.setProxy === 'function'
      && this.permissionService.canUseFeature('account_proxy')
  }

  private stonegyBotControlSupported(): boolean {
    return !this.mobileSessionMode
      && typeof this.sessionLauncher.setStonegyBot === 'function'
  }

  private isStonegyAccount(account: ConfiguredAccount): boolean {
    const launchUrl = account.gameSlug === CUSTOM_GAME_SLUG
      ? normalizeSafeGameUrl(account.customLaunchUrl)
      : normalizeSafeGameUrl(this.games.find(
          (candidate) => candidate.slug === account.gameSlug,
        )?.launch_url)

    return isStonegyLaunchUrl(launchUrl)
  }

  private async toggleStonegyBot(
    account: ConfiguredAccount,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (!this.stonegyBotControlSupported() || !this.isStonegyAccount(account)) {
      this.showSessionAlert('O AltGrid Bot está disponível somente para Stonegy no Windows.')
      return
    }

    if (!this.permissionService.canUseFeature(STONEGY_BOT_FEATURE)) {
      this.dialogReturnFocus = { accountId: account.id, type: 'account' }
      this.dialogAccountId = account.id
      this.activeDialog = 'plans'
      this.render()
      return
    }

    const userId = this.session?.user.id
    if (!userId) {
      return
    }

    const previous = account.stonegyBotEnabled === true
    const enabled = !previous
    button.disabled = true
    button.textContent = enabled ? 'Desativar AltGrid Bot' : 'Ativar AltGrid Bot'

    try {
      const updated = this.accountService.setStonegyBotEnabled(
        userId,
        account.id,
        enabled,
      )
      if (!updated) {
        throw new Error('Conta não encontrada.')
      }
      account.stonegyBotEnabled = enabled
      this.configuredAccounts = this.accountService.list(userId)

      if (this.permissionService.isSessionActive(account.id)) {
        await Promise.resolve(this.sessionLauncher.setStonegyBot!(updated, enabled))
      }

      this.render()
      this.showSessionAlert(enabled
        ? 'AltGrid Bot ativado. A conta será recarregada para iniciar o bot.'
        : 'AltGrid Bot desativado. A conta será recarregada sem o bot.')
    } catch {
      this.accountService.setStonegyBotEnabled(userId, account.id, previous)
      account.stonegyBotEnabled = previous
      this.configuredAccounts = this.accountService.list(userId)
      this.render()
      this.showSessionAlert('Não foi possível alterar o AltGrid Bot nesta conta.')
    } finally {
      if (button.isConnected) {
        button.disabled = false
      }
    }
  }

  private async openProxyDialog(account: ConfiguredAccount): Promise<void> {
    if (!this.proxyControlAvailable() || !this.sessionLauncher.getProxy) {
      this.showSessionAlert('O proxy por conta é exclusivo do Founder no aplicativo Windows.')
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

  private async saveProxyConfiguration(form: HTMLFormElement): Promise<void> {
    const account = this.configuredAccounts.find(
      (candidate) => candidate.id === this.dialogAccountId,
    )
    if (!account || !this.sessionLauncher.setProxy || this.proxySaving) return

    const port = Number(this.valueOf(form, 'port'))
    const password = this.valueOf(form, 'password')
    const enabled = form.elements.namedItem('enabled') instanceof HTMLInputElement
      && (form.elements.namedItem('enabled') as HTMLInputElement).checked
    const protocol = this.valueOf(form, 'protocol') as SessionProxyInput['protocol']

    this.proxySaving = true
    this.dialogError = null
    this.proxyTestResult = null
    try {
      this.proxyConfig = await this.sessionLauncher.setProxy(account, {
        enabled,
        host: this.valueOf(form, 'host'),
        password: password || undefined,
        port,
        preservePassword: Boolean(this.proxyConfig?.hasPassword && !password),
        protocol,
        username: this.valueOf(form, 'username'),
      })
      this.proxyTestResult = {
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
    const account = this.configuredAccounts.find(
      (candidate) => candidate.id === this.dialogAccountId,
    )
    if (!account || !this.sessionLauncher.testProxy) return
    button.disabled = true
    button.textContent = 'Validando…'
    this.dialogError = null
    try {
      this.proxyTestResult = await this.sessionLauncher.testProxy(account)
    } catch (error) {
      this.proxyTestResult = null
      this.dialogError = error instanceof Error
        ? error.message
        : 'Abra esta conta para validar a rota configurada.'
    }
    this.render()
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
    this.render()
    this.activateSettingsTab('accounts')
    try {
      this.resourceUsage = await this.sessionLauncher.getResourceUsage()
      this.dialogError = null
    } catch {
      this.dialogError = 'Não foi possível medir a memória das sessões.'
    } finally {
      this.resourceUsageLoading = false
      if (this.activeDialog === 'settings') {
        this.render()
        this.activateSettingsTab('accounts')
      }
    }
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
            allowProxy: this.permissionService.canUseFeature('account_proxy'),
            game: null,
            kind: 'custom',
            launchUrl,
            stonegyBotEnabled: account.stonegyBotEnabled === true
              && this.permissionService.canUseFeature(STONEGY_BOT_FEATURE)
              && isStonegyLaunchUrl(launchUrl),
          }
        : null
    }

    const game = this.games.find(
      (candidate) => candidate.slug === account.gameSlug,
    )
    const launchUrl = normalizeSafeGameUrl(game?.launch_url)

    return game && launchUrl
      ? {
          allowProxy: this.permissionService.canUseFeature('account_proxy'),
          game,
          kind: 'preset',
          launchUrl,
          stonegyBotEnabled: account.stonegyBotEnabled === true
            && this.permissionService.canUseFeature(STONEGY_BOT_FEATURE)
            && isStonegyLaunchUrl(launchUrl),
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
    const alert = this.root.querySelector<HTMLElement>('#session-alert')

    if (!alert) {
      return
    }

    alert.textContent = message
    alert.classList.toggle('is-visible', Boolean(message))
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
