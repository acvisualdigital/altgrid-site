export const GRID_MODES = [
  'auto',
  '1x1',
  '1x2',
  '2x1',
  '2x2',
  '3x2',
  '3x3',
] as const

export type GridMode = (typeof GRID_MODES)[number]
export type ConcreteGridMode = Exclude<GridMode, 'auto'>

export interface GridFeatureAccess {
  canUseFeature(featureKey: string): boolean
}

export interface GridArea {
  height: number
  width: number
  x: number
  y: number
}

export interface GridSlot {
  bounds: GridArea
  column: number
  index: number
  row: number
  sessionId: string
}

export interface GridLayout {
  capacity: number
  columns: number
  overflowSessionIds: readonly string[]
  pageCount: number
  pageIndex: number
  requestedMode: GridMode
  resolvedMode: ConcreteGridMode
  rows: number
  slots: readonly GridSlot[]
}

export type GridResolution =
  | { layout: GridLayout; ok: true }
  | {
      ok: false
      reason: 'advanced_grids_required' | 'invalid_area' | 'invalid_mode'
      requestedMode: GridMode
    }

export interface GridModeAvailability {
  available: boolean
  mode: GridMode
  requiredFeature: 'advanced_grids' | null
}

export interface ResolveGridInput {
  area: GridArea
  gap?: number
  mode: GridMode
  pageIndex?: number
  previousAutoMode?: ConcreteGridMode
  sessionIds: readonly string[]
}

interface GridPreset {
  columns: number
  mode: ConcreteGridMode
  requiresAdvancedGrids: boolean
  rows: number
}

interface RankedPreset {
  aspectError: number
  capacityDifference: number
  pageCount: number
  preset: GridPreset
  tieOrder: number
}

const ADVANCED_GRID_FEATURE = 'advanced_grids'
const AUTO_HYSTERESIS = 0.12
const AUTO_MIN_CARD_WIDTH = 280
const AUTO_MIN_CARD_HEIGHT = 320
const AUTO_MAX_COLUMNS = 5
const AUTO_MAX_VIEWPORT_ROWS = 2

const PRESETS: Record<ConcreteGridMode, GridPreset> = {
  '1x1': {
    columns: 1,
    mode: '1x1',
    requiresAdvancedGrids: false,
    rows: 1,
  },
  '1x2': {
    columns: 1,
    mode: '1x2',
    requiresAdvancedGrids: false,
    rows: 2,
  },
  '2x1': {
    columns: 2,
    mode: '2x1',
    requiresAdvancedGrids: false,
    rows: 1,
  },
  '2x2': {
    columns: 2,
    mode: '2x2',
    requiresAdvancedGrids: false,
    rows: 2,
  },
  '3x2': {
    columns: 3,
    mode: '3x2',
    requiresAdvancedGrids: true,
    rows: 2,
  },
  '3x3': {
    columns: 3,
    mode: '3x3',
    requiresAdvancedGrids: true,
    rows: 3,
  },
}

const CONCRETE_MODES = Object.keys(PRESETS) as ConcreteGridMode[]

// Prefer a horizontal split for an exactly square area. Away from that tie,
// the aspect score selects the orientation that best matches the available area.
const AUTO_TIE_ORDER: readonly ConcreteGridMode[] = [
  '1x1',
  '2x1',
  '1x2',
  '2x2',
  '3x2',
  '3x3',
]

function isGridMode(value: string): value is GridMode {
  return (GRID_MODES as readonly string[]).includes(value)
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function isValidArea(area: GridArea): boolean {
  return isFiniteNumber(area.x)
    && isFiniteNumber(area.y)
    && isFiniteNumber(area.width)
    && isFiniteNumber(area.height)
    && area.width > 0
    && area.height > 0
}

function capacityOf(preset: GridPreset): number {
  return preset.columns * preset.rows
}

function pageCountFor(sessionCount: number, capacity: number): number {
  return Math.max(1, Math.ceil(sessionCount / capacity))
}

function hasUsableCells(
  area: GridArea,
  gap: number,
  preset: GridPreset,
): boolean {
  return area.width - gap * (preset.columns - 1) >= preset.columns
    && area.height - gap * (preset.rows - 1) >= preset.rows
}

function rankPreset(
  preset: GridPreset,
  sessionCount: number,
  areaAspect: number,
): RankedPreset {
  const capacity = capacityOf(preset)

  return {
    aspectError: Math.abs(
      Math.log((preset.columns / preset.rows) / areaAspect),
    ),
    capacityDifference: Math.abs(capacity - sessionCount),
    pageCount: pageCountFor(sessionCount, capacity),
    preset,
    tieOrder: AUTO_TIE_ORDER.indexOf(preset.mode),
  }
}

function compareRankedPresets(left: RankedPreset, right: RankedPreset): number {
  return left.pageCount - right.pageCount
    || left.capacityDifference - right.capacityDifference
    || left.aspectError - right.aspectError
    || left.tieOrder - right.tieOrder
}

function samePrimaryRank(left: RankedPreset, right: RankedPreset): boolean {
  return left.pageCount === right.pageCount
    && left.capacityDifference === right.capacityDifference
}

function normalizePageIndex(requested: number | undefined, pageCount: number): number {
  if (!Number.isInteger(requested) || requested === undefined) {
    return 0
  }

  return Math.min(Math.max(requested, 0), pageCount - 1)
}

function cellBounds(
  area: GridArea,
  gap: number,
  preset: GridPreset,
  column: number,
  row: number,
): GridArea {
  const usableWidth = area.width - gap * (preset.columns - 1)
  const usableHeight = area.height - gap * (preset.rows - 1)
  const leftOffset = Math.round(column * usableWidth / preset.columns)
  const rightOffset = Math.round((column + 1) * usableWidth / preset.columns)
  const topOffset = Math.round(row * usableHeight / preset.rows)
  const bottomOffset = Math.round((row + 1) * usableHeight / preset.rows)

  return {
    height: bottomOffset - topOffset,
    width: rightOffset - leftOffset,
    x: area.x + leftOffset + column * gap,
    y: area.y + topOffset + row * gap,
  }
}

export class GridLayoutService {
  constructor(private readonly permissions: GridFeatureAccess) {}

  listModes(): readonly GridModeAvailability[] {
    const advancedGrids = this.permissions.canUseFeature(ADVANCED_GRID_FEATURE)

    return GRID_MODES.map((mode) => {
      const requiresAdvanced = mode !== 'auto'
        && PRESETS[mode].requiresAdvancedGrids

      return {
        available: !requiresAdvanced || advancedGrids,
        mode,
        requiredFeature: requiresAdvanced ? ADVANCED_GRID_FEATURE : null,
      }
    })
  }

  isModeAvailable(mode: GridMode): boolean {
    if (mode === 'auto') {
      return true
    }

    return !PRESETS[mode].requiresAdvancedGrids
      || this.permissions.canUseFeature(ADVANCED_GRID_FEATURE)
  }

  resolve(input: ResolveGridInput): GridResolution {
    if (!isGridMode(input.mode)) {
      return {
        ok: false,
        reason: 'invalid_mode',
        requestedMode: input.mode,
      }
    }

    if (!isValidArea(input.area)) {
      return {
        ok: false,
        reason: 'invalid_area',
        requestedMode: input.mode,
      }
    }

    const gap = input.gap ?? 0

    if (!isFiniteNumber(gap) || gap < 0) {
      return {
        ok: false,
        reason: 'invalid_area',
        requestedMode: input.mode,
      }
    }

    if (input.mode !== 'auto' && !this.isModeAvailable(input.mode)) {
      return {
        ok: false,
        reason: 'advanced_grids_required',
        requestedMode: input.mode,
      }
    }

    const preset = input.mode === 'auto'
      ? this.resolveAutomaticPreset(input, gap)
      : PRESETS[input.mode]

    if (!preset || !hasUsableCells(input.area, gap, preset)) {
      return {
        ok: false,
        reason: 'invalid_area',
        requestedMode: input.mode,
      }
    }

    return {
      layout: this.createLayout(input, gap, preset),
      ok: true,
    }
  }

  private resolveAutomaticPreset(
    input: ResolveGridInput,
    gap: number,
  ): GridPreset | null {
    const sessionCount = input.sessionIds.length
    const areaAspect = input.area.width / input.area.height
    const ranked = CONCRETE_MODES
      .filter((mode) => this.isModeAvailable(mode))
      .map((mode) => PRESETS[mode])
      .filter((preset) => hasUsableCells(input.area, gap, preset))
      .map((preset) => rankPreset(preset, sessionCount, areaAspect))
      .sort(compareRankedPresets)
    const best = ranked[0]

    if (!best) {
      return null
    }

    if (input.previousAutoMode && this.isModeAvailable(input.previousAutoMode)) {
      const previous = ranked.find(
        (candidate) => candidate.preset.mode === input.previousAutoMode,
      )

      if (
        previous
        && samePrimaryRank(previous, best)
        && previous.aspectError <= best.aspectError + AUTO_HYSTERESIS
      ) {
        return previous.preset
      }
    }

    return best.preset
  }

  private createLayout(
    input: ResolveGridInput,
    gap: number,
    preset: GridPreset,
  ): GridLayout {
    const sessionIds = [...input.sessionIds]
    const effectivePreset = input.mode === 'auto'
      && preset.mode === '3x3'
      && sessionIds.length > capacityOf(preset)
      ? this.createDynamicPreset(input.area, sessionIds.length, gap, preset)
      : preset
    const capacity = capacityOf(effectivePreset)
    const pageCount = pageCountFor(sessionIds.length, capacity)
    const pageIndex = normalizePageIndex(input.pageIndex, pageCount)
    const firstIndex = pageIndex * capacity
    const lastIndex = firstIndex + capacity
    const visibleSessionIds = sessionIds.slice(firstIndex, lastIndex)
    const overflowSessionIds = [
      ...sessionIds.slice(0, firstIndex),
      ...sessionIds.slice(lastIndex),
    ]
    const slots = visibleSessionIds.map((sessionId, localIndex): GridSlot => {
      const column = localIndex % effectivePreset.columns
      const row = Math.floor(localIndex / effectivePreset.columns)

      return {
        bounds: cellBounds(input.area, gap, effectivePreset, column, row),
        column,
        index: firstIndex + localIndex,
        row,
        sessionId,
      }
    })

    return {
      capacity,
      columns: effectivePreset.columns,
      overflowSessionIds,
      pageCount,
      pageIndex,
      requestedMode: input.mode,
      resolvedMode: preset.mode,
      rows: effectivePreset.rows,
      slots,
    }
  }

  private createDynamicPreset(
    area: GridArea,
    sessionCount: number,
    gap: number,
    fallback: GridPreset,
  ): GridPreset {
    // Beyond 3x3, keep cards readable and let the workspace scroll vertically
    // instead of shrinking every live game surface indefinitely.
    const readableColumns = Math.min(
      AUTO_MAX_COLUMNS,
      Math.max(1, Math.floor((area.width + gap) / (AUTO_MIN_CARD_WIDTH + gap))),
    )
    const readableRows = Math.min(
      AUTO_MAX_VIEWPORT_ROWS,
      Math.max(1, Math.floor((area.height + gap) / (AUTO_MIN_CARD_HEIGHT + gap))),
    )
    const readablePreset: GridPreset = {
      columns: readableColumns,
      mode: '3x3',
      requiresAdvancedGrids: true,
      rows: readableRows,
    }

    if (hasUsableCells(area, gap, readablePreset)) {
      return readablePreset
    }

    const candidates = Array.from({ length: sessionCount }, (_, index) => index + 1)
      .filter((columns) => hasUsableCells(area, gap, {
        columns,
        mode: '3x3',
        requiresAdvancedGrids: true,
        rows: Math.ceil(sessionCount / columns),
      }))
    const columns = candidates.sort((left, right) => {
      const leftRows = Math.ceil(sessionCount / left)
      const rightRows = Math.ceil(sessionCount / right)
      const leftEmpty = left * leftRows - sessionCount
      const rightEmpty = right * rightRows - sessionCount
      const leftAspectError = Math.abs(Math.log((left / leftRows) / (area.width / area.height)))
      const rightAspectError = Math.abs(Math.log((right / rightRows) / (area.width / area.height)))

      return leftAspectError - rightAspectError || leftEmpty - rightEmpty
    })[0]

    if (!columns) {
      return fallback
    }

    return {
      columns,
      mode: '3x3',
      requiresAdvancedGrids: true,
      rows: Math.ceil(sessionCount / columns),
    }
  }
}
