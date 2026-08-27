import { describe, expect, it } from 'vitest'

import {
  GRID_MODES,
  GridLayoutService,
  type ConcreteGridMode,
  type GridArea,
} from './grid-layout-service'

const landscape: GridArea = {
  height: 900,
  width: 1600,
  x: 0,
  y: 0,
}

function service(advancedGrids = false): GridLayoutService {
  return new GridLayoutService({
    canUseFeature: (featureKey) =>
      featureKey === 'advanced_grids' && advancedGrids,
  })
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `session-${index + 1}`)
}

function resolveMode(
  sessionCount: number,
  options: {
    advancedGrids?: boolean
    area?: GridArea
    previousAutoMode?: ConcreteGridMode
  } = {},
): ConcreteGridMode {
  const result = service(options.advancedGrids).resolve({
    area: options.area ?? landscape,
    mode: 'auto',
    previousAutoMode: options.previousAutoMode,
    sessionIds: ids(sessionCount),
  })

  if (!result.ok) {
    throw new Error(`Unexpected grid error: ${result.reason}`)
  }

  return result.layout.resolvedMode
}

describe('GridLayoutService', () => {
  it('uses the columns x rows convention for every fixed preset', () => {
    const expected = {
      '1x1': [1, 1, 1],
      '1x2': [1, 2, 2],
      '2x1': [2, 1, 2],
      '2x2': [2, 2, 4],
      '3x2': [3, 2, 6],
      '3x3': [3, 3, 9],
    } as const
    const layouts = service(true)

    for (const mode of GRID_MODES) {
      if (mode === 'auto') {
        continue
      }

      const result = layouts.resolve({
        area: landscape,
        mode,
        sessionIds: [],
      })

      expect(result.ok).toBe(true)

      if (result.ok) {
        expect([
          result.layout.columns,
          result.layout.rows,
          result.layout.capacity,
        ]).toEqual(expected[mode])
      }
    }
  })

  it('selects automatic basic layouts by session count and area proportion', () => {
    expect(resolveMode(0)).toBe('1x1')
    expect(resolveMode(1)).toBe('1x1')
    expect(resolveMode(2)).toBe('2x1')
    expect(resolveMode(2, {
      area: { height: 1600, width: 900, x: 0, y: 0 },
    })).toBe('1x2')
    expect(resolveMode(3)).toBe('2x2')
    expect(resolveMode(4)).toBe('2x2')
  })

  it('uses advanced automatic layouts only when advanced_grids is available', () => {
    expect(resolveMode(5, { advancedGrids: true })).toBe('3x2')
    expect(resolveMode(6, { advancedGrids: true })).toBe('3x2')
    expect(resolveMode(7, { advancedGrids: true })).toBe('3x3')
    expect(resolveMode(9, { advancedGrids: true })).toBe('3x3')
    expect(resolveMode(5, { advancedGrids: false })).toBe('2x2')
  })

  it('marks 3x2 and 3x3 unavailable without advanced_grids', () => {
    const layouts = service(false)
    const availability = new Map(
      layouts.listModes().map((item) => [item.mode, item]),
    )

    expect(availability.get('auto')?.available).toBe(true)
    expect(availability.get('2x2')?.available).toBe(true)
    expect(availability.get('3x2')).toMatchObject({
      available: false,
      requiredFeature: 'advanced_grids',
    })
    expect(availability.get('3x3')).toMatchObject({
      available: false,
      requiredFeature: 'advanced_grids',
    })
    expect(layouts.resolve({
      area: landscape,
      mode: '3x2',
      sessionIds: ids(2),
    })).toEqual({
      ok: false,
      reason: 'advanced_grids_required',
      requestedMode: '3x2',
    })
  })

  it('expands Auto dynamically beyond 3x3 and paginates a basic fallback safely', () => {
    const result = service(true).resolve({
      area: landscape,
      mode: 'auto',
      sessionIds: ids(10),
    })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.layout.resolvedMode).toBe('3x3')
      expect(result.layout.pageCount).toBe(1)
      expect(result.layout.slots.map((slot) => slot.sessionId)).toEqual(ids(10))
      expect(result.layout.overflowSessionIds).toEqual([])
      expect(result.layout.columns * result.layout.rows).toBeGreaterThanOrEqual(10)
    }

    const basic = service(false).resolve({
      area: landscape,
      mode: 'auto',
      sessionIds: ids(5),
    })

    expect(basic.ok).toBe(true)
    if (basic.ok) {
      expect(basic.layout.resolvedMode).toBe('2x2')
      expect(basic.layout.pageCount).toBe(2)
      expect(basic.layout.overflowSessionIds).toEqual(['session-5'])
    }
  })

  it('keeps dynamic Auto balanced for prime session counts', () => {
    const result = service(true).resolve({
      area: landscape,
      mode: 'auto',
      sessionIds: ids(11),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.layout.columns).toBeLessThan(11)
      expect(result.layout.rows).toBeGreaterThan(1)
      expect(result.layout.pageCount).toBe(1)
    }
  })

  it('clamps an out-of-range page and preserves stable session order', () => {
    const original = ids(5)
    const result = service(false).resolve({
      area: landscape,
      mode: '2x2',
      pageIndex: 99,
      sessionIds: original,
    })

    expect(result.ok).toBe(true)
    expect(original).toEqual(ids(5))

    if (result.ok) {
      expect(result.layout.pageIndex).toBe(1)
      expect(result.layout.slots).toEqual([
        expect.objectContaining({ index: 4, sessionId: 'session-5' }),
      ])
      expect(result.layout.overflowSessionIds).toEqual(ids(4))
    }
  })

  it('creates gap-aware bounds without overlap or uncovered edge pixels', () => {
    const result = service(false).resolve({
      area: { height: 503, width: 1001, x: -100, y: 20 },
      gap: 7,
      mode: '2x2',
      sessionIds: ids(4),
    })

    expect(result.ok).toBe(true)

    if (result.ok) {
      const [topLeft, topRight, bottomLeft, bottomRight] = result.layout.slots

      expect(topLeft?.bounds.x).toBe(-100)
      expect(topLeft?.bounds.y).toBe(20)
      expect((topLeft?.bounds.x ?? 0) + (topLeft?.bounds.width ?? 0) + 7)
        .toBe(topRight?.bounds.x)
      expect((topLeft?.bounds.y ?? 0) + (topLeft?.bounds.height ?? 0) + 7)
        .toBe(bottomLeft?.bounds.y)
      expect((topRight?.bounds.x ?? 0) + (topRight?.bounds.width ?? 0))
        .toBe(901)
      expect((bottomRight?.bounds.y ?? 0) + (bottomRight?.bounds.height ?? 0))
        .toBe(523)
    }
  })

  it('falls back to safe 3x3 pagination when a tiny area cannot fit a larger dynamic grid', () => {
    const result = service(true).resolve({
      area: { height: 23, width: 23, x: 0, y: 0 },
      gap: 10,
      mode: 'auto',
      sessionIds: ids(10),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.layout.pageCount).toBe(2)
      expect(result.layout.overflowSessionIds).toEqual(['session-10'])
      expect(result.layout.slots.every((slot) =>
        slot.bounds.width > 0 && slot.bounds.height > 0)).toBe(true)
    }
  })

  it('keeps the previous equivalent auto orientation within hysteresis', () => {
    const almostSquare = { height: 1000, width: 1030, x: 0, y: 0 }

    expect(resolveMode(2, { area: almostSquare })).toBe('2x1')
    expect(resolveMode(2, {
      area: almostSquare,
      previousAutoMode: '1x2',
    })).toBe('1x2')
    expect(resolveMode(2, {
      area: landscape,
      previousAutoMode: '1x2',
    })).toBe('2x1')
  })

  it.each([
    { height: 100, width: 0, x: 0, y: 0 },
    { height: -1, width: 100, x: 0, y: 0 },
    { height: 100, width: Number.NaN, x: 0, y: 0 },
    { height: 100, width: Number.POSITIVE_INFINITY, x: 0, y: 0 },
  ])('rejects an invalid layout area: %o', (area) => {
    expect(service().resolve({
      area,
      mode: 'auto',
      sessionIds: ids(2),
    })).toMatchObject({ ok: false, reason: 'invalid_area' })
  })

  it('reacts immediately when advanced_grids is upgraded or downgraded', () => {
    let advancedGrids = false
    const layouts = new GridLayoutService({
      canUseFeature: () => advancedGrids,
    })
    const input = {
      area: landscape,
      mode: '3x3' as const,
      sessionIds: ids(7),
    }

    expect(layouts.resolve(input)).toMatchObject({
      ok: false,
      reason: 'advanced_grids_required',
    })
    advancedGrids = true
    expect(layouts.resolve(input)).toMatchObject({
      layout: { resolvedMode: '3x3' },
      ok: true,
    })
    advancedGrids = false
    expect(layouts.resolve(input)).toMatchObject({
      ok: false,
      reason: 'advanced_grids_required',
    })
  })
})
