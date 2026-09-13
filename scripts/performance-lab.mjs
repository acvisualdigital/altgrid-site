import { build } from 'esbuild'
import electron from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The app's real factory and sandboxed preload are bundled without rewriting
// them. Every revision runs sequentially with the same installed Electron and
// isolated, disposable profiles. No user accounts or existing app are touched.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
if (args.includes('--help')) {
  console.log('node scripts/performance-lab.mjs [--refs v1.5.2,HEAD,working] [--seconds 30] [--warmup 8] [--cycles 2] [--label name] [--timer-render] [--churn-only]')
  console.log('Default: 30 measured seconds per phase (3-grid, 4-grid, 1-active+3-parked, swapped, all-parked), plus lifecycle samples. --seconds 120 extends each phase. --churn-only tests repeated layout updates every 100 ms.')
  console.log('--memory-pressure adds a four-session 832 MiB allocation/release test with 250 ms CPU sampling. --verify-collection holds that allocation until the real maintenance callback fires, isolating explicit GC from natural GC; use with --memory-pressure and --refs working.')
  process.exit(0)
}
const number = (key, fallback, min = 1) => {
  const result = Number(value(key, fallback))
  if (!Number.isFinite(result) || result < min) throw new Error(`Invalid ${key}`)
  return result
}
const refs = value('--refs', 'v1.5.2,working').split(',')
const runRoot = await mkdtemp(join(tmpdir(), 'altgrid-performance-lab-'))
const sourceFiles = new Map()
const results = []
console.log(`PERFORMANCE_LAB_ROOT=${runRoot}`)

async function bundle(ref, outdir, entry, format, outfile) {
  const revisionFiles = sourceFiles.get(ref) ?? {}
  sourceFiles.set(ref, revisionFiles)
  await build({
    entryPoints: [entry], outfile: join(outdir, outfile), platform: 'node',
    target: 'node22', format, bundle: true, external: ['electron', 'node:*'],
    plugins: [{ name: 'revision-source', setup(builder) {
      builder.onResolve({ filter: /^(electron\/|\.\.?\/)/ }, ({ path, importer }) => ({
        path: (importer ? posix.join(posix.dirname(importer), path) : path).replace(/\.js$/, '.ts'),
        namespace: 'revision',
      }))
      builder.onLoad({ filter: /.*/, namespace: 'revision' }, async ({ path }) => {
        const contents = ref === 'working'
          ? await readFile(join(root, path), 'utf8')
          : execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
        revisionFiles[path] = createHash('sha256').update(contents).digest('hex')
        return { contents, loader: 'ts', resolveDir: root }
      })
    }}],
  })
}

for (const [index, ref] of refs.entries()) {
  const outdir = join(runRoot, `${index}-${ref.replace(/[^\w.-]/g, '_')}`)
  await mkdir(outdir, { recursive: true })
  await bundle(ref, outdir, 'electron/native-session-view.ts', 'esm', 'native-session-view.mjs')
  await bundle(ref, outdir, 'electron/session-preload.ts', 'cjs', 'session-preload.cjs')
  const config = {
    revision: ref, label: value('--label', ref), outdir,
    seconds: number('--seconds', 30), warmup: number('--warmup', 8, 0),
    cycles: number('--cycles', 2, 0), timerRender: args.includes('--timer-render'),
    churnOnly: args.includes('--churn-only'),
    memoryPressure: args.includes('--memory-pressure'),
    verifyCollection: args.includes('--verify-collection'),
    sourceHashes: sourceFiles.get(ref),
    commit: execFileSync('git', ['rev-parse', ref === 'working' ? 'HEAD' : ref], { cwd: root, encoding: 'utf8' }).trim(),
  }
  const configPath = join(outdir, 'config.json')
  await writeFile(configPath, JSON.stringify(config, null, 2))
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const exitCode = await new Promise((fulfill, reject) => {
    const child = spawn(electron, [join(root, 'scripts/performance-lab-electron.mjs'), configPath], {
      cwd: root, stdio: 'inherit', env: environment, windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', fulfill)
  })
  if (exitCode !== 0) throw new Error(`Performance lab ${ref} exited ${exitCode}; see ${outdir}`)
  const result = JSON.parse(await readFile(join(outdir, 'result.json'), 'utf8'))
  results.push(result)
  console.log(JSON.stringify({ revision: ref, summary: result.summary, lifecycle: result.lifecycle }, null, 2))
}
await writeFile(join(runRoot, 'comparison.json'), JSON.stringify(results, null, 2))
console.log(`PERFORMANCE_LAB_REPORT=${join(runRoot, 'comparison.json')}`)
