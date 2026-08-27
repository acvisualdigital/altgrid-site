import { describe, expect, it, vi } from 'vitest'

import type { PlanCode } from '../types/database'
import type { ResolvedEntitlements } from '../types/backend-api'
import {
  PermissionService,
  SessionCancellationCleanupError,
} from './permission-service'

function plan(
  code: PlanCode,
  accountLimit: number,
  features: Record<string, boolean> = {},
): ResolvedEntitlements {
  return {
    account_limit: accountLimit,
    expires_at: null,
    features,
    founder_number: code === 'FOUNDER' ? 12 : null,
    lifetime: code === 'FOUNDER',
    plan: code,
  }
}

function deferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('PermissionService session limits', () => {
  it('opens two FREE sessions and blocks the third', async () => {
    const service = new PermissionService(plan('FREE', 2))

    await expect(service.openSession('account-1', vi.fn())).resolves.toBe('opened')
    await expect(service.openSession('account-2', vi.fn())).resolves.toBe('opened')
    await expect(service.openSession('account-3', vi.fn())).resolves.toBe(
      'limit_reached',
    )

    expect(service.getCurrentPlan()).toBe('FREE')
    expect(service.getActiveSessionCount()).toBe(2)
    expect(service.canOpenAnotherSession()).toBe(false)
  })

  it('allows three FREE sessions when opening Huntera and only two for other games', async () => {
    const huntera = new PermissionService(plan('FREE', 2))

    for (let index = 1; index <= 3; index += 1) {
      await expect(
        huntera.openSession(
          `huntera-${index}`,
          vi.fn(),
          undefined,
          undefined,
          'huntera',
        ),
      ).resolves.toBe('opened')
    }
    await expect(
      huntera.openSession('huntera-4', vi.fn(), undefined, undefined, 'huntera'),
    ).resolves.toBe('limit_reached')

    const otherGames = new PermissionService(plan('FREE', 2))
    await otherGames.openSession('tibia-1', vi.fn(), undefined, undefined, 'tibia')
    await otherGames.openSession('poke-1', vi.fn(), undefined, undefined, 'poke-idle-world')
    await expect(
      otherGames.openSession('tibia-2', vi.fn(), undefined, undefined, 'tibia'),
    ).resolves.toBe('limit_reached')
  })

  it('uses the configured PRO limit instead of a hardcoded plan condition', async () => {
    const service = new PermissionService(plan('PRO', 10))

    for (let index = 1; index <= 10; index += 1) {
      await expect(
        service.openSession('account-' + index, vi.fn()),
      ).resolves.toBe('opened')
    }

    expect(service.getActiveSessionCount()).toBe(10)
    expect(service.canOpenAnotherSession()).toBe(false)
    await expect(service.openSession('account-11', vi.fn())).resolves.toBe(
      'limit_reached',
    )
  })

  it('uses FOUNDER limits and features from resolved entitlements', async () => {
    const service = new PermissionService(
      plan('FOUNDER', 20, { extended_screens: true }),
    )

    for (let index = 1; index <= 20; index += 1) {
      await service.openSession('founder-' + index, vi.fn())
    }

    expect(service.getCurrentPlan()).toBe('FOUNDER')
    expect(service.getAccountLimit()).toBe(20)
    expect(service.getActiveSessionCount()).toBe(20)
    expect(service.canUseFeature('extended_screens')).toBe(true)
    await expect(service.openSession('founder-21', vi.fn())).resolves.toBe(
      'limit_reached',
    )
  })

  it('does not close sessions or delete state after a downgrade', async () => {
    const service = new PermissionService(plan('PRO', 10))

    for (let index = 1; index <= 7; index += 1) {
      await service.openSession('account-' + index, vi.fn())
    }

    service.updateEntitlements(plan('FREE', 2))

    expect(service.getCurrentPlan()).toBe('FREE')
    expect(service.getActiveSessionCount()).toBe(7)
    expect(service.canOpenAnotherSession()).toBe(false)
    await expect(service.openSession('account-8', vi.fn())).resolves.toBe(
      'limit_reached',
    )

    await service.closeSession('account-7')
    expect(service.getActiveSessionCount()).toBe(6)
  })

  it('allows more sessions immediately after an upgrade', async () => {
    const service = new PermissionService(plan('FREE', 2))
    await service.openSession('account-1', vi.fn())
    await service.openSession('account-2', vi.fn())

    service.updateEntitlements(plan('PRO', 10))

    await expect(service.openSession('account-3', vi.fn())).resolves.toBe(
      'opened',
    )
  })

  it('reserves the last slot while an asynchronous opening is pending', async () => {
    const service = new PermissionService(plan('FREE', 1))
    const gate = deferred()
    const firstOpening = service.openSession('account-1', () => gate.promise)

    await expect(service.openSession('account-2', vi.fn())).resolves.toBe(
      'limit_reached',
    )
    gate.resolve()
    await expect(firstOpening).resolves.toBe('opened')
    expect(service.getActiveSessionCount()).toBe(1)
  })

  it('focuses an already open account without consuming another slot', async () => {
    const service = new PermissionService(plan('FREE', 2))
    const focus = vi.fn()
    await service.openSession('account-1', vi.fn())

    await expect(
      service.openSession('account-1', vi.fn(), focus),
    ).resolves.toBe('already_open')

    expect(focus).toHaveBeenCalledOnce()
    expect(service.getActiveSessionCount()).toBe(1)
  })

  it('cancels and closes an opening that finishes after restart or logout', async () => {
    const service = new PermissionService(plan('PRO', 10))
    const gate = deferred()
    const closeCancelled = vi.fn()
    const opening = service.openSession(
      'account-1',
      () => gate.promise,
      undefined,
      closeCancelled,
    )

    service.resetForRestart()
    gate.resolve()

    await expect(opening).resolves.toBe('cancelled')
    expect(closeCancelled).toHaveBeenCalledOnce()
    expect(service.getActiveSessionCount()).toBe(0)
  })

  it('identifies a failed compensating close after an opening is cancelled', async () => {
    const service = new PermissionService(plan('PRO', 10))
    const gate = deferred()
    const cleanupFailure = new Error('native close failed')
    const opening = service.openSession(
      'account-1',
      () => gate.promise,
      undefined,
      () => Promise.reject(cleanupFailure),
    )

    service.resetForRestart()
    gate.resolve()

    await expect(opening).rejects.toBeInstanceOf(
      SessionCancellationCleanupError,
    )
    await expect(opening).rejects.toMatchObject({ cause: cleanupFailure })
  })

  it('starts with no open sessions on the next application cycle', async () => {
    const service = new PermissionService(plan('FREE', 2))
    await service.openSession('account-1', vi.fn())
    await service.openSession('account-2', vi.fn())

    service.resetForRestart()

    expect(service.getActiveSessionCount()).toBe(0)
    expect(service.canOpenAnotherSession()).toBe(true)
  })

  it('keeps a slot occupied until an asynchronous close really finishes', async () => {
    const service = new PermissionService(plan('FREE', 1))
    const gate = deferred()
    const close = vi.fn(() => gate.promise)
    await service.openSession('account-1', vi.fn())

    const closing = service.closeSession('account-1', close)

    expect(service.getActiveSessionCount()).toBe(1)
    expect(service.canOpenAnotherSession()).toBe(false)
    await expect(service.openSession('account-1', vi.fn())).resolves.toBe(
      'already_closing',
    )
    await expect(service.openSession('account-2', vi.fn())).resolves.toBe(
      'limit_reached',
    )

    gate.resolve()
    await closing

    expect(close).toHaveBeenCalledOnce()
    expect(service.getActiveSessionCount()).toBe(0)
    await expect(service.openSession('account-2', vi.fn())).resolves.toBe(
      'opened',
    )
  })

  it('reports only fully opened session ids without duplicating an active account', async () => {
    const service = new PermissionService(plan('PRO', 10))
    const gate = deferred()
    const opening = service.openSession('account-1', () => gate.promise)

    expect(service.getActiveSessionIds()).toEqual([])

    gate.resolve()
    await expect(opening).resolves.toBe('opened')
    await expect(service.openSession('account-1', vi.fn())).resolves.toBe(
      'already_open',
    )
    await expect(service.openSession('account-2', vi.fn())).resolves.toBe(
      'opened',
    )

    expect(service.getActiveSessionIds()).toEqual(['account-1', 'account-2'])
  })

  it('returns isolated id snapshots and reflects close and restart lifecycle', async () => {
    const service = new PermissionService(plan('PRO', 10))
    const closeGate = deferred()
    await service.openSession('account-1', vi.fn())
    await service.openSession('account-2', vi.fn())

    const snapshot = service.getActiveSessionIds()
    ;(snapshot as string[]).splice(0, snapshot.length, 'external-change')
    expect(service.getActiveSessionIds()).toEqual(['account-1', 'account-2'])

    const closing = service.closeSession('account-1', () => closeGate.promise)
    expect(service.getActiveSessionIds()).toEqual(['account-1', 'account-2'])

    closeGate.resolve()
    await closing
    expect(service.getActiveSessionIds()).toEqual(['account-2'])

    expect(service.resetForRestart()).toEqual(['account-2'])
    expect(service.getActiveSessionIds()).toEqual([])
    expect(service.getClosingSessionOperation('account-1')).toBeNull()
  })

  it('keeps an in-flight close observable while resetting session tracking', async () => {
    const service = new PermissionService(plan('PRO', 10))
    const closeGate = deferred()
    await service.openSession('account-1', vi.fn())
    await service.openSession('account-2', vi.fn())

    const closing = service.closeSession('account-1', () => closeGate.promise)
    const closeOperation = service.getClosingSessionOperation('account-1')

    expect(closeOperation).not.toBeNull()
    expect(service.resetForRestart()).toEqual(['account-1', 'account-2'])
    expect(service.getClosingSessionOperation('account-1')).toBe(closeOperation)

    closeGate.resolve()
    await closing
    expect(service.getClosingSessionOperation('account-1')).toBeNull()
  })
})
