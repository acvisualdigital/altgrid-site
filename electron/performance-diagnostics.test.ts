import { describe, expect, it } from 'vitest'
import type { ProcessMetric } from 'electron'
import { classifyProcessMetrics } from './performance-diagnostics.js'

function metric(pid: number, type: ProcessMetric['type'], privateKb: number, name?: string): ProcessMetric {
  return {
    pid, type, name, creationTime: 1,
    cpu: { percentCPUUsage: pid, idleWakeupsPerSecond: 2 },
    memory: { privateBytes: privateKb, workingSetSize: privateKb + 10, peakWorkingSetSize: privateKb + 20 },
  }
}

describe('performance diagnostics', () => {
  it('maps game PIDs before Chromium type and totals each category once', () => {
    const result = classifyProcessMetrics([
      metric(1, 'Browser', 100), metric(2, 'Tab', 200), metric(3, 'Tab', 300),
      metric(4, 'GPU', 400), metric(5, 'Utility', 500, 'Network Service'),
      metric(6, 'Unknown', 600),
    ], new Set([3]), 1, 2)
    expect(result.processes.map((item) => item.classification)).toEqual([
      'ALTGRID_OVERHEAD', 'ALTGRID_OVERHEAD', 'GAME_RENDERER', 'GPU',
      'CHROMIUM_SERVICES', 'UNKNOWN',
    ])
    expect(result.processes.map((item) => item.role)).toEqual([
      'MAIN', 'SHELL', 'GAME', 'GPU', 'SERVICE', 'OTHER',
    ])
    expect(result.totals).toEqual({
      electronKb: 2100, altgridOverheadKb: 300, gameRenderersKb: 300,
      gpuKb: 400, chromiumServicesKb: 500, unknownKb: 600,
    })
  })
})
