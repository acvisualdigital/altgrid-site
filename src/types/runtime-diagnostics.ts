export interface RuntimeDiagnostics {
  mode: 'standard' | 'ultra'
  version: string
  platform: string
  activeSessions: number
  savedSessions: number
  issueCount: number
  privateKb: number | null
  gpuKb: number | null
  cpuPercent: number | null
  peakPrivateKb: number | null
}

export interface RuntimeDiagnosticsSnapshot extends RuntimeDiagnostics {
  receivedAt: string
}
