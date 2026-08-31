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
    expect(created).toMatchObject({ id: 'grid-1', name: 'Grade 1', accountIds: ['a', 'b'] })
    expect(service.save('user-1', { id: 'grid-1', name: 'Principal', accountIds: ['b'] })).toMatchObject({ name: 'Principal', accountIds: ['b'] })
    expect(service.remove('user-1', 'grid-1')).toBe(true)
    expect(service.list('user-1')).toEqual([])
  })

  it('removes stale account ids when valid ids are supplied', () => {
    const service = new GridWorkspaceService({ createId: () => 'grid-1', storage: memoryStorage() })
    service.save('user-1', { name: 'Grade', accountIds: ['open', 'deleted'] })
    expect(service.list('user-1', ['open']).at(0)?.accountIds).toEqual(['open'])
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
