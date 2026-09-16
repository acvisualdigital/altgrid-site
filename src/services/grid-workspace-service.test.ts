import { describe, expect, it } from 'vitest'

import type { ConfiguredAccount } from './configured-account-service'
import { GridWorkspaceService } from './grid-workspace-service'

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('GridWorkspaceService', () => {
  it('creates, edits and removes a named grid', () => {
    const service = new GridWorkspaceService({ createId: () => 'grid-1', now: () => new Date('2026-08-31T10:00:00Z'), storage: memoryStorage() })
    const created = service.save('user-1', { name: '  Grade 1  ', accountIds: ['a', 'a', 'b'] })
    expect(created).toMatchObject({ id: 'grid-1', name: 'Grade 1', accountIds: ['a', 'b'], layoutMode: 'auto' })
    expect(service.save('user-1', { id: 'grid-1', name: 'Principal', accountIds: ['b'] })).toMatchObject({ name: 'Principal', accountIds: ['b'] })
    expect(service.remove('user-1', 'grid-1')).toBe(true)
    expect(service.list('user-1')).toEqual([])
  })

  it('stores an independent layout for each saved grid', () => {
    let sequence = 0
    const storage = memoryStorage()
    const service = new GridWorkspaceService({
      createId: () => `grid-${++sequence}`,
      now: () => new Date('2026-09-16T10:00:00Z'),
      storage,
    })
    const first = service.save('user-1', {
      name: 'Grade 1', accountIds: ['a', 'b'], layoutMode: '2x1',
    })!
    const second = service.save('user-1', {
      name: 'Grade 2', accountIds: ['c', 'd'], layoutMode: '1x2',
    })!

    service.setLayout('user-1', first.id, '2x2')

    expect(service.list('user-1')).toEqual([
      expect.objectContaining({ id: first.id, layoutMode: '2x2' }),
      expect.objectContaining({ id: second.id, layoutMode: '1x2' }),
    ])
  })

  it('removes stale account ids when valid ids are supplied', () => {
    const service = new GridWorkspaceService({ createId: () => 'grid-1', storage: memoryStorage() })
    service.save('user-1', { name: 'Grade', accountIds: ['open', 'deleted'] })
    expect(service.list('user-1', ['open']).at(0)?.accountIds).toEqual(['open'])
  })

  it('migrates saved grids created before per-grid layouts', () => {
    const storage = memoryStorage()
    storage.setItem('altgrid.saved-grids.v1:user-1', JSON.stringify([{
      id: 'legacy', name: 'Grade antiga', accountIds: ['a'],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }]))
    const service = new GridWorkspaceService({ storage })
    expect(service.list('user-1')).toEqual([
      expect.objectContaining({ id: 'legacy', layoutMode: 'auto' }),
    ])
  })

  it('creates one grid per game without duplicating it', () => {
    let sequence = 0
    const service = new GridWorkspaceService({ createId: () => `grid-${++sequence}`, storage: memoryStorage() })
    const accounts = [
      { id: 'a', gameSlug: 'huntera', displayName: 'A', createdAt: '' },
      { id: 'b', gameSlug: 'huntera', displayName: 'B', createdAt: '' },
      { id: 'c', gameSlug: 'stonegy', displayName: 'C', createdAt: '' },
    ] satisfies ConfiguredAccount[]
    expect(service.createForGames('user-1', accounts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'huntera', accountIds: ['a', 'b'] }),
      expect.objectContaining({ name: 'stonegy', accountIds: ['c'] }),
    ]))
    expect(service.createForGames('user-1', accounts)).toHaveLength(2)
  })
})
