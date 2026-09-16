import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopDiagnostics, PerformanceLabConfiguration } from '../../electron/contracts'
import { PERFORMANCE_LAB_MATRIX, PerformanceLabService } from './performance-lab-service'

function diagnostics(overrides: Partial<DesktopDiagnostics> = {}): DesktopDiagnostics {
  return {
    generatedAt: new Date().toISOString(), version: '1.7.0', platform: 'win32', uptimeSeconds: 10,
    performanceMode: 'ultra', performanceDebugEnabled: true,
    processes: [{ pid: 30, type: 'Tab', role: 'GAME', classification: 'GAME_RENDERER', cpuPercent: 2, privateKb: 700_000 }],
    sessions: [{ label: 'private', status: 'ready', visible: true, frameRate: 10, pid: 30,
      parkingStrategy: 'ATTACHED_OFFSCREEN', backgroundThrottling: false }],
    ...overrides,
  }
}

describe('PerformanceLabService', () => {
  const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('defines the requested A1-D3 matrix order', () => {
    expect(PERFORMANCE_LAB_MATRIX.map((scenario) => scenario.id)).toEqual([
      'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3',
    ])
  })

  it('runs, waits for validation and moves to the next scenario', async () => {
    const configurations: PerformanceLabConfiguration[] = []
    const service = new PerformanceLabService({
      getDiagnostics: vi.fn(async () => diagnostics()),
      setConfiguration: vi.fn(async (value) => { configurations.push(value); return value }),
      export: vi.fn(async () => 'report.md'), openResultsFolder: vi.fn(async () => true), wait,
    })
    await service.run('baseline', 1, 0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(service.snapshot().status).toBe('validation')
    expect(service.snapshot().current?.id).toBe('A1')
    await service.validate(true)
    expect(service.snapshot().current?.id).toBe('A2')
    expect(configurations[0]).toEqual({ mode: 'normal', parkingStrategy: 'ATTACHED_OFFSCREEN', backgroundThrottlingMode: 'compatibility' })
  })

  it('resumes one selected scenario after an interrupted UI sequence', async () => {
    const configurations: PerformanceLabConfiguration[] = []
    const service = new PerformanceLabService({
      getDiagnostics: vi.fn(async () => diagnostics()),
      setConfiguration: vi.fn(async (value) => { configurations.push(value); return value }),
      export: vi.fn(async () => null), openResultsFolder: vi.fn(async () => true), wait,
    })
    await service.runSingle('B3', 1, 0)
    expect(service.snapshot().current?.id).toBe('B3')
    expect(configurations[0]).toEqual({ mode: 'ultra', parkingStrategy: 'ATTACHED_OFFSCREEN', backgroundThrottlingMode: 'allow' })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(service.snapshot().status).toBe('validation')
  })

  it('stops on a regression and restores the initial conservative configuration', async () => {
    const configurations: PerformanceLabConfiguration[] = []
    const service = new PerformanceLabService({
      getDiagnostics: vi.fn(async () => diagnostics({ sessions: [{ label: 'private', status: 'crashed', visible: true, frameRate: 10 }] })),
      setConfiguration: vi.fn(async (value) => { configurations.push(value); return value }),
      export: vi.fn(async () => null), openResultsFolder: vi.fn(async () => true), wait,
    })
    await service.run('combined', 20, 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.snapshot().status).toBe('stopped')
    expect(service.snapshot().results[0]?.regressions).toContain('render-process-gone')
    expect(configurations.at(-1)).toEqual({ mode: 'ultra', parkingStrategy: 'ATTACHED_OFFSCREEN', backgroundThrottlingMode: 'compatibility' })
  })

  it('cancels and exports only redacted report input through the gateway', async () => {
    const exportReport = vi.fn(async () => 'benchmark.md')
    const setConfiguration = vi.fn(async (value: PerformanceLabConfiguration) => value)
    const service = new PerformanceLabService({ getDiagnostics: vi.fn(async () => diagnostics()), setConfiguration,
      export: exportReport, openResultsFolder: vi.fn(async () => true), wait })
    await service.run('detached', 60, 0)
    await vi.advanceTimersByTimeAsync(0)
    await service.stop()
    expect(service.snapshot().status).toBe('stopped')
    expect(setConfiguration).toHaveBeenLastCalledWith({ mode: 'ultra', parkingStrategy: 'ATTACHED_OFFSCREEN', backgroundThrottlingMode: 'compatibility' })
    await service.export()
    expect(exportReport).toHaveBeenCalledOnce()
  })

  it('uses one current configuration and a 15 second interval for long tests', async () => {
    const getDiagnostics = vi.fn(async () => diagnostics())
    const service = new PerformanceLabService({ getDiagnostics,
      setConfiguration: vi.fn(async (value) => value), export: vi.fn(async () => null), openResultsFolder: vi.fn(async () => true), wait })
    await service.runExtended(0.5)
    await vi.advanceTimersByTimeAsync(60_000)
    const afterWarmup = getDiagnostics.mock.calls.length
    await vi.advanceTimersByTimeAsync(45_000)
    expect(getDiagnostics.mock.calls.length - afterWarmup).toBe(3)
    expect(service.snapshot().current?.id).toBe('EXTENDED-0.5H')
    await service.stop()
  })

  it('guides manual soak cycles without automating login', async () => {
    const service = new PerformanceLabService({ getDiagnostics: vi.fn(async () => diagnostics()),
      setConfiguration: vi.fn(async (value) => value), export: vi.fn(async () => null), openResultsFolder: vi.fn(async () => true), wait })
    await service.startSoak(5)
    expect(service.snapshot().soak).toEqual({ target: 5, cycle: 1, phase: 'after-open' })
    await service.recordSoakCheckpoint()
    await service.recordSoakCheckpoint()
    await service.recordSoakCheckpoint()
    expect(service.snapshot().soak).toEqual({ target: 5, cycle: 2, phase: 'after-open' })
  })
})
