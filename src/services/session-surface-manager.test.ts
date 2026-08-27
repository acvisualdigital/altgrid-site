import { describe, expect, it, vi } from 'vitest'

import {
  SessionSurfaceManager,
  type SessionSurfaceElementFactory,
} from './session-surface-manager'

class FakeClassList {
  private readonly values = new Set<string>()

  add(...tokens: string[]): void {
    tokens.forEach((token) => this.values.add(token))
  }

  contains(token: string): boolean {
    return this.values.has(token)
  }

  remove(...tokens: string[]): void {
    tokens.forEach((token) => this.values.delete(token))
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

class FakeElement {
  readonly attributes = new Map<string, string>()
  readonly children: FakeElement[] = []
  readonly classList = new FakeClassList()
  readonly dataset: Record<string, string | undefined> = {}
  appendCount = 0
  parent: FakeElement | null = null

  get parentElement(): FakeElement | null {
    return this.parent
  }

  contains(node: FakeElement): boolean {
    return node === this || this.children.some((child) => child.contains(node))
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove()
      node.parent = this
      this.children.push(node)
      this.appendCount += 1
    }
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

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
}

function asElement(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement
}

function fakeFactory() {
  const cards = new Map<string, FakeElement>()
  const surfaces = new Map<string, FakeElement>()
  const createCard = vi.fn((accountId: string) => {
    const card = new FakeElement()
    cards.set(accountId, card)
    return asElement(card)
  })
  const createSurface = vi.fn((accountId: string) => {
    const surface = new FakeElement()
    surfaces.set(accountId, surface)
    return asElement(surface)
  })
  const factory: SessionSurfaceElementFactory = {
    createCard,
    createSurface,
  }

  return { cards, createCard, createSurface, factory, surfaces }
}

describe('SessionSurfaceManager', () => {
  it('adopts an existing card and surface without detaching either node', () => {
    const container = new FakeElement()
    const elements = fakeFactory()
    const card = new FakeElement()
    const surface = new FakeElement()
    card.append(surface)
    container.append(card)
    const appendCount = container.appendCount
    const manager = new SessionSurfaceManager(
      asElement(container),
      elements.factory,
    )

    const record = manager.adopt('account-existing', {
      card: asElement(card),
      surface: asElement(surface),
    })

    expect(record.card).toBe(asElement(card))
    expect(record.surface).toBe(asElement(surface))
    expect(container.appendCount).toBe(appendCount)
    expect(card.children).toEqual([surface])
  })

  it('creates each card and surface once and reuses both by accountId', () => {
    const container = new FakeElement()
    const elements = fakeFactory()
    const manager = new SessionSurfaceManager(
      asElement(container),
      elements.factory,
    )

    const first = manager.ensure('account-1')
    const reused = manager.ensure('account-1')

    expect(reused).toBe(first)
    expect(reused.card).toBe(first.card)
    expect(reused.surface).toBe(first.surface)
    expect(elements.createCard).toHaveBeenCalledOnce()
    expect(elements.createSurface).toHaveBeenCalledOnce()
    expect(container.children).toEqual([elements.cards.get('account-1')])
    expect(elements.cards.get('account-1')?.children).toEqual([
      elements.surfaces.get('account-1'),
    ])
  })

  it('preserves node identity and login state through presentation changes', () => {
    const container = new FakeElement()
    const elements = fakeFactory()
    const manager = new SessionSurfaceManager(
      asElement(container),
      elements.factory,
    )
    const first = manager.ensure('account-1')
    const second = manager.ensure('account-2')
    first.surface.setAttribute('data-login-state', 'authenticated')
    const containerAppendCount = container.appendCount

    manager.setLayout('columns')
    manager.setScreensOnly(true)
    manager.setMaximized('account-1')
    manager.applyPresentation({
      layout: 'grid',
      maximizedAccountId: null,
      screensOnly: false,
      visibleAccountIds: ['account-1', 'account-2'],
    })

    expect(manager.get('account-1')?.card).toBe(first.card)
    expect(manager.get('account-1')?.surface).toBe(first.surface)
    expect(manager.get('account-2')?.card).toBe(second.card)
    expect(manager.get('account-2')?.surface).toBe(second.surface)
    expect(first.surface.getAttribute('data-login-state')).toBe('authenticated')
    expect(container.appendCount).toBe(containerAppendCount)
    expect(elements.createCard).toHaveBeenCalledTimes(2)
    expect(elements.createSurface).toHaveBeenCalledTimes(2)
    expect(container.dataset.sessionLayout).toBe('grid')
    expect(container.classList.contains('is-screens-only')).toBe(false)
  })

  it('does not touch the DOM when an equivalent presentation is applied again', () => {
    const container = new FakeElement()
    const elements = fakeFactory()
    const manager = new SessionSurfaceManager(
      asElement(container),
      elements.factory,
    )
    manager.ensure('account-1')
    manager.ensure('account-2')
    manager.applyPresentation({
      layout: 'grid-1x1',
      maximizedAccountId: 'account-1',
      screensOnly: true,
      visibleAccountIds: ['account-1', 'account-2'],
    })

    const firstCard = elements.cards.get('account-1')!
    const secondCard = elements.cards.get('account-2')!
    const containerToggle = vi.spyOn(container.classList, 'toggle')
    const firstCardToggle = vi.spyOn(firstCard.classList, 'toggle')
    const secondCardToggle = vi.spyOn(secondCard.classList, 'toggle')
    const firstSetAttribute = vi.spyOn(firstCard, 'setAttribute')
    const secondSetAttribute = vi.spyOn(secondCard, 'setAttribute')
    const firstRemoveAttribute = vi.spyOn(firstCard, 'removeAttribute')
    const secondRemoveAttribute = vi.spyOn(secondCard, 'removeAttribute')
    const appendCount = container.appendCount

    manager.applyPresentation({
      layout: 'GRID-1X1',
      maximizedAccountId: 'account-1',
      screensOnly: true,
      visibleAccountIds: ['account-2', 'account-1'],
    })

    expect(containerToggle).not.toHaveBeenCalled()
    expect(firstCardToggle).not.toHaveBeenCalled()
    expect(secondCardToggle).not.toHaveBeenCalled()
    expect(firstSetAttribute).not.toHaveBeenCalled()
    expect(secondSetAttribute).not.toHaveBeenCalled()
    expect(firstRemoveAttribute).not.toHaveBeenCalled()
    expect(secondRemoveAttribute).not.toHaveBeenCalled()
    expect(container.appendCount).toBe(appendCount)
  })

  it('maximizes by mutating classes without detaching any surface', () => {
    const container = new FakeElement()
    const elements = fakeFactory()
    const manager = new SessionSurfaceManager(
      asElement(container),
      elements.factory,
    )
    const first = manager.ensure('account-1')
    const second = manager.ensure('account-2')
    const firstCard = elements.cards.get('account-1')!
    const secondCard = elements.cards.get('account-2')!

    manager.setMaximized('account-1')

    expect(firstCard.classList.contains('is-maximized')).toBe(true)
    expect(firstCard.classList.contains('is-suppressed')).toBe(false)
    expect(secondCard.classList.contains('is-suppressed')).toBe(true)
    expect(secondCard.attributes.get('aria-hidden')).toBe('true')
    expect((first.card as unknown as FakeElement).parent).toBe(container)
    expect((second.card as unknown as FakeElement).parent).toBe(container)
    expect((first.surface as unknown as FakeElement).parent).toBe(firstCard)
    expect((second.surface as unknown as FakeElement).parent).toBe(secondCard)

    manager.setMaximized(null)

    expect(secondCard.classList.contains('is-suppressed')).toBe(false)
    expect(secondCard.attributes.has('aria-hidden')).toBe(false)
  })

  it('paginates by hiding cards without detaching their surfaces', () => {
    const container = new FakeElement()
    const elements = fakeFactory()
    const manager = new SessionSurfaceManager(
      asElement(container),
      elements.factory,
    )
    const first = manager.ensure('account-1')
    const second = manager.ensure('account-2')
    const appendCount = container.appendCount

    manager.applyPresentation({
      layout: 'grid-1x1',
      maximizedAccountId: null,
      screensOnly: false,
      visibleAccountIds: ['account-1'],
    })
    expect(elements.cards.get('account-1')?.classList.contains('is-suppressed')).toBe(false)
    expect(elements.cards.get('account-2')?.classList.contains('is-suppressed')).toBe(true)

    manager.applyPresentation({
      layout: 'grid-1x1',
      maximizedAccountId: null,
      screensOnly: false,
      visibleAccountIds: ['account-2'],
    })
    expect(elements.cards.get('account-1')?.classList.contains('is-suppressed')).toBe(true)
    expect(elements.cards.get('account-2')?.classList.contains('is-suppressed')).toBe(false)
    expect(manager.get('account-1')?.surface).toBe(first.surface)
    expect(manager.get('account-2')?.surface).toBe(second.surface)
    expect(container.appendCount).toBe(appendCount)
  })

  it('removes nodes only when a session is explicitly removed or cleared', () => {
    const container = new FakeElement()
    const elements = fakeFactory()
    const manager = new SessionSurfaceManager(
      asElement(container),
      elements.factory,
    )
    const first = manager.ensure('account-1')
    const second = manager.ensure('account-2')
    manager.setMaximized('account-1')

    expect(manager.remove('account-1')).toBe(true)
    expect(manager.remove('missing')).toBe(false)
    expect(manager.has('account-1')).toBe(false)
    expect((first.card as unknown as FakeElement).parent).toBeNull()
    expect((second.card as unknown as FakeElement).parent).toBe(container)
    expect(manager.getMaximizedAccountId()).toBeNull()

    manager.clear()

    expect(manager.size).toBe(0)
    expect((second.card as unknown as FakeElement).parent).toBeNull()
    expect(container.children).toEqual([])
  })

  it('validates a full presentation before changing existing state', () => {
    const container = new FakeElement()
    const elements = fakeFactory()
    const manager = new SessionSurfaceManager(
      asElement(container),
      elements.factory,
    )
    manager.ensure('account-1')
    manager.setLayout('columns')
    manager.setScreensOnly(true)

    expect(() => manager.applyPresentation({
      layout: 'rows',
      maximizedAccountId: 'missing',
      screensOnly: false,
    })).toThrow(RangeError)
    expect(manager.getLayout()).toBe('columns')
    expect(manager.isScreensOnly()).toBe(true)
  })
})
