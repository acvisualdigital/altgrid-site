// Run inside xvfb on Linux. Uses a disposable profile, never real accounts.
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux') throw new Error('This launch check requires Linux.')
const binary = resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Supply the packaged AltGrid executable.')
const profile = await mkdtemp(join(tmpdir(), 'altgrid-launch-check-'))
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(binary, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=19223', `--user-data-dir=${profile}`], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
let exit = null
child.on('exit', (code, signal) => { exit = `${code ?? signal}` })
child.on('error', (error) => { exit = error.message })
child.stderr.on('data', (data) => process.stderr.write(data))
child.stdout.resume()
let socket
try {
  const deadline = Date.now() + 60_000
  let passed = false
  while (Date.now() < deadline) {
    if (exit !== null) throw new Error(`App exited before rendering: ${exit}`)
    try {
      const pages = await fetch('http://127.0.0.1:19223/json/list').then((response) => response.json())
      const page = pages.find((item) => item.type === 'page' && item.url.startsWith('altgrid://app/'))
      if (page) {
        const rendered = await new Promise((fulfill, reject) => {
          socket = new WebSocket(page.webSocketDebuggerUrl)
          const timer = setTimeout(() => { socket.close(); reject(new Error('Renderer timeout')) }, 5000)
          socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: "document.readyState === 'complete' && document.body.innerText.trim().length > 30", returnByValue: true } }))
          socket.onerror = () => { clearTimeout(timer); socket.close(); reject(new Error('Debugger unavailable')) }
          socket.onmessage = (event) => {
            const response = JSON.parse(event.data)
            if (response.id !== 1) return
            clearTimeout(timer)
            socket.close()
            fulfill(response.result?.result?.value === true)
          }
        })
        if (rendered) { passed = true; break }
      }
    } catch { /* Retry while Chromium and the shell initialize. */ }
    await new Promise((fulfill) => setTimeout(fulfill, 500))
  }
  if (!passed) throw new Error('The packaged app did not render its interface within 60 seconds.')
  console.log('PASS: packaged Linux app rendered its interface with sandbox enabled.')
} finally {
  socket?.close()
  child.kill('SIGTERM')
  const cleanup = setTimeout(() => { if (exit === null) child.kill('SIGKILL') }, 3000)
  cleanup.unref()
}
