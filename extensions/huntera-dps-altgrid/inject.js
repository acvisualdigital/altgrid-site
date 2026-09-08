(function () {
  'use strict'
  if (window.__altgridDpsMeter) return
  const XOR_SEED = 1213550164
  const decoder = new TextDecoder()
  const MAX_PENDING_FRAMES = 256
  const MAX_PENDING_BYTES = 8 * 1024 * 1024
  const MAX_DECODED_BYTES = 4 * 1024 * 1024
  const MAX_TRACKED_PLAYERS = 1024
  const MAX_PARTY_PLAYERS = 256
  const messageNames = { 15: 'creature-appear', 17: 'creature-critical', 20: 'creature-hit', 54: 'instance-enter' }
  const state = { creatures: new Map(), party: null, incomplete: false, droppedFrames: 0 }
  const queue = []
  let pendingBytes = 0
  let draining = false
  let generation = 0
  let uiSuspended = false
  let lastPublished = ''

  function markIncomplete() { state.incomplete = true; state.droppedFrames += 1 }

  function xor(buffer, key) {
    let value = (key ^ XOR_SEED) >>> 0
    if (value === 0) value = XOR_SEED
    for (let index = 0; index < buffer.length; index += 1) {
      if ((index & 3) === 0) {
        value ^= value << 13; value >>>= 0
        value ^= value >>> 17
        value ^= value << 5; value >>>= 0
      }
      buffer[index] ^= (value >>> ((index & 3) << 3)) & 255
    }
  }
  function bytes(data) {
    if (data instanceof Uint8Array) return data
    if (data instanceof ArrayBuffer) return new Uint8Array(data)
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    return null
  }
  function outer(input) {
    if (!input || input.length < 5) return null
    const key = (input[0] | (input[1] << 8) | (input[2] << 16) | (input[3] << 24)) >>> 0
    const decoded = new Uint8Array(input.subarray(4))
    xor(decoded, key)
    return { flags: decoded[0], body: decoded.subarray(1) }
  }
  async function inflateRaw(input) {
    const stream = new DecompressionStream('deflate-raw')
    const reader = new Blob([input]).stream().pipeThrough(stream).getReader()
    const chunks = []
    let length = 0
    try {
      while (true) {
        const result = await reader.read()
        if (result.done) break
        length += result.value.byteLength
        if (length > MAX_DECODED_BYTES) {
          void reader.cancel().catch(() => {})
          throw new Error('DPS packet exceeds decode budget')
        }
        chunks.push(result.value)
      }
      const output = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
      return output
    } finally { reader.releaseLock() }
  }
  async function decodeOne(input, budget) {
    const packet = outer(input)
    if (!packet) return null
    return decodePacket(packet, budget)
  }
  async function decodePacket(packet, budget) {
    let body = packet.body
    if (packet.flags & 1) {
      // Let the queue mark failures only if this frame still belongs to the
      // current measurement; an old decode may finish after the user resets.
      body = await inflateRaw(body)
    }
    budget.bytes += body.byteLength
    budget.messages += 1
    if (budget.bytes > MAX_DECODED_BYTES || budget.messages > 1024) {
      throw new Error('DPS frame exceeds decode budget')
    }
    let decoded
    try { decoded = JSON.parse(decoder.decode(body)) } catch { return null }
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'number' || !decoded[1] || typeof decoded[1] !== 'object') return null
    const type = messageNames[decoded[0]]
    return type ? Object.assign({}, decoded[1], { type }) : null
  }
  async function decodeFrame(data) {
    const budget = { bytes: 0, messages: 0 }
    const input = bytes(data instanceof Blob ? await data.arrayBuffer() : data)
    const packet = outer(input)
    if (!packet) return []
    if ((packet.flags & 2) === 0) {
      // Reuse the already decoded outer packet instead of XOR-decoding it twice.
      const message = await decodePacket(packet, budget)
      return message ? [message] : []
    }
    const messages = []
    let offset = 0
    while (offset + 4 <= packet.body.length) {
      const length = (packet.body[offset] | (packet.body[offset + 1] << 8) | (packet.body[offset + 2] << 16) | (packet.body[offset + 3] << 24)) >>> 0
      offset += 4
      if (offset + length > packet.body.length) break
      const message = await decodeOne(packet.body.subarray(offset, offset + length), budget)
      if (message) messages.push(message)
      offset += length
    }
    return messages
  }
  function startParty() { state.party = { since: Date.now(), by: new Map() } }
  function bump(id, creature, field, amount) {
    if (!state.party) return
    if (!state.party.by.has(id) && state.party.by.size >= MAX_PARTY_PLAYERS) {
      markIncomplete(); return
    }
    const entry = state.party.by.get(id) || { name: creature.name, voc: creature.vocation, dmg: 0, hits: 0, taken: 0 }
    entry[field] += amount
    if (field === 'dmg') entry.hits += 1
    entry.name = creature.name
    entry.voc = creature.vocation
    state.party.by.set(id, entry)
  }
  function handle(message) {
    if (message.type === 'instance-enter') {
      state.creatures.clear(); startParty(); return
    }
    if (message.type === 'creature-appear') {
      const creature = message.creature
      const validId = typeof creature?.id === 'number' ? Number.isFinite(creature.id)
        : typeof creature?.id === 'string' && creature.id.length <= 128
      if (!validId) return
      // Damage statistics only need players. Retaining every spawned monster
      // made the registry grow for the entire hunt on busy instances.
      if (creature?.id != null && creature.kind === 'player') {
        state.creatures.delete(creature.id)
        if (state.creatures.size >= MAX_TRACKED_PLAYERS) {
          state.creatures.delete(state.creatures.keys().next().value)
          markIncomplete()
        }
        state.creatures.set(creature.id, {
          name: typeof creature.name === 'string' ? creature.name.slice(0, 120) : '',
          kind: creature.kind,
          vocation: typeof creature.vocation === 'string' ? creature.vocation.slice(0, 40) : '',
        })
      } else if (creature?.id != null) {
        // Servers may reuse an entity id after the original player disappears.
        state.creatures.delete(creature.id)
      }
      return
    }
    if ((message.type === 'creature-hit' || message.type === 'creature-critical') && state.party && message.attackerId != null) {
      const amount = Number(message.value) || 0
      if (!Number.isFinite(amount) || amount < 0) return
      const attacker = state.creatures.get(message.attackerId)
      const target = state.creatures.get(message.targetId)
      if (attacker?.kind === 'player') bump(message.attackerId, attacker, 'dmg', amount)
      if (target?.kind === 'player') bump(message.targetId, target, 'taken', amount)
    }
  }
  function partyView() {
    if (!state.party) return null
    const ms = Math.max(1000, Date.now() - state.party.since)
    const rows = [...state.party.by.entries()].map(([id, entry]) => ({ id, ...entry })).filter((entry) => entry.dmg > 0 || entry.taken > 0).sort((left, right) => right.dmg - left.dmg)
    const total = rows.reduce((sum, entry) => sum + entry.dmg, 0)
    return { ms, total, dps: Math.round(total * 1000 / ms), rows: rows.map((entry) => ({ ...entry, share: total > 0 ? entry.dmg / total : 0, dps: Math.round(entry.dmg * 1000 / ms) })) }
  }
  function post(force = false) {
    if (uiSuspended) return
    const party = partyView()
    const signature = JSON.stringify([party, state.incomplete, state.droppedFrames])
    if (!force && signature === lastPublished) return
    lastPublished = signature
    window.postMessage({ __altgridDps: true, party, incomplete: state.incomplete, droppedFrames: state.droppedFrames }, '*')
  }
  async function drain() {
    if (draining) return
    draining = true
    let batch = 0
    try {
      while (queue.length) {
        const frame = queue.shift()
        try {
          const messages = await decodeFrame(frame.data)
          if (frame.generation === generation) messages.forEach(handle)
        } catch { if (frame.generation === generation) markIncomplete() }
        finally { pendingBytes -= frame.size }
        // Let the game's own tasks run between batches during combat bursts.
        if (++batch % 8 === 0 && queue.length) {
          await new Promise((resolve) => window.setTimeout(resolve, 0))
        }
      }
    } finally { draining = false }
  }
  function enqueue(data) {
    const size = data instanceof Blob ? data.size : bytes(data)?.byteLength
    if (!size) return
    if (queue.length >= MAX_PENDING_FRAMES || size > MAX_PENDING_BYTES - pendingBytes) {
      // This discards only this optional meter's copy. Native WebSocket delivery
      // is unchanged, and the UI explicitly labels the measurement as partial.
      markIncomplete(); return
    }
    queue.push({ data, size, generation })
    pendingBytes += size
    void drain()
  }
  const NativeWebSocket = window.WebSocket
  function AltGridWebSocket(url, protocols) {
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols)
    if (!/huntera|game-socket/i.test(String(url))) return socket
    socket.addEventListener('message', (event) => enqueue(event.data))
    return socket
  }
  AltGridWebSocket.prototype = NativeWebSocket.prototype
  ;['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((key) => { AltGridWebSocket[key] = NativeWebSocket[key] })
  window.WebSocket = AltGridWebSocket
  const timer = window.setInterval(() => post(), 1000)
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.__altgridDpsCommand === 'reset') {
      generation += 1
      while (queue.length) pendingBytes -= queue.shift().size
      state.incomplete = false; state.droppedFrames = 0
      startParty(); post(true)
    }
    if (event.data?.__altgridDpsCommand === 'ui-state') {
      const wasSuspended = uiSuspended
      uiSuspended = event.data.suspended === true
      if (wasSuspended && !uiSuspended) post(true)
    }
  })
  window.__altgridDpsMeter = {
    state, partyView, timer,
    getDiagnostics: () => ({ pendingFrames: queue.length, pendingBytes, draining, incomplete: state.incomplete, droppedFrames: state.droppedFrames }),
  }
})()
