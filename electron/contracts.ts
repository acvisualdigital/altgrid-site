export interface SessionBounds {
  x: number
  y: number
  width: number
  height: number
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
    clearData(accountId: string): Promise<boolean>
    closeSession(accountId: string): Promise<boolean>
    createSession(accountId: string, url: string): Promise<SessionSnapshot>
    destroySession(accountId: string): Promise<boolean>
    focusSession(accountId: string): Promise<SessionSnapshot>
    getSessions(): Promise<SessionSnapshot[]>
    hideSession(accountId: string): Promise<SessionSnapshot>
    muteSession(accountId: string, muted: boolean): Promise<SessionSnapshot>
    navigateSession(accountId: string, url: string): Promise<SessionSnapshot>
    onEvent(listener: (event: SessionEvent) => void): () => void
    reloadSession(accountId: string): Promise<SessionSnapshot>
    resizeSession(
      accountId: string,
      bounds: SessionBounds,
    ): Promise<SessionSnapshot>
    setEcoMode(enabled: boolean, secondaryFps?: number): Promise<boolean>
    setFrameRate(accountId: string, fps: number): Promise<SessionSnapshot>
    showSession(accountId: string): Promise<SessionSnapshot>
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
    clearData: 'altgrid:sessions:clear-data',
    close: 'altgrid:sessions:close',
    create: 'altgrid:sessions:create',
    destroy: 'altgrid:sessions:destroy',
    event: 'altgrid:sessions:event',
    focus: 'altgrid:sessions:focus',
    getAll: 'altgrid:sessions:get-all',
    hide: 'altgrid:sessions:hide',
    mute: 'altgrid:sessions:mute',
    navigate: 'altgrid:sessions:navigate',
    reload: 'altgrid:sessions:reload',
    resize: 'altgrid:sessions:resize',
    setEcoMode: 'altgrid:sessions:set-eco-mode',
    setFrameRate: 'altgrid:sessions:set-frame-rate',
    show: 'altgrid:sessions:show',
  }),
  updater: Object.freeze({
    check: 'altgrid:updater:check',
    download: 'altgrid:updater:download',
    event: 'altgrid:updater:event',
    getState: 'altgrid:updater:get-state',
    install: 'altgrid:updater:install',
  }),
})

export const SESSION_PRELOAD_CHANNELS = Object.freeze({
  setFrameRateLimit: 'altgrid:session-preload:set-frame-rate-limit',
})
