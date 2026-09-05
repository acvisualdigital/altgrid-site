(function () {
  'use strict'
  if (window.__altgridDpsMeter) return
  const XOR_SEED = 1213550164
  const decoder = new TextDecoder()
  const messageNames = { 15: 'creature-appear', 17: 'creature-critical', 20: 'creature-hit', 54: 'instance-enter' }
  const state = { creatures: new Map(), party: null }

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
    return new Uint8Array(await new Response(new Blob([input]).stream().pipeThrough(stream)).arrayBuffer())
  }
  async function decodeOne(input) {
    const packet = outer(input)
    if (!packet) return null
    let body = packet.body
    if (packet.flags & 1) {
      try { body = await inflateRaw(body) } catch { return null }
    }
    let decoded
    try { decoded = JSON.parse(decoder.decode(body)) } catch { return null }
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'number' || !decoded[1] || typeof decoded[1] !== 'object') return null
    const type = messageNames[decoded[0]]
    return type ? Object.assign({}, decoded[1], { type }) : null
  }
  async function decodeFrame(data) {
    const input = bytes(data)
    const packet = outer(input)
    if (!packet) return []
    if ((packet.flags & 2) === 0) {
      const message = await decodeOne(input)
      return message ? [message] : []
    }
    const messages = []
    let offset = 0
    while (offset + 4 <= packet.body.length) {
      const length = (packet.body[offset] | (packet.body[offset + 1] << 8) | (packet.body[offset + 2] << 16) | (packet.body[offset + 3] << 24)) >>> 0
      offset += 4
      if (offset + length > packet.body.length) break
      const message = await decodeOne(packet.body.subarray(offset, offset + length))
      if (message) messages.push(message)
      offset += length
    }
    return messages
  }
  function startParty() { state.party = { since: Date.now(), by: new Map() } }
  function bump(id, creature, field, amount) {
    if (!state.party) return
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
      if (creature?.id != null) state.creatures.set(creature.id, { name: creature.name, kind: creature.kind, vocation: creature.vocation })
      return
    }
    if ((message.type === 'creature-hit' || message.type === 'creature-critical') && state.party && message.attackerId != null) {
      const amount = Number(message.value) || 0
      const attacker = state.creatures.get(message.attackerId)
      const target = state.creatures.get(message.targetId)
      if (attacker?.kind === 'player') bump(message.attackerId, attacker, 'dmg', amount)
      if (target?.kind === 'player') bump(message.targetId, target, 'taken', amount)
    }
  }
  function partyView() {
    if (!state.party) return null
    const ms = Math.max(1000, Date.now() - state.party.since)
    const rows = [...state.party.by.values()].filter((entry) => entry.dmg > 0 || entry.taken > 0).sort((left, right) => right.dmg - left.dmg)
    const total = rows.reduce((sum, entry) => sum + entry.dmg, 0)
    return { ms, total, dps: Math.round(total * 1000 / ms), rows: rows.map((entry) => ({ ...entry, share: total > 0 ? entry.dmg / total : 0, dps: Math.round(entry.dmg * 1000 / ms) })) }
  }
  function post() { window.postMessage({ __altgridDps: true, party: partyView() }, '*') }
  const NativeWebSocket = window.WebSocket
  function AltGridWebSocket(url, protocols) {
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols)
    if (!/huntera|game-socket/i.test(String(url))) return socket
    let chain = Promise.resolve()
    socket.addEventListener('message', (event) => {
      chain = chain.then(() => decodeFrame(event.data)).then((messages) => {
        messages.forEach(handle)
        if (messages.length) post()
      }).catch(() => {})
    })
    return socket
  }
  AltGridWebSocket.prototype = NativeWebSocket.prototype
  ;['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((key) => { AltGridWebSocket[key] = NativeWebSocket[key] })
  window.WebSocket = AltGridWebSocket
  const timer = window.setInterval(post, 1000)
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.__altgridDpsCommand === 'reset') { startParty(); post() }
  })
  window.__altgridDpsMeter = { state, partyView, timer }
})()
