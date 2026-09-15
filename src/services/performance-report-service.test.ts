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
    expect(report.samples).toHaveLength(60)
    expect(report.samples[0]?.uptimeSeconds).toBe(940)
    expect(service.summary()).toEqual({ privateKb: 1000, gpuKb: 1000, cpuPercent: 2, peakPrivateKb: 1000, sampleCount: 60 })
    expect(JSON.stringify(report)).not.toContain('secret')
    expect(JSON.stringify(report)).not.toContain('private nickname')
    report.samples.length = 0
    expect(service.exportReport().samples).toHaveLength(60)
    service.clear()
    expect(service.exportReport().samples).toHaveLength(0)
  })
})
