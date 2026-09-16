import type {
  DesktopDiagnostics,
  PerformanceBenchmarkReport,
  PerformanceLabConfiguration,
} from '../../electron/contracts'

export type PerformanceLabRun = 'baseline' | 'throttling' | 'detached' | 'combined' | 'full'
export type PerformanceLabStatus = 'idle' | 'warmup' | 'measuring' | 'validation' | 'stopped'
export type PerformanceSoakPhase = 'after-open' | 'after-stabilization' | 'after-close'

export interface PerformanceLabGateway {
  getDiagnostics(): Promise<DesktopDiagnostics>
  setConfiguration(configuration: PerformanceLabConfiguration): Promise<PerformanceLabConfiguration>
  export(report: PerformanceBenchmarkReport): Promise<string | null>
  openResultsFolder(): Promise<boolean>
  wait(milliseconds: number): Promise<void>
}

interface ScenarioDefinition { id: string; configuration: PerformanceLabConfiguration }
type ScenarioResult = PerformanceBenchmarkReport['scenarios'][number]

const modes: PerformanceLabConfiguration['mode'][] = ['normal', 'eco', 'ultra']
const scenarioGroup = (
  prefix: string,
  parkingStrategy: PerformanceLabConfiguration['parkingStrategy'],
  backgroundThrottlingMode: PerformanceLabConfiguration['backgroundThrottlingMode'],
): ScenarioDefinition[] => modes.map((mode, index) => ({
  id: `${prefix}${index + 1}`,
  configuration: { mode, parkingStrategy, backgroundThrottlingMode },
}))

export const PERFORMANCE_LAB_MATRIX: ScenarioDefinition[] = [
  ...scenarioGroup('A', 'ATTACHED_OFFSCREEN', 'compatibility'),
  ...scenarioGroup('B', 'ATTACHED_OFFSCREEN', 'allow'),
  ...scenarioGroup('C', 'DETACHED_VIEW', 'compatibility'),
  ...scenarioGroup('D', 'DETACHED_VIEW', 'allow'),
]

function scenariosFor(run: PerformanceLabRun): ScenarioDefinition[] {
  if (run === 'full') return PERFORMANCE_LAB_MATRIX
  const letter = run === 'baseline' ? 'A' : run === 'throttling' ? 'B' : run === 'detached' ? 'C' : 'D'
  return PERFORMANCE_LAB_MATRIX.filter((scenario) => scenario.id.startsWith(letter))
}

function regressionReasons(report: DesktopDiagnostics): string[] {
  const reasons = new Set<string>()
  for (const session of report.sessions) {
    if (session.status === 'crashed') reasons.add('render-process-gone')
    if (session.status === 'load-failed') reasons.add('load-failed')
    if (session.parkingFallbackReason) reasons.add(session.parkingFallbackReason)
    if (session.processRecreated) reasons.add('pid-recreation')
    if (session.unexpectedNavigation) reasons.add('unexpected-navigation')
  }
  return [...reasons]
}

export class PerformanceLabService {
  private status: PerformanceLabStatus = 'idle'
  private queue: ScenarioDefinition[] = []
  private results: ScenarioResult[] = []
  private current: ScenarioResult | null = null
  private initialConfiguration: PerformanceLabConfiguration | null = null
  private listeners = new Set<() => void>()
  private measurementSeconds = 600
  private warmupSeconds = 60
  private sampleIntervalSeconds = 2
  private stopped = false
  private captureInFlight = false
  private soak: { target: number; cycle: number; phase: PerformanceSoakPhase } | null = null
  private soakBaseline: { sessionCount: number; gamePids: Set<number> } | null = null
  private soakOpenedPids = new Set<number>()
  private runToken = 0

  constructor(private readonly gateway: PerformanceLabGateway) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot() {
    return {
      status: this.status, current: this.current, results: [...this.results],
      remaining: this.queue.length, soak: this.soak ? { ...this.soak } : null,
    }
  }

  async run(run: PerformanceLabRun, measurementSeconds = 600, warmupSeconds = 60): Promise<void> {
    if (this.status !== 'idle' && this.status !== 'stopped') throw new Error('Já existe um benchmark em andamento.')
    const diagnostics = await this.gateway.getDiagnostics()
    this.initialConfiguration = {
      mode: diagnostics.performanceMode ?? 'normal',
      parkingStrategy: diagnostics.sessions[0]?.parkingStrategy ?? 'ATTACHED_OFFSCREEN',
      backgroundThrottlingMode: diagnostics.sessions.some((session) => session.backgroundThrottling)
        ? 'allow' : 'compatibility',
    }
    this.measurementSeconds = Math.max(1, Math.round(measurementSeconds))
    this.warmupSeconds = Math.max(0, Math.round(warmupSeconds))
    this.sampleIntervalSeconds = this.measurementSeconds >= 1_800 ? 15 : 2
    this.queue = scenariosFor(run)
    this.results = []
    this.soak = null
    this.stopped = false
    this.runToken++
    await this.startNext()
  }

  async runSingle(scenarioId: string, measurementSeconds = 600, warmupSeconds = 60): Promise<void> {
    if (this.status !== 'idle' && this.status !== 'stopped') throw new Error('Já existe um benchmark em andamento.')
    const scenario = PERFORMANCE_LAB_MATRIX.find((candidate) => candidate.id === scenarioId)
    if (!scenario) throw new RangeError('Cenário de benchmark inválido.')
    const diagnostics = await this.gateway.getDiagnostics()
    this.initialConfiguration = {
      mode: diagnostics.performanceMode ?? 'normal',
      parkingStrategy: diagnostics.sessions[0]?.parkingStrategy ?? 'ATTACHED_OFFSCREEN',
      backgroundThrottlingMode: diagnostics.sessions.some((session) => session.backgroundThrottling)
        ? 'allow' : 'compatibility',
    }
    this.measurementSeconds = Math.max(1, Math.round(measurementSeconds))
    this.warmupSeconds = Math.max(0, Math.round(warmupSeconds))
    this.sampleIntervalSeconds = this.measurementSeconds >= 1_800 ? 15 : 2
    this.queue = [scenario]
    this.results = []
    this.soak = null
    this.stopped = false
    this.runToken++
    await this.startNext()
  }

  async runExtended(hours: 0.5 | 1 | 2 | 4 | 8): Promise<void> {
    if (this.status !== 'idle' && this.status !== 'stopped') throw new Error('Já existe um benchmark em andamento.')
    const diagnostics = await this.gateway.getDiagnostics()
    this.initialConfiguration = {
      mode: diagnostics.performanceMode ?? 'normal',
      parkingStrategy: diagnostics.sessions[0]?.parkingStrategy ?? 'ATTACHED_OFFSCREEN',
      backgroundThrottlingMode: diagnostics.sessions.some((session) => session.backgroundThrottling)
        ? 'allow' : 'compatibility',
    }
    this.measurementSeconds = hours * 3_600
    this.warmupSeconds = 60
    this.sampleIntervalSeconds = 15
    this.queue = [{ id: `EXTENDED-${hours}H`, configuration: this.initialConfiguration }]
    this.results = []
    this.stopped = false
    this.runToken++
    await this.startNext()
  }

  async startSoak(cycles: 5 | 10 | 20): Promise<void> {
    if (this.status !== 'idle' && this.status !== 'stopped') throw new Error('Já existe um benchmark em andamento.')
    const sample = await this.gateway.getDiagnostics()
    this.initialConfiguration = {
      mode: sample.performanceMode ?? 'normal',
      parkingStrategy: sample.sessions[0]?.parkingStrategy ?? 'ATTACHED_OFFSCREEN',
      backgroundThrottlingMode: sample.sessions.some((session) => session.backgroundThrottling) ? 'allow' : 'compatibility',
    }
    this.results = []
    this.queue = []
    this.stopped = false
    this.runToken++
    this.soak = { target: cycles, cycle: 1, phase: 'after-open' }
    this.soakBaseline = {
      sessionCount: sample.sessions.length,
      gamePids: new Set(sample.processes.filter((process) => process.classification === 'GAME_RENDERER' && process.pid).map((process) => process.pid!)),
    }
    this.soakOpenedPids.clear()
    this.current = {
      id: `SOAK-${cycles}`, status: 'STOPPED', configuration: this.initialConfiguration,
      startedAt: new Date().toISOString(), endedAt: '', warmupSeconds: 0,
      measurementSeconds: 0, samples: [sample], regressions: [],
    }
    this.status = 'measuring'
    this.emit()
  }

  async recordSoakCheckpoint(): Promise<void> {
    if (!this.soak || !this.current || this.status !== 'measuring') return
    const sample = await this.gateway.getDiagnostics()
    this.current.samples.push(sample)
    const reasons = regressionReasons(sample)
    for (const reason of reasons) if (!this.current.regressions.includes(reason)) this.current.regressions.push(reason)
    if (this.soak.phase === 'after-open') {
      const baselinePids = this.soakBaseline?.gamePids ?? new Set<number>()
      this.soakOpenedPids = new Set(sample.processes
        .filter((process) => process.classification === 'GAME_RENDERER' && process.pid && !baselinePids.has(process.pid))
        .map((process) => process.pid!))
      this.soak.phase = 'after-stabilization'
    }
    else if (this.soak.phase === 'after-stabilization') this.soak.phase = 'after-close'
    else {
      const remainingPids = new Set(sample.processes.filter((process) => process.classification === 'GAME_RENDERER' && process.pid).map((process) => process.pid!))
      if ([...this.soakOpenedPids].some((pid) => remainingPids.has(pid))
        && !this.current.regressions.includes('soak-renderer-pid-remained')) this.current.regressions.push('soak-renderer-pid-remained')
      if (this.soakBaseline && sample.sessions.length > this.soakBaseline.sessionCount
        && !this.current.regressions.includes('soak-session-map-not-pruned')) this.current.regressions.push('soak-session-map-not-pruned')
      this.soakOpenedPids.clear()
      if (this.soak.cycle < this.soak.target) {
        this.soak.cycle += 1
        this.soak.phase = 'after-open'
      } else {
      this.current.endedAt = new Date().toISOString()
      this.current.measurementSeconds = Math.max(0, (Date.parse(this.current.endedAt) - Date.parse(this.current.startedAt)) / 1_000)
      this.status = 'validation'
      this.soak = null
      }
    }
    this.emit()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.runToken++
    if (this.current && this.current.status !== 'COMPLETED' && this.current.status !== 'FAILED') {
      this.current.status = 'STOPPED'
      this.current.endedAt = new Date().toISOString()
      this.results.push(this.current)
    }
    this.current = null
    this.queue = []
    this.soak = null
    this.soakBaseline = null
    this.soakOpenedPids.clear()
    this.status = 'stopped'
    if (this.initialConfiguration) await this.gateway.setConfiguration(this.initialConfiguration)
    this.emit()
  }

  async validate(ok: boolean, categories: string[] = []): Promise<void> {
    if (this.status !== 'validation' || !this.current) return
    this.current.validation = { ok, categories: ok ? [] : categories }
    this.current.status = ok && this.current.regressions.length === 0 ? 'COMPLETED' : 'FAILED'
    this.results.push(this.current)
    const unsafe = this.current.status === 'FAILED'
    this.current = null
    this.soak = null
    if (unsafe) {
      this.queue = []
      await this.stop()
    } else {
      await this.startNext()
    }
  }

  async export(): Promise<string | null> {
    const diagnostics = await this.gateway.getDiagnostics()
    const scenarios = [...this.results]
    if (this.current) scenarios.push({ ...this.current, samples: [...this.current.samples] })
    return this.gateway.export({
      schemaVersion: 1, createdAt: new Date().toISOString(),
      accountCount: diagnostics.sessions.length, scenarios,
    })
  }

  openResultsFolder(): Promise<boolean> { return this.gateway.openResultsFolder() }

  destroy(): void { this.runToken++; this.listeners.clear() }

  private async startNext(): Promise<void> {
    if (this.stopped) return
    const next = this.queue.shift()
    if (!next) {
      this.status = 'idle'
      if (this.initialConfiguration) await this.gateway.setConfiguration(this.initialConfiguration)
      this.emit()
      return
    }
    await this.gateway.setConfiguration(next.configuration)
    this.current = {
      id: next.id, status: 'STOPPED', configuration: next.configuration,
      startedAt: new Date().toISOString(), endedAt: '',
      warmupSeconds: this.warmupSeconds, measurementSeconds: this.measurementSeconds,
      samples: [], regressions: [],
    }
    this.status = 'warmup'
    this.emit()
    const token = this.runToken
    void this.runScenario(token).catch(() => this.failCurrent('measurement-runner-failed'))
  }

  private async runScenario(token: number): Promise<void> {
    await this.gateway.wait(this.warmupSeconds * 1_000)
    if (!this.current || this.stopped || token !== this.runToken) return
    this.status = 'measuring'
    this.emit()
    const deadline = Date.now() + this.measurementSeconds * 1_000
    while (this.current && !this.stopped && token === this.runToken && Date.now() < deadline) {
      await this.capture()
      const remaining = deadline - Date.now()
      if (remaining > 0) await this.gateway.wait(Math.min(this.sampleIntervalSeconds * 1_000, remaining))
    }
    if (this.current && !this.stopped && token === this.runToken) this.finishMeasurement()
  }

  private async capture(): Promise<void> {
    if (!this.current || this.status !== 'measuring' || this.captureInFlight) return
    this.captureInFlight = true
    try {
      const sample = await this.gateway.getDiagnostics()
      if (!this.current || this.status !== 'measuring') return
      this.current.samples.push(sample)
      if (this.current.samples.length > 2_500) this.current.samples.shift()
      const regressions = regressionReasons(sample)
      for (const reason of regressions) if (!this.current.regressions.includes(reason)) this.current.regressions.push(reason)
      if (regressions.length) await this.failCurrent(regressions[0]!)
      this.emit()
    } finally {
      this.captureInFlight = false
    }
  }

  private async failCurrent(reason: string): Promise<void> {
    if (!this.current) return
    if (!this.current.regressions.includes(reason)) this.current.regressions.push(reason)
    this.current.status = 'FAILED'
    this.current.endedAt = new Date().toISOString()
    this.results.push(this.current)
    this.current = null
    this.queue = []
    this.status = 'stopped'
    if (this.initialConfiguration) await this.gateway.setConfiguration(this.initialConfiguration)
    this.emit()
  }

  private finishMeasurement(): void {
    if (!this.current) return
    this.current.endedAt = new Date().toISOString()
    this.status = 'validation'
    this.emit()
  }

  private emit(): void { for (const listener of this.listeners) listener() }
}
