import { describe, expect, it } from 'vitest'
import { PerformanceReportService } from './performance-report-service'
import type { DesktopDiagnostics } from '../../electron/contracts'

describe('local performance report', () => {
  const fixture: DesktopDiagnostics = {
    generatedAt: '2026-09-15T00:00:00Z', version: 'test', platform: 'linux', uptimeSeconds: 60,
    processes: [{ type: 'GPU', cpuPercent: 2, privateKb: 1000 }],
    sessions: [{ label: 'private nickname', status: 'ready', visible: true, frameRate: 20 }],
  }

  it('keeps only 60 snapshots and excludes unexpected sensitive fields', () => {
    const service = new PerformanceReportService()
    for (let index = 0; index < 1000; index++) {
      service.capture({ ...fixture, uptimeSeconds: index, token: 'secret' } as DesktopDiagnostics)
    }
    const report = service.exportReport()
    expect(report.samples).toHaveLength(300)
    expect(report.samples[0]?.uptimeSeconds).toBe(700)
    expect(service.summary()).toEqual({ privateKb: 1000, gpuKb: 1000, cpuPercent: 2, peakPrivateKb: 1000, sampleCount: 300 })
    expect(JSON.stringify(report)).not.toContain('secret')
    expect(JSON.stringify(report)).not.toContain('private nickname')
    report.samples.length = 0
    expect(service.exportReport().samples).toHaveLength(300)
    service.clear()
    expect(service.exportReport().samples).toHaveLength(0)
  })

  it('keeps bounded local samples and replaces incoming account labels', () => {
    const history = new PerformanceReportService()
    for (let index = 0; index < 301; index++) {
      history.capture({
        generatedAt: `sample-${index}`, version: '1.7.0', platform: 'win32',
        uptimeSeconds: index, performanceMode: 'ultra',
        performanceDebugEnabled: true, activeSession: 'Session 1',
        processes: [{ pid: 42, type: 'renderer', cpuPercent: 3, privateKb: 100 }],
        sessions: [{ label: 'private account nickname', status: 'ready',
          visible: true, frameRate: 30, pid: 42, visualState: 'ACTIVE' }],
      })
    }
    const result = history.exportReport()
    expect(result.samples).toHaveLength(300)
    expect(result.samples[0]?.generatedAt).toBe('sample-1')
    expect(result.samples.at(-1)?.sessions[0]?.label).toBe('Session 1')
    expect(JSON.stringify(result)).not.toContain('private account nickname')
  })
})
