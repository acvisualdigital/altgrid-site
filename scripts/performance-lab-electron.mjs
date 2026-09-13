import { app, BrowserWindow, webContents } from 'electron'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

async function main() {
const config = JSON.parse(readFileSync(process.argv.at(-1), 'utf8'))
const profile = join(config.outdir, 'profile')
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.commandLine.appendSwitch('js-flags', '--expose-gc')
app.commandLine.appendSwitch('disable-features', 'BackForwardCache')
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '1024')
app.commandLine.appendSwitch('enable-precise-memory-info')
const sleep = (ms) => new Promise((fulfill) => setTimeout(fulfill, ms))
const fixture = await readFile(fileURLToPath(new URL('./performance-lab-fixture.html', import.meta.url)))
const network = new Map()
const clients = new Set()
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  response.setHeader('Cache-Control', 'no-store')
  if (url.pathname === '/heartbeat') {
    const id = url.searchParams.get('id')
    const record = network.get(id) ?? { count: 0, lastAt: 0, maxGapMs: 0 }
    const now = Date.now()
    if (record.lastAt) record.maxGapMs = Math.max(record.maxGapMs, now - record.lastAt)
    record.lastAt = now
    record.count++
    network.set(id, record)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"ok":true}')
  } else if (url.pathname === '/events') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
    response.write('data: connected\n\n')
    clients.add(response)
    request.on('close', () => clients.delete(response))
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(fixture)
  }
})
const serverHeartbeat = setInterval(() => {
  for (const response of clients) response.write(`data: ${Date.now()}\n\n`)
}, 1000)
await new Promise((fulfill) => server.listen(0, '127.0.0.1', fulfill))
const origin = `http://127.0.0.1:${server.address().port}`
const samples = []
const events = []
const lifecycle = []
let memoryPressureResult = null
const allViews = new Set()
let host
const mean = (items) => items.length ? items.reduce((sum, n) => sum + n, 0) / items.length : 0
const percentile = (items, ratio) => [...items].sort((a, b) => a - b)[Math.max(0, Math.ceil(items.length * ratio) - 1)] ?? 0

function processMetrics() {
  const processes = app.getAppMetrics().map((metric) => ({
    pid: metric.pid, type: metric.type, cpu: metric.cpu.percentCPUUsage,
    workingSetMb: metric.memory.workingSetSize / 1024,
    privateMb: typeof metric.memory.privateBytes === 'number' ? metric.memory.privateBytes / 1024 : null,
  }))
  return {
    processes, cpu: processes.reduce((sum, p) => sum + p.cpu, 0),
    workingSetMb: processes.reduce((sum, p) => sum + p.workingSetMb, 0),
    privateMb: processes.every((p) => p.privateMb !== null) ? processes.reduce((sum, p) => sum + p.privateMb, 0) : null,
    rendererCount: processes.filter((p) => p.type === 'Tab').length,
    webContentsCount: webContents.getAllWebContents().length,
  }
}

async function pageMetrics() {
  return Promise.all(webContents.getAllWebContents().filter((contents) => contents.getURL().startsWith(origin)).map(async (contents) => {
    try {
      return await contents.executeJavaScript(`({
        ...globalThis.labStats,
        accountId: new URL(location.href).searchParams.get('id'),
        visibility: document.visibilityState,
        frameLimit: globalThis.__altgridFrameBudget?.frameRate,
        queuedCallbacks: globalThis.__altgridFrameBudget?.callbacks.size,
        heapMb: performance.memory?.usedJSHeapSize / 1048576,
        heapTotalMb: performance.memory?.totalJSHeapSize / 1048576,
        at: performance.now()
      })`)
    } catch (error) { return { error: String(error) } }
  }))
}

async function sample(phase) {
  // Read CPU before the HUD path: getAppMetrics computes deltas between calls;
  // sampling it immediately after HUD polling produces a near-zero interval.
  const record = { phase, at: Date.now(), ...processMetrics(), accounts: await pageMetrics() }
  // Exercise the same per-account sampling/maintenance path as the app HUD.
  await Promise.all([...allViews].map((view) => view.getResourceUsage()))
  samples.push(record)
  return record
}

try {
  await app.whenReady()
  host = new BrowserWindow({
    width: 1340, height: 800, show: true, title: `AltGrid performance lab — ${config.revision}`,
    backgroundColor: '#080c11', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  host.setMenuBarVisibility(false)
  await host.loadURL(`data:text/html,<html style="background:%23080c11;color:white;font:18px sans-serif"><body>AltGrid performance lab: ${encodeURIComponent(config.revision)}. Only synthetic sessions; close window to abort.</body></html>`)
  const { createNativeSessionViewFactory } = await import(pathToFileURL(join(config.outdir, 'native-session-view.mjs')).href)
  const factory = createNativeSessionViewFactory(host, true)
  let generation = 0

  const create = async (index) => {
    const accountId = `fixture-${generation}-${index}`
    const view = factory({ accountId, partition: `persist:lab-${accountId}`, onEvent: (event) => events.push({ accountId, at: Date.now(), ...event }) })
    allViews.add(view)
    view.attach()
    view.setEcoMode(true)
    view.setBounds({ x: 0, y: 30, width: 1280, height: 720 })
    view.setVisible(true)
    view.setFrameRateLimit(30)
    await view.loadURL(`${origin}/?id=${accountId}&timer=${config.timerRender ? '1' : '0'}`)
    return view
  }

  const destroy = (view) => { view.destroy(true); allViews.delete(view) }
  const layout = (views, mode, active = 0) => {
    for (const [index, view] of views.entries()) {
      const visible = mode === 'grid' || (mode === 'focused' && index === active)
      view.setBounds(mode === 'grid'
        ? { x: index % 2 * 640, y: 30 + Math.floor(index / 2) * 360, width: 640, height: 360 }
        : { x: 0, y: 30, width: 1280, height: 720 })
      view.setFrameRateLimit(index === active ? 30 : 20)
      view.setVisible(visible)
      if (visible && index === active) view.focus()
    }
  }

  const phase = async (name, views, mode, active = 0) => {
    console.log(`LAB_PHASE ${config.revision} ${name}`)
    layout(views, mode, active)
    await sleep(config.warmup * 1000)
    await sample(name)
    const until = Date.now() + config.seconds * 1000
    while (Date.now() < until) {
      await sleep(Math.min(3000, Math.max(1, until - Date.now())))
      await sample(name)
    }
  }

  await sleep(2000)
  lifecycle.push({ name: 'empty-before', ...await sample('empty-before') })
  const views = []
  for (let i = 0; i < 3; i++) views.push(await create(i))
  if (config.memoryPressure) {
    views.push(await create(3))
    layout(views, 'grid')
    console.log('LAB_MEMORY_PRESSURE: allocating and releasing 832 MiB in a visible synthetic session')
    const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(origin))
    if (!target) throw new Error('Missing memory fixture')
    await target.executeJavaScript('globalThis.pressureGarbage = Array.from({length:104}, () => new Array(1048576).fill(17))')
    const nativeExecute = target.executeJavaScriptInIsolatedWorld.bind(target)
    const collections = []
    if (config.verifyCollection) {
      // Keep fixture data alive until the production pressure scheduler fires.
      // Then release only this test allocation, to distinguish explicit GC
      // from Chromium's normal automatic collection.
      target.executeJavaScriptInIsolatedWorld = async (...args) => {
        if (args[1].some((script) => script.code.includes('globalThis.gc'))) {
          await target.executeJavaScript('globalThis.pressureGarbage = null')
          const startedAt = Date.now()
          const result = await nativeExecute(...args)
          collections.push({ startedAt, durationMs: Date.now() - startedAt })
          return result
        }
        return nativeExecute(...args)
      }
    }
    const before = await sample('pressure-before')
    if (!config.verifyCollection) await target.executeJavaScript('globalThis.pressureGarbage = null')
    // Reset gap measurements after allocation: isolate maintenance from the
    // deliberately expensive fixture setup and capture spikes, not just means.
    await target.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => { labStats.maxFrameGapMs = 0; labStats.maxHeartbeatGapMs = 0; resolve() }))')
    const cpuTrace = []
    const until = Date.now() + 35_000
    while (Date.now() < until) {
      await sleep(250)
      cpuTrace.push({ at: Date.now(), ...processMetrics() })
    }
    const after = await sample('pressure-after')
    const intact = await target.executeJavaScript('labResources.length === 24 * 1024 * 1024 && labResources[0] === 17')
    memoryPressureResult = { before, after, retainedDataIntact: intact, cpuTrace, collections,
      meanCpu: mean(cpuTrace.map((entry) => entry.cpu)),
      p95Cpu: percentile(cpuTrace.map((entry) => entry.cpu), 0.95),
      peakCpu: Math.max(...cpuTrace.map((entry) => entry.cpu)),
    }
    console.log(JSON.stringify({ memoryPressure: {
      reclaimedMb: before.privateMb - after.privateMb,
      meanCpu: memoryPressureResult.meanCpu, p95Cpu: memoryPressureResult.p95Cpu,
      peakCpu: memoryPressureResult.peakCpu, accounts: after.accounts, collections,
    } }))
    if (!intact) throw new Error('Live fixture data was lost')
    if (config.verifyCollection && collections.length !== 1) throw new Error('Expected one production-triggered collection')
    if (config.revision === 'working' && before.privateMb - after.privateMb < 400) {
      throw new Error('Memory-pressure maintenance did not reclaim the released fixture allocation')
    }
    for (const account of after.accounts) {
      const prior = before.accounts.find((item) => item.accountId === account.accountId)
      if (account.sentHeartbeats - prior.sentHeartbeats < 25 || account.heartbeatErrors > prior.heartbeatErrors) {
        throw new Error('Heartbeats interrupted during memory maintenance')
      }
    }
    destroy(views.pop())
  }
  if (config.churnOnly) {
    views.push(await create(3))
    const churn = setInterval(() => layout(views, 'focused'), 100)
    try { await phase('repeated-layout-one-active-three-parked', views, 'focused') }
    finally { clearInterval(churn) }
  } else {
  await phase('three-grid', views, 'grid')
  views.push(await create(3))
  await phase('four-grid', views, 'grid')
  await phase('one-active-three-parked', views, 'focused')
  await phase('switched-active', views, 'focused', 3)
  await phase('all-parked', views, 'parked')
  }
  for (const view of views) destroy(view)
  await sleep(6000)
  lifecycle.push({ name: 'closed-first-four', ...await sample('closed-first-four') })
  for (let cycle = 0; cycle < config.cycles; cycle++) {
    generation++
    const cycleViews = []
    for (let i = 0; i < 4; i++) cycleViews.push(await create(i))
    layout(cycleViews, 'focused')
    await sleep(6000)
    lifecycle.push({ name: `reopened-${cycle}`, ...await sample(`reopened-${cycle}`) })
    for (const view of cycleViews) destroy(view)
    await sleep(6000)
    lifecycle.push({ name: `closed-${cycle}`, ...await sample(`closed-${cycle}`) })
  }
  const names = [...new Set(samples.map((s) => s.phase))].filter((name) => !name.startsWith('pressure-') && !name.includes('empty') && !name.includes('closed') && !name.includes('reopened'))
  const summary = names.map((phaseName) => {
    const phaseSamples = samples.filter((s) => s.phase === phaseName)
    const measured = phaseSamples.slice(1)
    const first = phaseSamples[0]
    const last = phaseSamples.at(-1)
    return {
      phase: phaseName, durationSeconds: (last.at - first.at) / 1000,
      meanCpu: mean(measured.map((s) => s.cpu)), p95Cpu: percentile(measured.map((s) => s.cpu), 0.95),
      meanPrivateMb: mean(measured.map((s) => s.privateMb ?? 0)), peakPrivateMb: Math.max(...measured.map((s) => s.privateMb ?? 0)),
      meanWorkingSetMb: mean(measured.map((s) => s.workingSetMb)),
      privateGrowthMb: last.privateMb !== null && first.privateMb !== null ? last.privateMb - first.privateMb : null,
      accounts: last.accounts.map((account) => {
        const prior = first.accounts.find((p) => p.accountId === account.accountId)
        const seconds = (account.at - (prior?.at ?? account.at)) / 1000
        return {
          accountId: account.accountId, frameLimit: account.frameLimit, visibility: account.visibility,
          fps: seconds > 0 ? (account.frames - prior.frames) / seconds : null,
          timerTicksPerSecond: seconds > 0 ? (account.timerTicks - prior.timerTicks) / seconds : null,
          receivedEvents: account.receivedEvents - (prior?.receivedEvents ?? 0),
          sentHeartbeats: account.sentHeartbeats - (prior?.sentHeartbeats ?? 0),
          maxHeartbeatGapMs: account.maxHeartbeatGapMs, maxFrameGapMs: account.maxFrameGapMs,
          heapMb: account.heapMb, queuedCallbacks: account.queuedCallbacks,
        }
      }),
    }
  })
  const report = {
    config, environment: { electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryMb: totalmem() / 1048576, gpu: await app.getGPUInfo('basic') },
    caveat: 'Synthetic canvas fixture measures scheduler/process overhead, not actual Huntera hunts or real account RAM. Same installed Electron/flags on every revision. CPU is summed Electron process usage; not calibrated to the app UI or Task Manager. Profile and raw samples are retained for inspection.',
    summary, lifecycle, memoryPressureResult, network: Object.fromEntries(network), events, samples,
  }
  report.validationErrors = []
  for (const phase of summary) {
    if (phase.accounts.length < 3) report.validationErrors.push(`${phase.phase}: missing sessions`)
    for (const account of phase.accounts) {
      if (!(account.fps > 0.2)) report.validationErrors.push(`${phase.phase}/${account.accountId}: animation stopped`)
      if (config.revision === 'working' && account.sentHeartbeats < phase.durationSeconds * 0.7) {
        report.validationErrors.push(`${phase.phase}/${account.accountId}: heartbeat delivery stalled`)
      }
    }
  }
  for (const closed of lifecycle.filter((entry) => entry.name.startsWith('closed'))) {
    if (closed.webContentsCount !== 1) report.validationErrors.push(`${closed.name}: session WebContents retained`)
  }
  await writeFile(join(config.outdir, 'result.json'), JSON.stringify(report, null, 2))
  if (report.validationErrors.length) throw new Error(report.validationErrors.join('; '))
} catch (error) {
  console.error(error)
  await writeFile(join(config.outdir, 'failure.json'), JSON.stringify({ error: String(error), samples, events }, null, 2))
  process.exitCode = 1
} finally {
  for (const view of allViews) view.destroy(true)
  clearInterval(serverHeartbeat)
  for (const client of clients) client.end()
  server.closeAllConnections()
  server.close()
  if (host && !host.isDestroyed()) host.destroy()
  app.exit(process.exitCode ?? 0)
}
}
main().catch((error) => { console.error(error); app.exit(1) })
