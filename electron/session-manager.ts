import type {
  SessionBounds,
  SessionEvent,
  SessionSnapshot,
  SessionStatus,
} from './contracts.js'
import { isAllowedSessionUrl } from './url-policy.js'

const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const MAX_VIEW_DIMENSION = 8_192
const MAX_VIEW_AREA = 33_554_432
const DEFAULT_LOAD_TIMEOUT_MS = 30_000
const DEFAULT_SESSION_BOUNDS: SessionBounds = {
  height: 720,
  width: 1_280,
  x: 0,
  y: 0,
}

export type NativeSessionEvent =
  | { type: 'escape' | 'loading' | 'ready' }
  | { type: 'crashed' | 'load-failed' | 'popup-blocked'; detail?: string }
  | { type: 'navigated'; url: string }

export interface NativeSessionView {
  attach(): void
  destroy(force: boolean): void
  focus(): void
  loadURL(url: string): Promise<void>
  reload(): void
  stop(): void
  setBounds(bounds: SessionBounds): void
  setEcoMode(enabled: boolean): void
  setMuted(muted: boolean): void
  setVisible(visible: boolean): void
}

export interface NativeSessionViewContext {
  accountId: string
  onEvent(event: NativeSessionEvent): void
  partition: string
}

export type NativeSessionViewFactory = (
  context: NativeSessionViewContext,
) => NativeSessionView

export interface SessionManagerOptions {
  allowInsecureLoopback?: boolean
  clearPartitionData?: (partition: string) => Promise<void>
  createView: NativeSessionViewFactory
  loadTimeoutMs?: number
}

interface SessionRecord {
  accountId: string
  bounds: SessionBounds
  muted: boolean
  partition: string
  status: SessionStatus
  url: string
  view: NativeSessionView
  visible: boolean
}

export function normalizeAccountId(accountId: unknown): string {
  if (typeof accountId !== 'string') {
    throw new TypeError('accountId deve ser uma string.')
  }

  const normalized = accountId.trim()

  if (!ACCOUNT_ID_PATTERN.test(normalized)) {
    throw new TypeError('accountId interno inválido.')
  }

  return normalized
}

export function normalizeSessionUrl(
  input: unknown,
  allowInsecureLoopback = false,
): string {
  if (typeof input !== 'string' || !isAllowedSessionUrl(input, allowInsecureLoopback)) {
    throw new TypeError('URL de sessão inválida.')
  }

  let url: URL

  try {
    url = new URL(input)
  } catch {
    throw new TypeError('URL de sessão inválida.')
  }

  return url.toString()
}

export function normalizeSessionBounds(input: unknown): SessionBounds {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Bounds da sessão inválidos.')
  }

  const candidate = input as Partial<SessionBounds>
  const entries = [candidate.x, candidate.y, candidate.width, candidate.height]

  if (entries.some((value) => !Number.isSafeInteger(value))) {
    throw new TypeError('Bounds da sessão devem usar inteiros.')
  }

  const bounds = candidate as SessionBounds

  if (
    bounds.x < 0
    || bounds.y < 0
    || bounds.width < 1
    || bounds.height < 1
    || bounds.width > MAX_VIEW_DIMENSION
    || bounds.height > MAX_VIEW_DIMENSION
    || bounds.width * bounds.height > MAX_VIEW_AREA
  ) {
    throw new RangeError('Bounds da sessão fora do intervalo permitido.')
  }

  return { ...bounds }
}

function partitionForAccount(accountId: string): string {
  return `persist:altgrid-account-${accountId}`
}

function snapshot(record: SessionRecord): SessionSnapshot {
  return {
    accountId: record.accountId,
    bounds: { ...record.bounds },
    muted: record.muted,
    partition: record.partition,
    status: record.status,
    url: record.url,
    visible: record.visible,
  }
}

export class SessionManager {
  private readonly allowInsecureLoopback: boolean
  private readonly clearPartitionData: (partition: string) => Promise<void>
  private readonly createView: NativeSessionViewFactory
  private readonly listeners = new Set<(event: SessionEvent) => void>()
  private readonly loadTimeoutMs: number
  private readonly records = new Map<string, SessionRecord>()
  private ecoModeEnabled = false

  constructor(options: SessionManagerOptions) {
    this.allowInsecureLoopback = options.allowInsecureLoopback ?? false
    this.clearPartitionData = options.clearPartitionData ?? (() => Promise.resolve())
    this.createView = options.createView
    this.loadTimeoutMs = Number.isFinite(options.loadTimeoutMs)
      && (options.loadTimeoutMs ?? 0) > 0
      ? Math.floor(options.loadTimeoutMs!)
      : DEFAULT_LOAD_TIMEOUT_MS
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async createSession(accountId: unknown, inputUrl: unknown): Promise<SessionSnapshot> {
    const normalizedId = normalizeAccountId(accountId)
    const existing = this.records.get(normalizedId)

    if (existing) {
      return snapshot(existing)
    }

    const url = normalizeSessionUrl(inputUrl, this.allowInsecureLoopback)
    const partition = partitionForAccount(normalizedId)
    const record = {} as SessionRecord
    const view = this.createView({
      accountId: normalizedId,
      partition,
      onEvent: (event) => this.handleNativeEvent(normalizedId, event),
    })

    Object.assign(record, {
      accountId: normalizedId,
      bounds: { ...DEFAULT_SESSION_BOUNDS },
      muted: false,
      partition,
      status: 'loading' satisfies SessionStatus,
      url,
      view,
      visible: false,
    })

    this.records.set(normalizedId, record)
    try {
      // Apply the current process-local preference before the remote page starts.
      // This preserves the WebContents and its persistent authenticated partition.
      view.setEcoMode(this.ecoModeEnabled)
      view.attach()
      view.setBounds(record.bounds)
      view.setVisible(false)
    } catch {
      this.records.delete(normalizedId)
      view.destroy(true)
      throw new Error('Não foi possível preparar esta conta.')
    }
    this.emit({ accountId: normalizedId, session: snapshot(record), type: 'created' })

    try {
      await this.loadWithTimeout(view, url)
    } catch {
      if (this.records.get(normalizedId) === record) {
        record.status = 'load-failed'
        this.emit({
          accountId: normalizedId,
          detail: 'Não foi possível carregar esta conta.',
          session: snapshot(record),
          type: 'load-failed',
        })
      }
    }

    return snapshot(record)
  }

  showSession(accountId: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)

    if (record.visible) {
      return snapshot(record)
    }

    record.visible = true
    record.view.setVisible(true)
    return snapshot(record)
  }

  hideSession(accountId: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)

    if (!record.visible) {
      return snapshot(record)
    }

    record.visible = false
    record.view.setVisible(false)
    return snapshot(record)
  }

  focusSession(accountId: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)

    if (record.visible) {
      record.view.focus()
    }

    return snapshot(record)
  }

  resizeSession(accountId: unknown, inputBounds: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)
    const bounds = normalizeSessionBounds(inputBounds)

    if (
      record.bounds.x === bounds.x
      && record.bounds.y === bounds.y
      && record.bounds.width === bounds.width
      && record.bounds.height === bounds.height
    ) {
      return snapshot(record)
    }

    record.bounds = bounds
    record.view.setBounds(bounds)
    return snapshot(record)
  }

  reloadSession(accountId: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)
    record.status = 'loading'
    record.view.reload()
    this.emit({ accountId: record.accountId, session: snapshot(record), type: 'loading' })
    return snapshot(record)
  }

  async navigateSession(accountId: unknown, inputUrl: unknown): Promise<SessionSnapshot> {
    const record = this.requireRecord(accountId)
    const url = normalizeSessionUrl(inputUrl, this.allowInsecureLoopback)
    record.status = 'loading'
    record.url = url
    this.emit({ accountId: record.accountId, session: snapshot(record), type: 'loading' })

    try {
      await this.loadWithTimeout(record.view, url)
    } catch {
      if (this.records.get(record.accountId) === record) {
        record.status = 'load-failed'
        this.emit({
          accountId: record.accountId,
          detail: 'Não foi possível carregar esta conta.',
          session: snapshot(record),
          type: 'load-failed',
        })
      }
    }

    return snapshot(record)
  }

  muteSession(accountId: unknown, muted: unknown): SessionSnapshot {
    if (typeof muted !== 'boolean') {
      throw new TypeError('O estado de áudio deve ser booleano.')
    }

    const record = this.requireRecord(accountId)

    if (record.muted === muted) {
      return snapshot(record)
    }

    record.muted = muted
    record.view.setMuted(muted)
    return snapshot(record)
  }

  setEcoMode(enabled: unknown): boolean {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('O estado do Eco Mode deve ser booleano.')
    }

    if (enabled === this.ecoModeEnabled) {
      return this.ecoModeEnabled
    }

    const previous = this.ecoModeEnabled
    const updatedViews: NativeSessionView[] = []

    try {
      for (const record of this.records.values()) {
        updatedViews.push(record.view)
        record.view.setEcoMode(enabled)
      }
    } catch {
      // Avoid reporting a mode that only some sessions received. A native
      // setter failure is unexpected, but best-effort rollback is inexpensive.
      for (const view of updatedViews.reverse()) {
        try {
          view.setEcoMode(previous)
        } catch {
          // The original failure remains authoritative.
        }
      }
      throw new Error('Não foi possível alterar o Eco Mode.')
    }

    this.ecoModeEnabled = enabled
    return this.ecoModeEnabled
  }

  closeSession(accountId: unknown): boolean {
    return this.removeRecord(accountId, false)
  }

  async clearSessionData(accountId: unknown): Promise<boolean> {
    const normalizedId = normalizeAccountId(accountId)
    const partition = partitionForAccount(normalizedId)

    // Closing the WebContents first prevents the remote page from writing new
    // cookies while its isolated persistent partition is being erased.
    this.removeRecord(normalizedId, true)
    await this.clearPartitionData(partition)
    return true
  }

  destroySession(accountId: unknown): boolean {
    return this.removeRecord(accountId, true)
  }

  getSessions(): SessionSnapshot[] {
    return [...this.records.values()].map(snapshot)
  }

  destroyAll(): void {
    for (const accountId of [...this.records.keys()]) {
      this.removeRecord(accountId, true)
    }
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private async loadWithTimeout(view: NativeSessionView, url: string): Promise<void> {
    let timer: NodeJS.Timeout | null = null
    let timedOut = false

    try {
      await Promise.race([
        view.loadURL(url),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => {
              timedOut = true
              reject(new Error('Tempo limite ao carregar a sessão.'))
            },
            this.loadTimeoutMs,
          )
        }),
      ])
    } catch (error) {
      if (timedOut) {
        view.stop()
      }
      throw error
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  private handleNativeEvent(accountId: string, event: NativeSessionEvent): void {
    const record = this.records.get(accountId)

    if (!record) {
      return
    }

    if (event.type === 'navigated') {
      try {
        record.url = normalizeSessionUrl(event.url, this.allowInsecureLoopback)
      } catch {
        return
      }
      return
    }

    if (event.type === 'loading' || event.type === 'ready') {
      record.status = event.type
    } else if (event.type === 'crashed' || event.type === 'load-failed') {
      record.status = event.type
    }

    this.emit({
      accountId,
      detail: 'detail' in event ? event.detail : undefined,
      session: snapshot(record),
      type: event.type,
    })
  }

  private removeRecord(accountId: unknown, force: boolean): boolean {
    const normalizedId = normalizeAccountId(accountId)
    const record = this.records.get(normalizedId)

    if (!record) {
      return false
    }

    this.records.delete(normalizedId)
    record.visible = false
    record.view.setVisible(false)
    record.view.destroy(force)
    this.emit({ accountId: normalizedId, type: 'destroyed' })
    return true
  }

  private requireRecord(accountId: unknown): SessionRecord {
    const normalizedId = normalizeAccountId(accountId)
    const record = this.records.get(normalizedId)

    if (!record) {
      throw new RangeError('Sessão não encontrada.')
    }

    return record
  }
}
