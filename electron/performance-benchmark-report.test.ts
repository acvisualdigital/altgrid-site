import { describe, expect, it } from 'vitest'
import type { DesktopDiagnostics, PerformanceBenchmarkReport } from './contracts.js'
import { average, buildPerformanceBenchmarkArtifacts, growthMbPerMinute, median, percentile95, sanitizeBenchmarkReport, scenarioStats } from './performance-benchmark-report.js'

function sample(at: string, gameKb: number, cpu: number): DesktopDiagnostics {
  return {
    generatedAt: at, version: '1.7.0', platform: 'win32', uptimeSeconds: 1, performanceMode: 'ultra',
    activeSession: 'private-id', performanceDebugEnabled: true,
    processes: [
      { pid: 1, type: 'Browser', role: 'MAIN', classification: 'ALTGRID_OVERHEAD', cpuPercent: 1, privateKb: 100 },
      { pid: 2, type: 'Tab', role: 'SHELL', classification: 'ALTGRID_OVERHEAD', cpuPercent: 1, privateKb: 200 },
      { pid: 3, type: 'Tab', role: 'GAME', classification: 'GAME_RENDERER', cpuPercent: cpu, privateKb: gameKb },
      { pid: 4, type: 'GPU', role: 'GPU', classification: 'GPU', cpuPercent: 2, privateKb: 400 },
    ],
    sessions: [{ label: 'Secret nickname', accountId: 'secret-account', partition: 'persist:secret', origin: 'https://game.test/private?q=token', webContentsId: 50,
      status: 'ready', visible: true, frameRate: 10, pid: 3, visualState: 'BACKGROUND' }],
  }
}

const hardware = { cpuModel: 'CPU', logicalCores: 8, systemRamBytes: 16 * 1024 ** 3, os: 'Windows', gpuModel: 'GPU', electron: '44', chromium: 'x', node: 'y', altgrid: '1.7.0' }

describe('performance benchmark report', () => {
  it('calculates average, median, p95, delta and growth', () => {
    expect(average([1, 2, 3])).toBe(2)
    expect(median([1, 2, 8, 10])).toBe(5)
    expect(percentile95([1, 2, 3, 100])).toBe(100)
    expect(growthMbPerMinute(1_024, 2_048, 60)).toBe(1)
    const stats = scenarioStats({ id: 'A3', status: 'COMPLETED', configuration: { mode: 'ultra', parkingStrategy: 'ATTACHED_OFFSCREEN', backgroundThrottlingMode: 'compatibility' },
      startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z', warmupSeconds: 60, measurementSeconds: 60,
      samples: [sample('2026-01-01T00:00:00Z', 1_024, 2), sample('2026-01-01T00:01:00Z', 2_048, 4)], regressions: [], validation: { ok: true, categories: [] } })
    expect(stats.ramKb.delta).toBe(1_024)
    expect(stats.categories.GAME_RENDERER.ramKb.growthMbPerMinute).toBe(1)
  })

  it('redacts identity and creates JSON, CSV and all required Markdown sections', () => {
    const report: PerformanceBenchmarkReport = { schemaVersion: 1, createdAt: '2026-01-01T00:00:00Z', accountCount: 1, scenarios: [{
      id: 'A3', status: 'COMPLETED', configuration: { mode: 'ultra', parkingStrategy: 'ATTACHED_OFFSCREEN', backgroundThrottlingMode: 'compatibility' },
      startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z', warmupSeconds: 60, measurementSeconds: 60,
      samples: [sample('2026-01-01T00:00:00Z', 1_024, 2)], regressions: [], validation: { ok: true, categories: [] },
    }] }
    const sanitized = sanitizeBenchmarkReport(report)
    const serialized = JSON.stringify(sanitized)
    expect(serialized).not.toContain('Secret nickname')
    expect(serialized).not.toContain('secret-account')
    expect(serialized).not.toContain('game.test')
    expect(sanitized.scenarios[0]?.samples[0]?.sessions[0]?.label).toBe('Account 1')
    const artifacts = buildPerformanceBenchmarkArtifacts(report, hardware)
    expect(artifacts.csv).toContain('altgridKb,gamesKb,gpuKb')
    for (const title of ['## Baseline', '## Background Throttling', '## Detached Parking', '## Combined', '## Process Breakdown', '## Stability', '## User Validation', '## Recommendation Candidates']) {
      expect(artifacts.markdown).toContain(title)
    }
  })
})
