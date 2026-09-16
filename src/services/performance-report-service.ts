import type { DesktopDiagnostics } from '../../electron/contracts'

// A small local ring buffer, not telemetry. Never retain account/profile data.
export class PerformanceReportService {
  private readonly samples: DesktopDiagnostics[] = []

  capture(report: DesktopDiagnostics): void {
    this.samples.push({
      generatedAt: report.generatedAt, version: report.version,
      platform: report.platform, uptimeSeconds: report.uptimeSeconds,
      performanceMode: report.performanceMode,
      activeSession: typeof report.activeSession === 'string' && /^Session [1-9]\d*$/.test(report.activeSession)
        ? report.activeSession : null,
      performanceDebugEnabled: report.performanceDebugEnabled,
      ipc: report.ipc?.map((item) => ({ ...item })),
      totals: report.totals ? { ...report.totals } : undefined,
      processes: report.processes.map((process) => ({
        pid: process.pid, type: process.type, name: process.name,
        serviceName: process.serviceName, classification: process.classification,
        cpuPercent: process.cpuPercent, idleWakeupsPerSecond: process.idleWakeupsPerSecond,
        privateKb: process.privateKb, workingSetKb: process.workingSetKb,
        peakWorkingSetKb: process.peakWorkingSetKb,
      })),
      sessions: report.sessions.map((session, index) => ({
        label: `Session ${index + 1}`, status: session.status,
        visible: session.visible, frameRate: session.frameRate,
        pid: session.pid, visualState: session.visualState,
        parked: session.parked, attached: session.attached,
        parkingStrategy: session.parkingStrategy,
        parkingFallbackReason: session.parkingFallbackReason,
        detachedDurationMs: session.detachedDurationMs,
        processRecreated: session.processRecreated,
        unexpectedNavigation: session.unexpectedNavigation,
        muted: session.muted, requestedMuted: session.requestedMuted,
        backgroundThrottling: session.backgroundThrottling,
        imageAnimationPolicy: session.imageAnimationPolicy,
        profileId: session.profileId, performanceMode: session.performanceMode,
      })),
    })
    // At the 2-second DEV interval this is ten minutes; production's slower
    // interval retains longer history without unbounded growth.
    if (this.samples.length > 300) this.samples.shift()
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
