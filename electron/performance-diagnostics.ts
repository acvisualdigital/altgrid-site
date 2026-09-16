import type { ProcessMetric } from 'electron'
import type { DesktopDiagnostics } from './contracts.js'

type DiagnosticProcess = DesktopDiagnostics['processes'][number]
type ProcessClassification = NonNullable<DiagnosticProcess['classification']>

export function classifyProcessMetrics(
  metrics: ProcessMetric[],
  gamePids: ReadonlySet<number>,
  mainPid: number,
  shellPid: number | null,
): { processes: DiagnosticProcess[]; totals: NonNullable<DesktopDiagnostics['totals']> } {
  const processes = metrics.map((metric): DiagnosticProcess => {
    const service = `${metric.name ?? ''} ${metric.serviceName ?? ''}`.toLowerCase()
    const classification: ProcessClassification = gamePids.has(metric.pid)
      ? 'GAME_RENDERER'
      : metric.type === 'GPU'
        ? 'GPU'
        : metric.pid === mainPid || metric.pid === shellPid
          ? 'ALTGRID_OVERHEAD'
          : metric.type === 'Utility' || /network|audio|video|storage/.test(service)
            ? 'CHROMIUM_SERVICES'
            : 'UNKNOWN'
    return {
      pid: metric.pid, type: metric.type, name: metric.name,
      serviceName: metric.serviceName, classification,
      role: metric.pid === mainPid ? 'MAIN'
        : metric.pid === shellPid ? 'SHELL'
          : gamePids.has(metric.pid) ? 'GAME'
            : metric.type === 'GPU' ? 'GPU'
              : classification === 'CHROMIUM_SERVICES' ? 'SERVICE' : 'OTHER',
      cpuPercent: metric.cpu.percentCPUUsage,
      idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond,
      privateKb: metric.memory.privateBytes ?? metric.memory.workingSetSize,
      workingSetKb: metric.memory.workingSetSize,
      peakWorkingSetKb: metric.memory.peakWorkingSetSize,
    }
  })
  const totalFor = (classification: ProcessClassification): number => processes
    .filter((item) => item.classification === classification)
    .reduce((sum, item) => sum + item.privateKb, 0)
  return {
    processes,
    totals: {
      electronKb: processes.reduce((sum, item) => sum + item.privateKb, 0),
      altgridOverheadKb: totalFor('ALTGRID_OVERHEAD'),
      gameRenderersKb: totalFor('GAME_RENDERER'), gpuKb: totalFor('GPU'),
      chromiumServicesKb: totalFor('CHROMIUM_SERVICES'), unknownKb: totalFor('UNKNOWN'),
    },
  }
}
