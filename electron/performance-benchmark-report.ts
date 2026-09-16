import type { DesktopDiagnostics, PerformanceBenchmarkReport } from './contracts.js'

export interface BenchmarkHardware {
  cpuModel: string
  logicalCores: number
  systemRamBytes: number
  os: string
  gpuModel: string | null
  electron: string
  chromium: string
  node: string
  altgrid: string
}

export function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}
export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
export function percentile95(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!
}
export function growthMbPerMinute(startKb: number, endKb: number, durationSeconds: number): number | null {
  return durationSeconds > 0 ? ((endKb - startKb) / 1024) / (durationSeconds / 60) : null
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function genericSample(sample: DesktopDiagnostics): DesktopDiagnostics {
  return {
    generatedAt: sample.generatedAt, version: sample.version, platform: sample.platform,
    uptimeSeconds: sample.uptimeSeconds, performanceMode: sample.performanceMode,
    activeSession: sample.activeSession, performanceDebugEnabled: true,
    shellBackgroundThrottling: sample.shellBackgroundThrottling,
    totals: sample.totals ? { ...sample.totals } : undefined,
    processes: sample.processes.map((process) => ({ ...process })),
    sessions: sample.sessions.map((session, index) => ({
      label: `Account ${index + 1}`, status: session.status, visible: session.visible,
      parked: session.parked, attached: session.attached,
      parkingStrategy: session.parkingStrategy,
      parkingFallbackReason: session.parkingFallbackReason,
      detachedDurationMs: session.detachedDurationMs,
      processRecreated: session.processRecreated,
      unexpectedNavigation: session.unexpectedNavigation,
      muted: session.muted, requestedMuted: session.requestedMuted,
      backgroundThrottling: session.backgroundThrottling,
      backgroundThrottlingApplyCount: session.backgroundThrottlingApplyCount,
      backgroundThrottlingLastReason: session.backgroundThrottlingLastReason,
      backgroundThrottlingLastAppliedAt: session.backgroundThrottlingLastAppliedAt,
      imageAnimationPolicy: session.imageAnimationPolicy, profileId: session.profileId,
      performanceMode: session.performanceMode, frameRate: session.frameRate,
      pid: session.pid, visualState: session.visualState,
    })),
    ipc: undefined,
  }
}

export function sanitizeBenchmarkReport(report: PerformanceBenchmarkReport): PerformanceBenchmarkReport {
  return {
    schemaVersion: 1,
    createdAt: String(report.createdAt),
    accountCount: Math.max(0, Math.min(64, Math.trunc(finite(report.accountCount)))),
    scenarios: report.scenarios.slice(0, 20).map((scenario) => ({
      id: String(scenario.id).slice(0, 80),
      status: scenario.status,
      configuration: { ...scenario.configuration },
      startedAt: String(scenario.startedAt), endedAt: String(scenario.endedAt),
      warmupSeconds: Math.max(0, finite(scenario.warmupSeconds)),
      measurementSeconds: Math.max(0, finite(scenario.measurementSeconds)),
      samples: scenario.samples.slice(-2_500).map(genericSample),
      regressions: scenario.regressions.slice(0, 50).map((item) => String(item).slice(0, 100)),
      validation: scenario.validation ? {
        ok: Boolean(scenario.validation.ok),
        categories: scenario.validation.categories.slice(0, 10).map((item) => String(item).slice(0, 60)),
      } : undefined,
    })),
  }
}

const classifications = ['ALTGRID_OVERHEAD', 'GAME_RENDERER', 'GPU', 'CHROMIUM_SERVICES', 'UNKNOWN'] as const

function categoryValue(sample: DesktopDiagnostics, classification: typeof classifications[number], metric: 'privateKb' | 'cpuPercent'): number {
  return sample.processes.filter((process) => process.classification === classification)
    .reduce((sum, process) => sum + finite(process[metric]), 0)
}

export function scenarioStats(scenario: PerformanceBenchmarkReport['scenarios'][number]) {
  const totals = scenario.samples.map((sample) => sample.totals?.electronKb
    ?? sample.processes.reduce((sum, process) => sum + finite(process.privateKb), 0))
  const cpu = scenario.samples.map((sample) => sample.processes.reduce((sum, process) => sum + finite(process.cpuPercent), 0))
  const start = totals[0] ?? 0
  const end = totals.at(-1) ?? 0
  const firstTime = Date.parse(scenario.samples[0]?.generatedAt ?? scenario.startedAt)
  const lastTime = Date.parse(scenario.samples.at(-1)?.generatedAt ?? scenario.endedAt)
  const duration = Math.max(0, (lastTime - firstTime) / 1_000)
  const categories = Object.fromEntries(classifications.map((classification) => {
    const ram = scenario.samples.map((sample) => categoryValue(sample, classification, 'privateKb'))
    const categoryCpu = scenario.samples.map((sample) => categoryValue(sample, classification, 'cpuPercent'))
    const categoryStart = ram[0] ?? 0
    const categoryEnd = ram.at(-1) ?? 0
    return [classification, {
      ramKb: { average: average(ram), ending: categoryEnd, maximum: Math.max(0, ...ram), delta: categoryEnd - categoryStart,
        growthMbPerMinute: growthMbPerMinute(categoryStart, categoryEnd, duration) },
      cpuAverage: average(categoryCpu),
    }]
  })) as Record<typeof classifications[number], { ramKb: { average: number; ending: number; maximum: number; delta: number; growthMbPerMinute: number | null }; cpuAverage: number }>
  return {
    cpu: { average: average(cpu), median: median(cpu), p95: percentile95(cpu), maximum: Math.max(0, ...cpu) },
    ramKb: { starting: start, average: average(totals), ending: end, maximum: Math.max(0, ...totals), delta: end - start,
      growthMbPerMinute: growthMbPerMinute(start, end, duration) },
    categories,
  }
}

function accountRows(scenario: PerformanceBenchmarkReport['scenarios'][number]): string[] {
  const labels = new Set(scenario.samples.flatMap((sample) => sample.sessions.map((session) => session.label)))
  return [...labels].map((label) => {
    const entries = scenario.samples.flatMap((sample) => {
      const session = sample.sessions.find((item) => item.label === label)
      const process = sample.processes.find((item) => item.pid === session?.pid)
      return process ? [{ pid: process.pid, cpu: process.cpuPercent, ram: process.privateKb }] : []
    })
    const cpu = entries.map((entry) => entry.cpu)
    const ram = entries.map((entry) => entry.ram)
    return `| ${label} | ${entries.at(-1)?.pid ?? '—'} | ${average(cpu).toFixed(2)} | ${percentile95(cpu).toFixed(2)} | ${(average(ram) / 1024).toFixed(1)} MB | ${((ram.at(-1) ?? 0) / 1024).toFixed(1)} MB |`
  })
}

function roleRows(scenario: PerformanceBenchmarkReport['scenarios'][number]): string[] {
  const roles = ['MAIN', 'SHELL', 'GPU', 'SERVICE'] as const
  return roles.map((role) => {
    const cpu = scenario.samples.map((sample) => sample.processes.filter((process) => process.role === role)
      .reduce((sum, process) => sum + process.cpuPercent, 0))
    const ram = scenario.samples.map((sample) => sample.processes.filter((process) => process.role === role)
      .reduce((sum, process) => sum + process.privateKb, 0))
    return `| ${role === 'SHELL' ? 'AltGrid UI' : role === 'SERVICE' ? 'Chromium Services' : role} | — | ${average(cpu).toFixed(2)} | ${percentile95(cpu).toFixed(2)} | ${(average(ram) / 1024).toFixed(1)} MB | ${((ram.at(-1) ?? 0) / 1024).toFixed(1)} MB |`
  })
}

function section(title: string, prefix: string, summaries: ReturnType<typeof scenarioStats>[], scenarios: PerformanceBenchmarkReport['scenarios']): string {
  const lines = scenarios.map((scenario, index) => ({ scenario, stats: summaries[index]! }))
    .filter(({ scenario }) => scenario.id.startsWith(prefix))
    .map(({ scenario, stats }) => `- ${scenario.id}: CPU avg ${stats.cpu.average.toFixed(2)}%, RAM avg ${(stats.ramKb.average / 1024).toFixed(1)} MB, GPU RAM avg ${(stats.categories.GPU.ramKb.average / 1024).toFixed(1)} MB, ${scenario.status}.`)
  return `## ${title}\n\n${lines.join('\n') || 'Not measured.'}`
}

export function buildPerformanceBenchmarkArtifacts(
  unsafeReport: PerformanceBenchmarkReport,
  hardware: BenchmarkHardware,
): { report: PerformanceBenchmarkReport; json: string; csv: string; markdown: string } {
  const report = sanitizeBenchmarkReport(unsafeReport)
  const stats = report.scenarios.map(scenarioStats)
  const summaries = report.scenarios.map((scenario, index) => ({ scenario, stats: stats[index]! }))
  const csvHeader = 'timestamp,scenario,mode,parking,throttling,totalCpu,totalPrivateKb,altgridKb,gamesKb,gpuKb,servicesKb,unknownKb,processCount,rendererCount,regressions'
  const csvRows = report.scenarios.flatMap((scenario) => scenario.samples.map((sample) => [
    sample.generatedAt, scenario.id, scenario.configuration.mode,
    scenario.configuration.parkingStrategy, scenario.configuration.backgroundThrottlingMode,
    sample.processes.reduce((sum, process) => sum + finite(process.cpuPercent), 0),
    sample.totals?.electronKb ?? sample.processes.reduce((sum, process) => sum + finite(process.privateKb), 0),
    sample.totals?.altgridOverheadKb ?? categoryValue(sample, 'ALTGRID_OVERHEAD', 'privateKb'),
    sample.totals?.gameRenderersKb ?? categoryValue(sample, 'GAME_RENDERER', 'privateKb'),
    sample.totals?.gpuKb ?? categoryValue(sample, 'GPU', 'privateKb'),
    sample.totals?.chromiumServicesKb ?? categoryValue(sample, 'CHROMIUM_SERVICES', 'privateKb'),
    sample.totals?.unknownKb ?? categoryValue(sample, 'UNKNOWN', 'privateKb'),
    sample.processes.length, sample.sessions.length, scenario.regressions.length,
  ].map((value) => JSON.stringify(value)).join(',')))
  const stable = summaries.filter(({ scenario }) => scenario.status === 'COMPLETED'
    && scenario.regressions.length === 0 && scenario.validation?.ok === true)
  // Keep the Pareto frontier instead of hiding CPU/RAM/GPU trade-offs behind
  // one arbitrary score. A candidate is omitted only when another safe result
  // is no worse in every measured dimension and strictly better in one.
  const candidates = stable.filter((candidate) => !stable.some((other) => other !== candidate
    && other.stats.cpu.average <= candidate.stats.cpu.average
    && other.stats.ramKb.average <= candidate.stats.ramKb.average
    && other.stats.categories.GPU.ramKb.average <= candidate.stats.categories.GPU.ramKb.average
    && (other.stats.cpu.average < candidate.stats.cpu.average
      || other.stats.ramKb.average < candidate.stats.ramKb.average
      || other.stats.categories.GPU.ramKb.average < candidate.stats.categories.GPU.ramKb.average)))
  const processBreakdown = report.scenarios.map((scenario) => `### ${scenario.id}\n\n| Process/account | PID | CPU AVG | CPU P95 | RAM AVG | RAM END |\n| --- | --- | --- | --- | --- | --- |\n${[...roleRows(scenario), ...accountRows(scenario)].join('\n') || '| No samples | — | — | — | — | — |'}`).join('\n\n')
  const categorySummary = summaries.map(({ scenario, stats: item }) => {
    const totalRam = item.ramKb.average
    const totalCpu = item.cpu.average
    return `### ${scenario.id}\n\n| Category | RAM AVG | RAM % | CPU AVG | CPU % | RAM growth |\n| --- | --- | --- | --- | --- | --- |\n${classifications.map((classification) => {
      const category = item.categories[classification]
      const label = classification === 'ALTGRID_OVERHEAD' ? 'AltGrid overhead' : classification === 'GAME_RENDERER' ? 'Game renderers' : classification === 'CHROMIUM_SERVICES' ? 'Chromium services' : classification === 'UNKNOWN' ? 'Unknown' : 'GPU'
      const ramPercent = totalRam > 0 ? `${((category.ramKb.average / totalRam) * 100).toFixed(1)}%` : 'not measured'
      const cpuPercent = totalCpu > 0 ? `${((category.cpuAverage / totalCpu) * 100).toFixed(1)}%` : 'not measured'
      const growth = category.ramKb.growthMbPerMinute === null ? 'not measured' : `${category.ramKb.growthMbPerMinute.toFixed(2)} MB/min`
      return `| ${label} | ${(category.ramKb.average / 1024).toFixed(1)} MB | ${ramPercent} | ${category.cpuAverage.toFixed(2)}% | ${cpuPercent} | ${growth} |`
    }).join('\n')}`
  }).join('\n\n')
  const comparison = summaries.map(({ scenario, stats: item }) => {
    const baseline = summaries.find(({ scenario: candidate }) => candidate.id === `A${Number(scenario.id.slice(-1))}`)
    if (!baseline || baseline.scenario.id === scenario.id) return `- ${scenario.id}: baseline for ${scenario.configuration.mode}.`
    const difference = (value: number, base: number, unit: string) => {
      const absolute = value - base
      return `${absolute >= 0 ? '+' : ''}${absolute.toFixed(2)} ${unit}${base !== 0 ? ` (${absolute >= 0 ? '+' : ''}${((absolute / base) * 100).toFixed(1)}%)` : ''}`
    }
    return `- ${scenario.id} vs ${baseline.scenario.id}: CPU ${difference(item.cpu.average, baseline.stats.cpu.average, 'pp')}; RAM ${difference(item.ramKb.average / 1024, baseline.stats.ramKb.average / 1024, 'MB')}; GPU RAM ${difference(item.categories.GPU.ramKb.average / 1024, baseline.stats.categories.GPU.ramKb.average / 1024, 'MB')}.`
  }).join('\n')
  const markdown = `# AltGrid Real Performance Benchmark

## Hardware

- CPU: ${hardware.cpuModel} (${hardware.logicalCores} logical cores)
- System RAM: ${(hardware.systemRamBytes / 1024 ** 3).toFixed(2)} GB
- GPU: ${hardware.gpuModel ?? 'not measured'}
- OS: ${hardware.os}
- Electron / Chromium / Node: ${hardware.electron} / ${hardware.chromium} / ${hardware.node}
- AltGrid: ${hardware.altgrid}
- Accounts: ${report.accountCount}

## Test duration

${report.scenarios.map((scenario) => `- ${scenario.id}: warmup ${scenario.warmupSeconds}s; measurement ${scenario.measurementSeconds}s; ${scenario.samples.length} samples.`).join('\n') || 'No scenarios recorded.'}

${section('Baseline', 'A', stats, report.scenarios)}

${section('Background Throttling', 'B', stats, report.scenarios)}

${section('Detached Parking', 'C', stats, report.scenarios)}

${section('Combined', 'D', stats, report.scenarios)}

## Scenario comparison

| Scenario | Status | CPU avg / median / p95 / max | RAM start / avg / end / max | RAM delta | Growth |
| --- | --- | --- | --- | --- | --- |
${summaries.map(({ scenario, stats }) => `| ${scenario.id} | ${scenario.status} | ${stats.cpu.average.toFixed(2)} / ${stats.cpu.median.toFixed(2)} / ${stats.cpu.p95.toFixed(2)} / ${stats.cpu.maximum.toFixed(2)} | ${(stats.ramKb.starting / 1024).toFixed(1)} / ${(stats.ramKb.average / 1024).toFixed(1)} / ${(stats.ramKb.ending / 1024).toFixed(1)} / ${(stats.ramKb.maximum / 1024).toFixed(1)} MB | ${(stats.ramKb.delta / 1024).toFixed(1)} MB | ${stats.ramKb.growthMbPerMinute === null ? 'not measured' : `${stats.ramKb.growthMbPerMinute.toFixed(2)} MB/min`} |`).join('\n')}

### Differences from same-mode baseline

${comparison || 'Not measured.'}

## Process Breakdown

${processBreakdown || 'Not measured.'}

### Classification Summary

${categorySummary || 'Not measured.'}

## Stability

${report.scenarios.map((scenario) => `- ${scenario.id}: ${scenario.regressions.length ? `REGRESSION_DETECTED (${scenario.regressions.join(', ')})` : 'no automatic regression'}; PID changes and lifecycle evidence are retained in the redacted samples.`).join('\n') || 'Not measured.'}

## User Validation

${report.scenarios.map((scenario) => `- ${scenario.id}: ${scenario.validation ? (scenario.validation.ok ? 'everything OK' : scenario.validation.categories.join(', ')) : 'pending'}.`).join('\n') || 'Not measured.'}

## Recommendation Candidates

${candidates.length ? candidates.map(({ scenario }) => `- ${scenario.id}: completed with explicit user confirmation and no recorded regression.`).join('\n') : 'No candidate met the stability and user-validation gates.'}

Lower RAM alone does not select a winner. Memory growth observed during a sample is not automatically a memory leak.
`
  return { report, json: `${JSON.stringify({ hardware, ...report }, null, 2)}\n`, csv: `${[csvHeader, ...csvRows].join('\n')}\n`, markdown }
}
