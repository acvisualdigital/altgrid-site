export interface SessionBounds {
  x: number
  y: number
  width: number
  height: number
}

export type SessionProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5'

export interface SessionProxyConfig {
  enabled: boolean
  host: string
  password: string
  port: number
  protocol: SessionProxyProtocol
  username: string
}

export interface SessionProxyInput {
  enabled: boolean
  host: string
  password?: string
  port: number
  preservePassword?: boolean
  protocol: SessionProxyProtocol
  username?: string
}

export interface SessionProxySummary {
  enabled: boolean
  hasPassword: boolean
  host: string
  port: number
  protocol: SessionProxyProtocol
  username: string
}

export interface SessionProxyTestResult {
  latencyMs: number
  message: string
  ok: boolean
  route: string
}

export interface SessionResourceUsage {
  accountId: string
  cpuPercent: number
  privateKb: number
  sharedKb: number
}

export interface SessionExtensionSummary {
  enabled: boolean
  folderName: string
  manifestVersion: number
  name: string
  permissions: string[]
  version: string
}

export interface SessionExtensionConfig extends SessionExtensionSummary {
  path: string
}

export type SessionStatus = 'loading' | 'ready' | 'crashed' | 'load-failed'

export interface SessionSnapshot {
  accountId: string
  bounds: SessionBounds
  frameRate: number
  muted: boolean
  partition: string
  status: SessionStatus
  url: string
  visible: boolean
}

export type SessionEventType =
  | 'created'
  | 'destroyed'
  | 'escape'
  | 'focused'
  | 'loading'
  | 'ready'
  | 'crashed'
  | 'load-failed'
  | 'popup-blocked'
  | 'switch-account'

export interface SessionEvent {
  accountId: string
  detail?: string
  session?: SessionSnapshot
  type: SessionEventType
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not_available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  message?: string
  percent?: number
  releaseNotes?: string
  status: UpdateStatus
  supported: boolean
  version?: string
}

export interface AltgridDesktopApi {
  app: {
    getPlatform(): Promise<string>
    getVersion(): Promise<string>
    openExternal(url: string): Promise<boolean>
  }
  sessions: {
    requestMemoryCleanup?(): Promise<number>
    getDiagnostics?(): Promise<DesktopDiagnostics>
    captureHeapSnapshot?(target: 'main' | 'shell'): Promise<string | null>
    chooseExtension(accountId: string): Promise<SessionExtensionSummary | null>
    installHunteraDps?(accountId: string): Promise<SessionExtensionSummary>
    clearData(accountId: string): Promise<boolean>
    closeSession(accountId: string): Promise<boolean>
    copyProxy(sourceAccountId: string, targetAccountId: string): Promise<SessionProxySummary | null>
    copyExtension(sourceAccountId: string, targetAccountId: string): Promise<SessionExtensionSummary | null>
    createSession(
      accountId: string,
      url: string,
      useStoredProxy?: boolean,
      useStoredExtension?: boolean,
    ): Promise<SessionSnapshot>
    destroySession(accountId: string): Promise<boolean>
    focusSession(accountId: string): Promise<SessionSnapshot>
    getSessions(): Promise<SessionSnapshot[]>
    getProxy(accountId: string): Promise<SessionProxySummary | null>
    getExtension(accountId: string): Promise<SessionExtensionSummary | null>
    getResourceUsage(): Promise<SessionResourceUsage[]>
    hideSession(accountId: string): Promise<SessionSnapshot>
    muteSession(accountId: string, muted: boolean): Promise<SessionSnapshot>
    navigateSession(accountId: string, url: string): Promise<SessionSnapshot>
    onEvent(listener: (event: SessionEvent) => void): () => void
    reloadSession(accountId: string): Promise<SessionSnapshot>
    removeProxy(accountId: string): Promise<boolean>
    removeExtension(accountId: string): Promise<boolean>
    resizeSession(
      accountId: string,
      bounds: SessionBounds,
    ): Promise<SessionSnapshot>
    setEcoMode(enabled: boolean, secondaryFps?: number): Promise<boolean>
    setUltraMode(enabled: boolean): Promise<boolean>
    setFrameRate(accountId: string, fps: number): Promise<SessionSnapshot>
    setInterfaceZoom(accountId: string, zoom: number | null): Promise<SessionSnapshot>
    setProxy(
      accountId: string,
      input: SessionProxyInput,
    ): Promise<SessionProxySummary>
    setExtensionEnabled(accountId: string, enabled: boolean): Promise<SessionExtensionSummary>
    showSession(accountId: string): Promise<SessionSnapshot>
    testProxy(accountId: string): Promise<SessionProxyTestResult>
  }
  updater: {
    checkForUpdates(): Promise<UpdateState>
    downloadUpdate(): Promise<UpdateState>
    getState(): Promise<UpdateState>
    onStateChange(listener: (state: UpdateState) => void): () => void
    quitAndInstall(): Promise<boolean>
  }
}

export const IPC_CHANNELS = Object.freeze({
  app: Object.freeze({
    getPlatform: 'altgrid:app:get-platform',
    getVersion: 'altgrid:app:get-version',
    openExternal: 'altgrid:app:open-external',
  }),
  sessions: Object.freeze({
    requestMemoryCleanup: 'altgrid:sessions:request-memory-cleanup',
    getDiagnostics: 'altgrid:sessions:get-diagnostics',
    captureHeapSnapshot: 'altgrid:sessions:capture-heap-snapshot',
    chooseExtension: 'altgrid:sessions:choose-extension',
    installHunteraDps: 'altgrid:sessions:install-huntera-dps',
    clearData: 'altgrid:sessions:clear-data',
    close: 'altgrid:sessions:close',
    copyProxy: 'altgrid:sessions:copy-proxy',
    copyExtension: 'altgrid:sessions:copy-extension',
    create: 'altgrid:sessions:create',
    destroy: 'altgrid:sessions:destroy',
    event: 'altgrid:sessions:event',
    focus: 'altgrid:sessions:focus',
    getAll: 'altgrid:sessions:get-all',
    getProxy: 'altgrid:sessions:get-proxy',
    getExtension: 'altgrid:sessions:get-extension',
    getResourceUsage: 'altgrid:sessions:get-resource-usage',
    hide: 'altgrid:sessions:hide',
    mute: 'altgrid:sessions:mute',
    navigate: 'altgrid:sessions:navigate',
    reload: 'altgrid:sessions:reload',
    removeProxy: 'altgrid:sessions:remove-proxy',
    removeExtension: 'altgrid:sessions:remove-extension',
    resize: 'altgrid:sessions:resize',
    setEcoMode: 'altgrid:sessions:set-eco-mode',
    setUltraMode: 'altgrid:sessions:set-ultra-mode',
    setFrameRate: 'altgrid:sessions:set-frame-rate',
    setInterfaceZoom: 'altgrid:sessions:set-interface-zoom',
    setProxy: 'altgrid:sessions:set-proxy',
    setExtensionEnabled: 'altgrid:sessions:set-extension-enabled',
    show: 'altgrid:sessions:show',
    testProxy: 'altgrid:sessions:test-proxy',
  }),
  updater: Object.freeze({
    check: 'altgrid:updater:check',
    download: 'altgrid:updater:download',
    event: 'altgrid:updater:event',
    getState: 'altgrid:updater:get-state',
    install: 'altgrid:updater:install',
  }),
})

export interface PerformanceLabConfiguration {
  mode: 'normal' | 'eco' | 'ultra'
  parkingStrategy: 'ATTACHED_OFFSCREEN' | 'DETACHED_VIEW'
  backgroundThrottlingMode: 'compatibility' | 'allow'
}

export interface PerformanceBenchmarkReport {
  schemaVersion: 1
  createdAt: string
  accountCount: number
  scenarios: Array<{
    id: string
    status: 'COMPLETED' | 'FAILED' | 'STOPPED'
    configuration: PerformanceLabConfiguration
    startedAt: string
    endedAt: string
    warmupSeconds: number
    measurementSeconds: number
    samples: DesktopDiagnostics[]
    regressions: string[]
    validation?: { ok: boolean; categories: string[] }
  }>
}

export const SESSION_PRELOAD_CHANNELS = Object.freeze({
  setFrameRateLimit: 'altgrid:session-preload:set-frame-rate-limit',
})

export interface DesktopDiagnostics {
  generatedAt: string
  version: string
  platform: string
  uptimeSeconds: number
  performanceMode?: 'normal' | 'eco' | 'ultra'
  activeSession?: string | null
  performanceDebugEnabled?: boolean
  shellBackgroundThrottling?: boolean
  ipc?: { channel: string; count: number; callsPerSecond: number; averageBytes: number; maxBytes: number }[]
  totals?: {
    electronKb: number
    altgridOverheadKb: number
    gameRenderersKb: number
    gpuKb: number
    chromiumServicesKb: number
    unknownKb: number
  }
  processes: {
    type: string
    role?: 'MAIN' | 'SHELL' | 'GAME' | 'GPU' | 'SERVICE' | 'OTHER'
    name?: string
    serviceName?: string
    classification?: 'ALTGRID_OVERHEAD' | 'GAME_RENDERER' | 'GPU' | 'CHROMIUM_SERVICES' | 'UNKNOWN'
    cpuPercent: number
    privateKb: number
    workingSetKb?: number
    peakWorkingSetKb?: number
    idleWakeupsPerSecond?: number
    pid?: number
  }[]
  sessions: {
    label: string
    accountId?: string
    webContentsId?: number
    partition?: string
    origin?: string
    status: SessionStatus
    visible: boolean
    parked?: boolean
    attached?: boolean
    parkingStrategy?: 'ATTACHED_OFFSCREEN' | 'DETACHED_VIEW'
    parkingFallbackReason?: string | null
    detachedDurationMs?: number
    processRecreated?: boolean
    unexpectedNavigation?: boolean
    muted?: boolean
    requestedMuted?: boolean
    backgroundThrottling?: boolean
    backgroundThrottlingApplyCount?: number
    backgroundThrottlingLastReason?: string | null
    backgroundThrottlingLastAppliedAt?: string | null
    imageAnimationPolicy?: 'animate' | 'animateOnce' | 'noAnimation'
    profileId?: string
    performanceMode?: 'normal' | 'eco' | 'ultra'
    frameRate: number
    pid?: number | null
    visualState?: 'ACTIVE' | 'BACKGROUND' | 'ULTRA_BACKGROUND'
  }[]
}
