import type { DesktopDiagnostics } from '../../electron/contracts'

// A small local ring buffer, not telemetry. Never retain account/profile data.
export class PerformanceReportService {
  private readonly samples: DesktopDiagnostics[] = []

  capture(report: DesktopDiagnostics): void {
    this.samples.push({
      generatedAt: report.generatedAt, version: report.version,
      platform: report.platform, uptimeSeconds: report.uptimeSeconds,
      processes: report.processes.map((process) => ({
        type: process.type, cpuPercent: process.cpuPercent, privateKb: process.privateKb,
      })),
      sessions: report.sessions.map((session, index) => ({
        label: `Session ${index + 1}`, status: session.status,
        visible: session.visible, frameRate: session.frameRate,
      })),
    })
    if (this.samples.length > 60) this.samples.shift()
  }

  exportReport(): { schemaVersion: 1; samples: DesktopDiagnostics[] } {
    return { schemaVersion: 1, samples: structuredClone(this.samples) }
  }

  summary(): { privateKb: number; gpuKb: number; cpuPercent: number; peakPrivateKb: number; sampleCount: number } {
    const latest = this.samples.at(-1)
    return {
      privateKb: latest?.processes.reduce((sum, process) => sum + process.privateKb, 0) ?? 0,
      gpuKb: latest?.processes.filter((process) => /gpu/i.test(process.type))
        .reduce((sum, process) => sum + process.privateKb, 0) ?? 0,
      cpuPercent: latest?.processes.reduce((sum, process) => sum + process.cpuPercent, 0) ?? 0,
      peakPrivateKb: Math.max(0, ...this.samples.map((sample) => sample.processes.reduce((sum, process) => sum + process.privateKb, 0))),
      sampleCount: this.samples.length,
    }
  }

  clear(): void { this.samples.length = 0 }
}
