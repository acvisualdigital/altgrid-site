import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

if (!process.versions.electron) {
  const { build } = await import('esbuild')
  const { spawn } = await import('node:child_process')
  const { default: executable } = await import('electron')
  const out = await mkdtemp(join(tmpdir(), 'altgrid-inactive-ui-'))
  await build({
    stdin: { contents: `
      import { AuthApp } from './src/app.ts';
      import { ConfiguredAccountService } from './src/services/configured-account-service.ts';
      const accounts = new ConfiguredAccountService({ storage: null });
      const user = { id: 'ui-smoke-user', email: 'test@example.invalid' };
      for (let i=1;i<=16;i++) accounts.add(user.id, {displayName: 'Conta '+i, gameSlug: 'huntera'});
      const auth = {getSession: async()=>({ user, access_token:'test', refresh_token:'test' }), onAuthStateChange:()=>()=>{}};
      const app = new AuthApp(document.querySelector('#app'), auth, {accountService:accounts});
      await app.start();
      window.qaApp = app;
    `, resolveDir: process.cwd(), loader: 'ts' },
    outfile: join(out, 'fixture.js'), bundle: true, format: 'esm', platform: 'browser',
    loader: { '.png': 'dataurl', '.svg': 'dataurl' },
    define: { '__APP_VERSION__': '"1.6.8-local"', 'import.meta.env.DEV': 'false' },
  })
  await writeFile(join(out, 'styles.css'), await readFile('src/styles.css'))
  await writeFile(join(out, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><div id="app"></div><script type="module" src="fixture.js"></script></body></html>')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(executable, [resolve('scripts/inactive-accounts-ui-smoke.mjs'), out], { env, windowsHide: true, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', resolveExit)
  })
  console.log('UI_SMOKE_OUTPUT=' + out)
  process.exitCode = code ?? 1
} else {
  void runElectronSmoke().catch(error => { console.error(error); process.exit(1) })
}

async function runElectronSmoke() {
  const { app, BrowserWindow } = await import('electron')
  const out = process.argv.at(-1)
  app.setPath('userData', join(out, 'profile'))
  await app.whenReady()
  const watchdog = setTimeout(() => { console.error('UI smoke timed out'); app.exit(1) }, 30_000)
  const win = new BrowserWindow({ width: 1200, height: 850, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  const errors = []
  win.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason))
  try {
    await win.loadFile(join(out, 'index.html'))
    console.log('UI_SMOKE_LOADED')
    const evaluate = (script) => win.webContents.executeJavaScript(script)
    for (let i=0; i<50 && !await evaluate('Boolean(window.qaApp)'); i++) await new Promise(r => setTimeout(r, 100))
    if (!await evaluate('Boolean(window.qaApp)')) throw new Error('Fixture did not initialize')
    console.log('UI_SMOKE_READY')
    for (const width of [1200, 440]) {
      win.setContentSize(width, 760)
      await evaluate("document.querySelector('.inactive-accounts-menu').open = true")
      await new Promise(r => setTimeout(r, 150))
      const layout = await evaluate(`(() => {
        const popup = document.querySelector('.inactive-accounts-popover');
        const list = popup.querySelector('.saved-accounts__list');
        const rect = popup.getBoundingClientRect();
        return { width: innerWidth, left: rect.left, right: rect.right, bottom: rect.bottom, height: innerHeight, scroll: list.scrollHeight > list.clientHeight };
      })()`)
      if (layout.left < 0 || layout.right > layout.width || layout.bottom > layout.height || !layout.scroll) throw new Error('Invalid layout: '+JSON.stringify(layout))
      await evaluate("document.querySelector('.saved-account__menu > summary').click()")
      await new Promise(r => setTimeout(r, 120))
      if (!await evaluate("document.querySelector('.inactive-accounts-menu').open && document.querySelector('.saved-account__menu').open")) throw new Error('Nested menu closed its parent')
      await writeFile(join(out, `inactive-${width}.png`), (await win.webContents.capturePage()).toPNG())
      await evaluate("document.querySelector('[data-close-inactive-accounts]').click()")
      await new Promise(r => setTimeout(r, 100))
      if (await evaluate("document.querySelector('.inactive-accounts-menu').open")) throw new Error('Close button failed')
    }
    if (errors.length) throw new Error(errors.join(', '))
    console.log('UI_SMOKE_OK: desktop/mobile bounds, scroll, nested menu, close button; no renderer crash')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    clearTimeout(watchdog)
    win.destroy()
    app.exit(process.exitCode ?? 0)
  }
}
