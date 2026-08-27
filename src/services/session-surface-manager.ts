export interface SessionSurfaceElements {
  card: HTMLElement
  surface: HTMLElement
}

export interface SessionSurfaceRecord extends SessionSurfaceElements {
  accountId: string
}

export interface SessionSurfaceElementFactory {
  createCard(accountId: string): HTMLElement
  createSurface(accountId: string): HTMLElement
}

export interface SessionSurfacePresentation {
  layout: string
  maximizedAccountId: string | null
  screensOnly: boolean
  visibleAccountIds?: readonly string[]
}

const LAYOUT_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

function requireAccountId(accountId: string): string {
  const normalized = accountId.trim()

  if (!normalized) {
    throw new TypeError('accountId não pode ser vazio.')
  }

  return normalized
}

function requireLayout(layout: string): string {
  const normalized = layout.trim().toLowerCase()

  if (!LAYOUT_PATTERN.test(normalized)) {
    throw new TypeError('Layout de sessões inválido.')
  }

  return normalized
}

const browserElementFactory: SessionSurfaceElementFactory = {
  createCard(accountId): HTMLElement {
    const card = document.createElement('article')
    card.classList.add('session-card')
    card.dataset.accountId = accountId
    return card
  },

  createSurface(accountId): HTMLElement {
    const surface = document.createElement('div')
    surface.classList.add('session-surface')
    surface.dataset.accountId = accountId
    surface.dataset.sessionSurface = ''
    return surface
  },
}

/**
 * Owns the stable DOM nodes that host live account sessions.
 *
 * Presentation changes only mutate classes and data attributes. A card and its
 * surface are detached solely by remove()/clear(), so an embedded WebView can
 * retain its document, storage and authenticated state across layout changes.
 */
export class SessionSurfaceManager {
  private readonly records = new Map<string, SessionSurfaceRecord>()
  private layout = 'grid'
  private screensOnly = false
  private maximizedAccountId: string | null = null
  private visibleAccountIds: ReadonlySet<string> | null = null

  constructor(
    private readonly container: HTMLElement,
    private readonly factory: SessionSurfaceElementFactory = browserElementFactory,
  ) {
    this.syncContainerPresentation()
  }

  get size(): number {
    return this.records.size
  }

  ensure(accountId: string): SessionSurfaceRecord {
    const normalizedId = requireAccountId(accountId)
    const existing = this.records.get(normalizedId)

    if (existing) {
      return existing
    }

    const card = this.factory.createCard(normalizedId)
    const surface = this.factory.createSurface(normalizedId)

    if (card === surface) {
      throw new TypeError('Card e surface devem ser elementos diferentes.')
    }

    card.dataset.accountId = normalizedId
    surface.dataset.accountId = normalizedId
    surface.dataset.sessionSurface = ''
    card.append(surface)

    return this.adopt(normalizedId, { card, surface })
  }

  adopt(
    accountId: string,
    elements: SessionSurfaceElements,
  ): SessionSurfaceRecord {
    const normalizedId = requireAccountId(accountId)
    const existing = this.records.get(normalizedId)

    if (existing) {
      return existing
    }

    if (elements.card === elements.surface) {
      throw new TypeError('Card e surface devem ser elementos diferentes.')
    }

    elements.card.dataset.accountId = normalizedId
    elements.surface.dataset.accountId = normalizedId
    elements.surface.dataset.sessionSurface = ''

    if (!elements.card.contains(elements.surface)) {
      elements.card.append(elements.surface)
    }

    const record: SessionSurfaceRecord = Object.freeze({
      accountId: normalizedId,
      card: elements.card,
      surface: elements.surface,
    })

    this.records.set(normalizedId, record)
    this.syncCardPresentation(record)
    if (elements.card.parentElement !== this.container) {
      this.container.append(elements.card)
    }
    return record
  }

  get(accountId: string): SessionSurfaceRecord | null {
    return this.records.get(accountId.trim()) ?? null
  }

  has(accountId: string): boolean {
    return this.records.has(accountId.trim())
  }

  list(): SessionSurfaceRecord[] {
    return [...this.records.values()]
  }

  remove(accountId: string): boolean {
    const normalizedId = accountId.trim()
    const record = this.records.get(normalizedId)

    if (!record) {
      return false
    }

    this.records.delete(normalizedId)
    if (this.visibleAccountIds?.has(normalizedId)) {
      this.visibleAccountIds = new Set(
        [...this.visibleAccountIds].filter((accountId) => accountId !== normalizedId),
      )
    }
    record.card.remove()

    if (this.maximizedAccountId === normalizedId) {
      this.maximizedAccountId = null
      this.syncContainerPresentation()
      this.syncAllCards()
    }

    return true
  }

  clear(): void {
    for (const record of this.records.values()) {
      record.card.remove()
    }

    this.records.clear()
    this.maximizedAccountId = null
    this.visibleAccountIds = null
    this.syncContainerPresentation()
  }

  setLayout(layout: string): void {
    this.layout = requireLayout(layout)
    this.syncContainerPresentation()
  }

  getLayout(): string {
    return this.layout
  }

  setScreensOnly(enabled: boolean): void {
    this.screensOnly = enabled
    this.syncContainerPresentation()
  }

  isScreensOnly(): boolean {
    return this.screensOnly
  }

  setMaximized(accountId: string | null): void {
    const normalizedId = accountId === null ? null : requireAccountId(accountId)

    if (normalizedId !== null && !this.records.has(normalizedId)) {
      throw new RangeError('Não existe surface para a conta informada.')
    }

    this.maximizedAccountId = normalizedId
    this.syncContainerPresentation()
    this.syncAllCards()
  }

  getMaximizedAccountId(): string | null {
    return this.maximizedAccountId
  }

  applyPresentation(presentation: SessionSurfacePresentation): void {
    const layout = requireLayout(presentation.layout)
    const maximizedAccountId = presentation.maximizedAccountId === null
      ? null
      : requireAccountId(presentation.maximizedAccountId)
    const visibleAccountIds = presentation.visibleAccountIds === undefined
      ? null
      : new Set(presentation.visibleAccountIds.map(requireAccountId))

    if (
      maximizedAccountId !== null
      && !this.records.has(maximizedAccountId)
    ) {
      throw new RangeError('Não existe surface para a conta informada.')
    }
    if (
      visibleAccountIds
      && [...visibleAccountIds].some((accountId) => !this.records.has(accountId))
    ) {
      throw new RangeError('A apresentação contém uma surface inexistente.')
    }

    this.layout = layout
    this.screensOnly = presentation.screensOnly
    this.maximizedAccountId = maximizedAccountId
    this.visibleAccountIds = visibleAccountIds
    this.syncContainerPresentation()
    this.syncAllCards()
  }

  private syncAllCards(): void {
    for (const record of this.records.values()) {
      this.syncCardPresentation(record)
    }
  }

  private syncCardPresentation(record: SessionSurfaceRecord): void {
    const maximized = record.accountId === this.maximizedAccountId
    const outsideVisiblePage = this.visibleAccountIds !== null
      && !this.visibleAccountIds.has(record.accountId)
    const suppressed = outsideVisiblePage
      || (this.maximizedAccountId !== null && !maximized)

    record.card.classList.toggle('is-maximized', maximized)
    record.card.classList.toggle('is-suppressed', suppressed)

    if (suppressed) {
      record.card.setAttribute('aria-hidden', 'true')
    } else {
      record.card.removeAttribute('aria-hidden')
    }
  }

  private syncContainerPresentation(): void {
    this.container.dataset.sessionLayout = this.layout
    this.container.classList.toggle('is-screens-only', this.screensOnly)
    this.container.classList.toggle(
      'has-maximized-session',
      this.maximizedAccountId !== null,
    )

    if (this.maximizedAccountId === null) {
      delete this.container.dataset.maximizedAccountId
    } else {
      this.container.dataset.maximizedAccountId = this.maximizedAccountId
    }
  }
}
