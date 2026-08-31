import type {
  SessionBounds,
  SessionEvent,
  SessionProxyConfig,
  SessionProxyTestResult,
  SessionResourceUsage,
  SessionSnapshot,
  SessionStatus,
} from './contracts.js'
import { isAllowedSessionUrl } from './url-policy.js'

const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const MAX_VIEW_DIMENSION = 8_192
const MAX_VIEW_AREA = 33_554_432
const DEFAULT_LOAD_TIMEOUT_MS = 30_000
// Many game pages are not responsive below this width; zooming out below it
// gives their layout more effective CSS space so buttons/bars stop clipping.
const AUTO_FIT_REFERENCE_WIDTH = 960
const AUTO_FIT_MIN_ZOOM = 0.67
const MIN_INTERFACE_ZOOM = 0.5
const MAX_INTERFACE_ZOOM = 1
const MAX_FRAME_RATE = 240
const DEFAULT_ECO_SECONDARY_FRAME_RATE = 20
const MIN_ECO_SECONDARY_FRAME_RATE = 10
const MAX_ECO_SECONDARY_FRAME_RATE = 30

function computeAutoFitZoom(width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return 1
  }

  return Math.min(1, Math.max(AUTO_FIT_MIN_ZOOM, width / AUTO_FIT_REFERENCE_WIDTH))
}

function normalizeFrameRate(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    throw new TypeError('O FPS informado é inválido.')
  }

  // 0 means unlimited/auto; anything else is clamped to a sane, positive range.
  return Math.min(Math.max(Math.round(input), 0), MAX_FRAME_RATE)
}

function normalizeInterfaceZoom(input: unknown): number | null {
  if (input === null || input === undefined || input === 0) {
    return null
  }
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    throw new TypeError('A escala da interface é inválida.')
  }

  const normalized = Math.round(input * 100) / 100
  if (normalized < MIN_INTERFACE_ZOOM || normalized > MAX_INTERFACE_ZOOM) {
    throw new RangeError('A escala da interface deve ficar entre 50% e 100%.')
  }
  return normalized
}

function normalizeEcoSecondaryFrameRate(input: unknown): number {
  if (typeof input !== 'number' || !Number.isInteger(input)) {
    throw new TypeError('O FPS secundário do Eco Mode é inválido.')
  }
  if (
    input < MIN_ECO_SECONDARY_FRAME_RATE
    || input > MAX_ECO_SECONDARY_FRAME_RATE
  ) {
    throw new RangeError('O FPS secundário do Eco Mode deve ficar entre 10 e 30.')
  }
  return input
}
const DEFAULT_SESSION_BOUNDS: SessionBounds = {
  height: 720,
  width: 1_280,
  x: 0,
  y: 0,
}

export type NativeSessionEvent =
  | { type: 'escape' | 'focused' | 'loading' | 'ready' }
  | {
      type:
        | 'crashed'
        | 'load-failed'
        | 'popup-blocked'
      detail?: string
    }
  | { type: 'navigated'; url: string }

export interface NativeSessionView {
  attach(): void
  destroy(force: boolean): void
  focus(): void
  getResourceUsage(): Promise<Omit<SessionResourceUsage, 'accountId'>>
  loadURL(url: string): Promise<void>
  reload(): void
  stop(): void
  setBounds(bounds: SessionBounds): void
  setEcoMode(enabled: boolean): void
  setExtension(extensionPath: string | null): Promise<void>
  setFrameRateLimit(fps: number): void
  setMuted(muted: boolean): void
  setProxy(config: SessionProxyConfig | null): Promise<void>
  testProxy(targetUrl: string): Promise<SessionProxyTestResult>
  setVisible(visible: boolean): void
  setZoomFactor(factor: number): void
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
  frameRate: number
  muted: boolean
  interfaceZoom: number | null
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
    frameRate: record.frameRate,
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
  private ecoSecondaryFrameRate = DEFAULT_ECO_SECONDARY_FRAME_RATE
  private focusedAccountId: string | null = null

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

  async createSession(
    accountId: unknown,
    inputUrl: unknown,
    proxyConfig: SessionProxyConfig | null = null,
    extensionPath: string | null = null,
  ): Promise<SessionSnapshot> {
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
      frameRate: 0,
      interfaceZoom: null,
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
      view.setFrameRateLimit(this.effectiveFrameRate(record))
      await view.setProxy(proxyConfig?.enabled ? proxyConfig : null)
      await view.setExtension(extensionPath)
      view.attach()
      view.setBounds(record.bounds)
      view.setZoomFactor(this.effectiveInterfaceZoom(record))
      view.setVisible(false)
      this.refreshFrameRateBudgets()
    } catch {
      this.records.delete(normalizedId)
      this.refreshFrameRateBudgets()
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

  async setSessionExtension(accountId: unknown, extensionPath: string | null): Promise<SessionSnapshot> {
    const record = this.requireRecord(accountId)
    await record.view.setExtension(extensionPath)
    record.view.reload()
    return snapshot(record)
  }

  showSession(accountId: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)

    if (record.visible) {
      return snapshot(record)
    }

    record.visible = true
    record.view.setVisible(true)
    if (this.focusedAccountId === null) {
      this.updateFocusedAccount(record.accountId)
    }
    return snapshot(record)
  }

  hideSession(accountId: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)

    if (!record.visible) {
      return snapshot(record)
    }

    record.visible = false
    record.view.setVisible(false)
    if (this.focusedAccountId === record.accountId) {
      const replacement = [...this.records.values()].find((candidate) => (
        candidate.accountId !== record.accountId && candidate.visible
      ))
      this.updateFocusedAccount(replacement?.accountId ?? null)
    }
    return snapshot(record)
  }

  focusSession(accountId: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)

    if (record.visible) {
      this.updateFocusedAccount(record.accountId)
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
    record.view.setZoomFactor(this.effectiveInterfaceZoom(record))
    return snapshot(record)
  }

  reloadSession(accountId: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)
    record.status = 'loading'
    record.view.reload()
    this.emit({ accountId: record.accountId, session: snapshot(record), type: 'loading' })
    return snapshot(record)
  }

  async setSessionProxy(
    accountId: unknown,
    proxyConfig: SessionProxyConfig | null,
  ): Promise<SessionSnapshot> {
    const record = this.requireRecord(accountId)
    await record.view.setProxy(proxyConfig?.enabled ? proxyConfig : null)
    record.status = 'loading'
    this.emit({ accountId: record.accountId, session: snapshot(record), type: 'loading' })

    try {
      await this.loadWithTimeout(record.view, record.url)
    } catch {
      if (this.records.get(record.accountId) === record) {
        record.status = 'load-failed'
        this.emit({
          accountId: record.accountId,
          detail: 'O proxy não conseguiu carregar esta conta.',
          session: snapshot(record),
          type: 'load-failed',
        })
      }
    }

    return snapshot(record)
  }

  testSessionProxy(accountId: unknown, targetUrl: string): Promise<SessionProxyTestResult> {
    return this.requireRecord(accountId).view.testProxy(targetUrl)
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

  setFrameRate(accountId: unknown, inputFps: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)
    const fps = normalizeFrameRate(inputFps)

    if (record.frameRate === fps) {
      return snapshot(record)
    }

    record.view.setFrameRateLimit(this.effectiveFrameRate(record, fps))
    record.frameRate = fps
    return snapshot(record)
  }

  setInterfaceZoom(accountId: unknown, inputZoom: unknown): SessionSnapshot {
    const record = this.requireRecord(accountId)
    const zoom = normalizeInterfaceZoom(inputZoom)

    if (record.interfaceZoom === zoom) {
      return snapshot(record)
    }

    record.interfaceZoom = zoom
    record.view.setZoomFactor(this.effectiveInterfaceZoom(record))
    return snapshot(record)
  }

  setEcoMode(enabled: unknown, inputSecondaryFps?: unknown): boolean {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('O estado do Eco Mode deve ser booleano.')
    }

    const secondaryFps = inputSecondaryFps === undefined
      ? this.ecoSecondaryFrameRate
      : normalizeEcoSecondaryFrameRate(inputSecondaryFps)

    if (
      enabled === this.ecoModeEnabled
      && secondaryFps === this.ecoSecondaryFrameRate
    ) {
      return this.ecoModeEnabled
    }

    const previousEnabled = this.ecoModeEnabled
    const previousSecondaryFps = this.ecoSecondaryFrameRate
    const updatedViews: NativeSessionView[] = []

    try {
      for (const record of this.records.values()) {
        updatedViews.push(record.view)
        record.view.setEcoMode(enabled)
        record.view.setFrameRateLimit(this.effectiveFrameRate(
          record,
          record.frameRate,
          enabled,
          secondaryFps,
        ))
      }
    } catch {
      // Avoid reporting a mode that only some sessions received. A native
      // setter failure is unexpected, but best-effort rollback is inexpensive.
      for (const view of updatedViews.reverse()) {
        try {
          const record = [...this.records.values()].find((candidate) => (
            candidate.view === view
          ))
          view.setEcoMode(previousEnabled)
          if (record) {
            view.setFrameRateLimit(this.effectiveFrameRate(
              record,
              record.frameRate,
              previousEnabled,
              previousSecondaryFps,
            ))
          }
        } catch {
          // The original failure remains authoritative.
        }
      }
      throw new Error('Não foi possível alterar o Eco Mode.')
    }

    this.ecoModeEnabled = enabled
    this.ecoSecondaryFrameRate = secondaryFps
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

  async getResourceUsage(): Promise<SessionResourceUsage[]> {
    return Promise.all([...this.records.values()].map(async (record) => ({
      accountId: record.accountId,
      ...await record.view.getResourceUsage(),
    })))
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

    if (event.type === 'focused') {
      this.updateFocusedAccount(accountId)
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
    this.refreshFrameRateBudgets()
    const wasFocused = this.focusedAccountId === normalizedId
    if (wasFocused) {
      this.focusedAccountId = null
    }
    record.visible = false
    record.view.setVisible(false)
    record.view.destroy(force)
    if (wasFocused) {
      const replacement = [...this.records.values()].find((candidate) => candidate.visible)
      this.updateFocusedAccount(replacement?.accountId ?? null)
    }
    this.emit({ accountId: normalizedId, type: 'destroyed' })
    return true
  }

  private effectiveFrameRate(
    record: SessionRecord,
    desiredFrameRate = record.frameRate,
    ecoModeEnabled = this.ecoModeEnabled,
    ecoSecondaryFrameRate = this.ecoSecondaryFrameRate,
  ): number {
    if (!ecoModeEnabled || record.accountId === this.focusedAccountId) {
      return desiredFrameRate
    }

    const adaptiveCeiling = this.records.size >= 8
      ? Math.min(ecoSecondaryFrameRate, 5)
      : this.records.size >= 4
        ? Math.min(ecoSecondaryFrameRate, 10)
        : ecoSecondaryFrameRate

    return desiredFrameRate === 0
      ? adaptiveCeiling
      : Math.min(desiredFrameRate, adaptiveCeiling)
  }

  private effectiveInterfaceZoom(record: SessionRecord): number {
    return record.interfaceZoom ?? computeAutoFitZoom(record.bounds.width)
  }

  private refreshFrameRateBudgets(): void {
    if (!this.ecoModeEnabled) {
      return
    }
    for (const record of this.records.values()) {
      record.view.setFrameRateLimit(this.effectiveFrameRate(record))
    }
  }

  private updateFocusedAccount(accountId: string | null): void {
    if (accountId === this.focusedAccountId) {
      return
    }

    const previousId = this.focusedAccountId
    this.focusedAccountId = accountId

    for (const candidateId of [previousId, accountId]) {
      if (!candidateId) {
        continue
      }
      const record = this.records.get(candidateId)
      if (record) {
        record.view.setFrameRateLimit(this.effectiveFrameRate(record))
      }
    }
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
