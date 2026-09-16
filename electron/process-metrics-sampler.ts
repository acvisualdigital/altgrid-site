import { app, type ProcessMetric } from 'electron'

export interface ProcessMetricsSnapshot {
  capturedAt: number
  metrics: ProcessMetric[]
}

// One source for the whole Electron process tree. Callers may request a fresh
// sample, but concurrent resource/diagnostic requests share the same capture.
let latest: ProcessMetricsSnapshot | null = null

export function sampleProcessMetrics(maxAgeMs = 250): ProcessMetricsSnapshot {
  const now = Date.now()
  if (latest && now - latest.capturedAt <= Math.max(0, maxAgeMs)) return latest
  latest = { capturedAt: now, metrics: app.getAppMetrics() }
  return latest
}

export function resetProcessMetricsSamplerForTest(): void {
  latest = null
}
