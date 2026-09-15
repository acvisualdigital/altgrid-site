import { describe, expect, it } from 'vitest'
import { readRuntimeDiagnostics } from './platform-validation'

const summary = { mode: 'ultra', version: '1.7.0', platform: 'Win32', activeSessions: 4, savedSessions: 7, issueCount: 0, privateKb: 4000000, gpuKb: 1500000, peakPrivateKb: 4200000, cpuPercent: 25 }
const request = (value: unknown) => new Request('https://example.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

describe('runtime diagnostics validation', () => {
  it('accepts bounded numeric summaries and unavailable mobile metrics', async () => {
    expect(await readRuntimeDiagnostics(request(summary))).toEqual(summary)
    expect((await readRuntimeDiagnostics(request({ ...summary, privateKb: null, gpuKb: null, cpuPercent: null, peakPrivateKb: null }))).privateKb).toBeNull()
  })
  it.each([{ ...summary, user_id: 'other' }, { ...summary, tokens: 'secret' }, { ...summary, mode: 'unknown' }, { ...summary, cpuPercent: -1 }, { ...summary, activeSessions: 1.5 }, { ...summary, privateKb: 2 ** 40 }, { ...summary, platform: 'x'.repeat(41) }])('rejects unsupported or unbounded input', async (value) => {
    await expect(readRuntimeDiagnostics(request(value))).rejects.toThrow()
  })
})
