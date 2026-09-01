import { createReadStream } from 'node:fs'
import { access, copyFile, cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'

import { Platform, build } from 'electron-builder'

import { restoreVelopackCli, runVpk } from './velopack-cli.mjs'

const projectRoot = resolve(process.cwd())
const labRoot = resolve(tmpdir(), 'AltGrid-Velopack-Lab')
const oldOutput = join(labRoot, 'old')
const feedOutput = join(labRoot, 'feed')
const port = Number(process.env.ALTGRID_UPDATE_LAB_PORT ?? '4567')
const oldVersion = process.env.ALTGRID_UPDATE_LAB_OLD_VERSION ?? '1.5.0'
const newVersion = process.env.ALTGRID_UPDATE_LAB_NEW_VERSION ?? '1.5.2'
const host = '127.0.0.1'
const feedUrl = `http://${host}:${port}/`
const packId = 'io.altgrid.desktop.update-lab'
const channel = 'win-x64'
const setupName = `${packId}-${channel}-Setup.exe`
const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const productionVersion = String(manifest.version)

if (!labRoot.startsWith(resolve(tmpdir()) + sep)) throw new Error('Diretório do laboratório fora da pasta temporária.')
if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error('Porta inválida para o laboratório de atualização.')

function run(command, args, environment = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, ...environment },
      shell: process.platform === 'win32',
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', rejectRun)
    child.once('exit', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} terminou com código ${code}.`)))
  })
}

async function compileRenderer(version) {
  await run('pnpm', ['exec', 'vite', 'build', '--mode', 'desktop'], { ALTGRID_BUILD_VERSION: version })
}

async function makeLabProject(version) {
  await compileRenderer(version)
  const labProject = join(labRoot, `project-${version}`)
  await rm(labProject, { force: true, recursive: true })
  await mkdir(join(labProject, 'electron'), { recursive: true })
  await Promise.all([
    cp(join(projectRoot, 'dist'), join(labProject, 'dist'), { recursive: true }),
    cp(join(projectRoot, 'electron-dist'), join(labProject, 'electron-dist'), { recursive: true }),
    cp(join(projectRoot, 'electron', 'assets'), join(labProject, 'electron', 'assets'), { recursive: true }),
    symlink(join(projectRoot, 'node_modules'), join(labProject, 'node_modules'), 'junction'),
  ])
  await writeFile(join(labProject, 'package.json'), JSON.stringify({
    name: 'altgrid-update-lab',
    version,
    description: 'Laboratório isolado do launcher Velopack do AltGrid.',
    author: 'AC Visual Digital',
    main: 'electron-dist/main.js',
    type: 'module',
    dependencies: manifest.dependencies,
  }, null, 2))
  return labProject
}

async function packageVersion(version) {
  const labProject = await makeLabProject(version)
  const unpackedOutput = join(labRoot, `unpacked-${version}`)
  await rm(unpackedOutput, { force: true, recursive: true })
  await build({
    projectDir: labProject,
    config: {
      appId: packId,
      productName: 'AltGrid Update Lab',
      executableName: 'AltGridUpdateLab',
      protocols: [],
      asar: true,
      asarUnpack: ['node_modules/velopack/lib/native/velopack_nodeffi_win_x64_msvc.node'],
      directories: { output: unpackedOutput },
      extraMetadata: { name: 'altgrid-update-lab', version },
      files: [
        'dist/**/*', 'electron-dist/**/*', 'electron/assets/**/*',
        '!node_modules/velopack/lib/native/velopack_nodeffi_linux_arm64_gnu.node',
        '!node_modules/velopack/lib/native/velopack_nodeffi_linux_x64_gnu.node',
        '!node_modules/velopack/lib/native/velopack_nodeffi_osx.node',
        '!node_modules/velopack/lib/native/velopack_nodeffi_win_arm64_msvc.node',
        '!node_modules/velopack/lib/native/velopack_nodeffi_win_x86_msvc.node',
        'package.json',
      ],
      win: { icon: 'electron/assets/icon.ico', target: ['dir'] },
    },
    publish: 'never',
    targets: Platform.WINDOWS.createTarget(['dir']),
  })
  await runVpk([
    'pack', '--packId', packId, '--packVersion', version,
    '--packDir', join(unpackedOutput, 'win-unpacked'), '--mainExe', 'AltGridUpdateLab.exe',
    '--packTitle', 'AltGrid Update Lab', '--packAuthors', 'AC Visual Digital',
    '--outputDir', feedOutput, '--channel', channel, '--runtime', 'win-x64',
    '--icon', join(projectRoot, 'electron', 'assets', 'icon.ico'),
    '--shortcuts', 'StartMenuRoot', '--instLocation', 'PerUser',
  ])
}

async function validateLab() {
  const oldInstaller = join(oldOutput, `${packId}-${oldVersion}-${channel}-Setup.exe`)
  const currentSetup = join(feedOutput, setupName)
  const feedPath = join(feedOutput, `releases.${channel}.json`)
  const [oldInfo, setupInfo, feedText, files] = await Promise.all([
    stat(oldInstaller), stat(currentSetup), readFile(feedPath, 'utf8'), readdir(feedOutput),
  ])
  if (oldInfo.size <= 0 || setupInfo.size <= 0) throw new Error('Os launchers do laboratório estão vazios.')
  const serializedFeed = JSON.stringify(JSON.parse(feedText))
  const newFull = files.find((file) => file.includes(`-${newVersion}-`) && file.endsWith('-full.nupkg'))
  if (!newFull || !serializedFeed.includes(newVersion) || !serializedFeed.includes(newFull)) {
    throw new Error(`O feed Velopack não aponta para a versão ${newVersion}.`)
  }
  const delta = files.find((file) => file.includes(`-${newVersion}-`) && file.endsWith('-delta.nupkg'))
  return { delta, feedPath, newFull, oldInstaller }
}

async function buildLab() {
  await rm(labRoot, { force: true, recursive: true })
  await mkdir(oldOutput, { recursive: true })
  await mkdir(feedOutput, { recursive: true })
  await restoreVelopackCli()
  await run('pnpm', ['desktop:compile'])
  await packageVersion(oldVersion)
  await copyFile(join(feedOutput, setupName), join(oldOutput, `${packId}-${oldVersion}-${channel}-Setup.exe`))
  await packageVersion(newVersion)
  await compileRenderer(productionVersion)
  const artifacts = await validateLab()
  console.log('\nLaboratório Velopack pronto; nada foi publicado.')
  console.log(`Launcher antigo: ${artifacts.oldInstaller}`)
  console.log(`Feed local: ${feedUrl}`)
  console.log(`Pacote novo: ${join(feedOutput, artifacts.newFull)}`)
  console.log(`Delta: ${artifacts.delta ? join(feedOutput, artifacts.delta) : 'não gerado'}`)
}

const mimeTypes = { '.exe': 'application/vnd.microsoft.portable-executable', '.json': 'application/json; charset=utf-8', '.nupkg': 'application/octet-stream', '.zip': 'application/zip' }

async function serveLab() {
  await validateLab()
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', feedUrl)
    const fileName = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '')
    if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      response.writeHead(404).end('Not found')
      return
    }
    const filePath = join(feedOutput, fileName)
    try {
      await access(filePath)
      const info = await stat(filePath)
      response.writeHead(200, {
        'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
        'Content-Length': String(info.size),
        'Content-Type': mimeTypes[extname(fileName).toLowerCase()] ?? 'application/octet-stream',
      })
      createReadStream(filePath).pipe(response)
    } catch {
      response.writeHead(404).end('Not found')
    }
  })
  server.listen(port, host, () => {
    console.log(`Feed Velopack local ativo em ${feedUrl}`)
    console.log(`ALTGRID_UPDATE_URL=${feedUrl}`)
  })
}

const command = process.argv[2] ?? 'build'
if (command === 'build') await buildLab()
else if (command === 'serve') await serveLab()
else throw new Error(`Comando desconhecido: ${command}`)
