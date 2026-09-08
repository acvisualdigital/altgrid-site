import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { deflateRawSync } from 'node:zlib'
import { setTimeout as realDelay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

const script = readFileSync(new URL('../extensions/huntera-dps-altgrid/inject.js', import.meta.url), 'utf8')

function packet(type: number, payload: unknown, compressed = false): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify([type, payload]))
  const body = compressed ? deflateRawSync(json) : json
  const data = new Uint8Array(body.length + 5)
  const key = 92731
  new DataView(data.buffer).setUint32(0, key, true)
  data[4] = compressed ? 1 : 0
  data.set(body, 5)
  let value = (key ^ 1213550164) >>> 0
  for (let index = 4; index < data.length; index += 1) {
    if (((index - 4) & 3) === 0) {
      value ^= value << 13; value >>>= 0
      value ^= value >>> 17
      value ^= value << 5; value >>>= 0
    }
    data[index] = data[index]! ^ ((value >>> (((index - 4) & 3) << 3)) & 255)
  }
  return data
}

interface Snapshot {
  __altgridDps: boolean
  party: null | { total: number; rows: Array<{ id: number; dmg: number; taken: number }> }
  incomplete: boolean
  droppedFrames: number
}

function harness() {
  type Listener = (event: { data: unknown }) => void
  class NativeSocket {
    static OPEN = 1
    listeners: Listener[] = []
    constructor(readonly url: string, readonly protocols?: string[]) {}
    addEventListener(type: string, listener: Listener) { if (type === 'message') this.listeners.push(listener) }
    emit(data: unknown) { this.listeners.forEach((listener) => listener({ data })) }
  }
  const handlers = new Map<string, (event: unknown) => void>()
  const output: Snapshot[] = []
  const sandbox = {
    TextDecoder, Uint8Array, ArrayBuffer, Blob, DecompressionStream, JSON,
    setTimeout, setInterval, clearInterval,
    WebSocket: NativeSocket,
    postMessage: (snapshot: Snapshot) => output.push(snapshot),
    addEventListener: (type: string, listener: (event: unknown) => void) => handlers.set(type, listener),
  }
  const window = Object.assign(sandbox, { window: sandbox }) as unknown as typeof sandbox & {
    __altgridDpsMeter: {
      state: { creatures: Map<number, unknown> }
      partyView: () => NonNullable<Snapshot['party']> | null
      getDiagnostics: () => { pendingFrames: number; pendingBytes: number; draining: boolean; incomplete: boolean; droppedFrames: number }
    }
  }
  const context = createContext(window)
  runInContext(script, context)
  const messageSource = runInContext('window', context)
  const socket = new window.WebSocket('wss://game-socket.huntera.com.br', ['game'])
  return {
    socket, output, meter: window.__altgridDpsMeter,
    command: (command: string, extra: object = {}) => handlers.get('message')?.({ source: messageSource, data: { __altgridDpsCommand: command, ...extra } }),
    async flush() {
      for (let attempt = 0; attempt < 500 && window.__altgridDpsMeter.getDiagnostics().draining; attempt += 1) {
        await vi.advanceTimersByTimeAsync(1)
        // Native decompression completes on real worker threads, not fake timers.
        if (window.__altgridDpsMeter.getDiagnostics().draining) await realDelay(2)
      }
      expect(window.__altgridDpsMeter.getDiagnostics().draining).toBe(false)
    },
  }
}

afterEach(() => vi.useRealTimers())

describe('bundled DPS extension performance', () => {
  it('counts every hit across four combat sessions while emitting UI only once per second', async () => {
    vi.useFakeTimers()
    const sessions = Array.from({ length: 4 }, harness)
    for (const session of sessions) {
      session.socket.emit(packet(54, {}))
      session.socket.emit(packet(15, { creature: { id: 1, name: 'Player', kind: 'player', vocation: 'knight' } }))
      for (let hit = 0; hit < 180; hit += 1) {
        session.socket.emit(packet(20, { attackerId: 1, targetId: 2, value: 125 }))
      }
    }
    await Promise.all(sessions.map((session) => session.flush()))
    for (const session of sessions) {
      expect(session.meter.partyView()?.total).toBe(22_500)
      expect(session.output).toHaveLength(0)
      expect(session.meter.getDiagnostics()).toMatchObject({ incomplete: false, pendingBytes: 0, pendingFrames: 0 })
    }
    await vi.advanceTimersByTimeAsync(1000)
    sessions.forEach((session) => expect(session.output).toHaveLength(1))
  })

  it('does not retain monster registries during a long hunt', async () => {
    vi.useFakeTimers()
    const session = harness()
    session.socket.emit(packet(54, {}))
    for (let batch = 0; batch < 12; batch += 1) {
      for (let creature = 0; creature < 100; creature += 1) {
        session.socket.emit(packet(15, { creature: { id: batch * 100 + creature, name: 'Monster', kind: 'monster' } }))
      }
      await session.flush()
    }
    expect(session.meter.state.creatures.size).toBe(0)
    expect(session.meter.getDiagnostics().incomplete).toBe(false)
  })

  it('bounds a stalled decoder queue and explicitly flags partial results without interfering with game delivery', async () => {
    vi.useFakeTimers()
    const session = harness()
    const gameListener = vi.fn()
    session.socket.addEventListener('message', gameListener)
    for (let frame = 0; frame < 600; frame += 1) session.socket.emit(packet(54, {}))
    expect(gameListener).toHaveBeenCalledTimes(600)
    expect(session.meter.getDiagnostics()).toMatchObject({ incomplete: true })
    expect(session.meter.getDiagnostics().pendingFrames).toBeLessThanOrEqual(256)
    expect(session.meter.getDiagnostics().droppedFrames).toBeGreaterThan(0)
    await session.flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(session.output.at(-1)?.incomplete).toBe(true)
    session.command('reset')
    expect(session.output.at(-1)?.incomplete).toBe(false)
    expect(session.meter.getDiagnostics().pendingBytes).toBe(0)
  })

  it('bounds retained raw bytes even when frames are very large', async () => {
    vi.useFakeTimers()
    const session = harness()
    const large = new Uint8Array(2 * 1024 * 1024)
    for (let frame = 0; frame < 8; frame += 1) session.socket.emit(large)
    expect(session.meter.getDiagnostics().pendingBytes).toBeLessThanOrEqual(8 * 1024 * 1024)
    expect(session.meter.getDiagnostics().incomplete).toBe(true)
    await session.flush()
    expect(session.meter.getDiagnostics().pendingBytes).toBe(0)
  })

  it('caps decompressed frames and retained player metadata', async () => {
    vi.useFakeTimers()
    const session = harness()
    session.socket.emit(packet(15, { creature: { id: 1, name: 'a'.repeat(5000), kind: 'player', vocation: 'b'.repeat(5000) } }))
    await session.flush()
    expect(session.meter.state.creatures.get(1)).toMatchObject({ name: 'a'.repeat(120), vocation: 'b'.repeat(40) })
    session.socket.emit(packet(15, { creature: { id: 1, name: 'Monster', kind: 'monster' } }))
    await session.flush()
    expect(session.meter.state.creatures.size).toBe(0)
    session.socket.emit(packet(15, { creature: { id: 2, name: 'x'.repeat(5 * 1024 * 1024), kind: 'player' } }, true))
    await session.flush()
    expect(session.meter.getDiagnostics()).toMatchObject({ incomplete: true, pendingBytes: 0, pendingFrames: 0 })
    expect(session.meter.state.creatures.size).toBe(0)
  })

  it('keeps counting while UI is collapsed and sends a current snapshot when it becomes visible', async () => {
    vi.useFakeTimers()
    const session = harness()
    session.command('ui-state', { suspended: true })
    session.socket.emit(packet(54, {}))
    session.socket.emit(packet(15, { creature: { id: 1, name: 'Player', kind: 'player' } }))
    session.socket.emit(packet(20, { attackerId: 1, targetId: 2, value: 42 }))
    await session.flush()
    await vi.advanceTimersByTimeAsync(5000)
    expect(session.output).toHaveLength(0)
    expect(session.meter.partyView()?.total).toBe(42)
    session.command('ui-state', { suspended: false })
    expect(session.output).toHaveLength(1)
    expect(session.output[0]?.party?.total).toBe(42)
  })

  it('accepts compressed binary frames and preserves the native socket instance', async () => {
    vi.useFakeTimers()
    const session = harness()
    session.socket.emit(packet(54, {}, true))
    session.socket.emit(packet(15, { creature: { id: 1, name: 'Player', kind: 'player' } }, true))
    session.socket.emit(packet(17, { attackerId: 1, targetId: 2, value: 300 }, true))
    await session.flush()
    expect(session.socket.url).toBe('wss://game-socket.huntera.com.br')
    expect(session.socket.protocols).toEqual(['game'])
    expect(session.meter.partyView()?.total).toBe(300)
  })
})
