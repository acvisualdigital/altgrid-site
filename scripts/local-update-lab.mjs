import { createReadStream } from 'node:fs'
import { access, copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'

import { Platform, build } from 'electron-builder'

const projectRoot = resolve(process.cwd())
const labRoot = resolve(tmpdir(), 'AltGrid-Update-Lab')
const oldOutput = join(labRoot, 'old')
const feedOutput = join(labRoot, 'feed')
const port = Number(process.env.ALTGRID_UPDATE_LAB_PORT ?? '4567')
const oldVersion = '1.2.200'
const newVersion = '1.2.203'
const host = '127.0.0.1'
const feedUrl = `http://${host}:${port}/`
const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const productionVersion = String(manifest.version)

if (!labRoot.startsWith(resolve(tmpdir()) + sep)) {
  throw new Error('Diretório do laboratório fora da pasta temporária.')
}
if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  throw new Error('Porta inválida para o laboratório de atualização.')
}

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
    child.once('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} terminou com código ${code}.`))
    })
  })
}

async function compileRenderer(version) {
  await run('pnpm', ['exec', 'vite', 'build', '--mode', 'desktop'], {
    ALTGRID_BUILD_VERSION: version,
  })
}

async function packageVersion(version, outputDirectory) {
  await compileRenderer(version)
  const temporaryOutput = await mkdtemp(join(tmpdir(), 'altgrid-update-lab-build-'))
  const labProject = join(labRoot, `project-${version}`)
  await mkdir(join(labProject, 'electron'), { recursive: true })
  await mkdir(join(labProject, 'installer'), { recursive: true })
  await Promise.all([
    cp(join(projectRoot, 'dist'), join(labProject, 'dist'), { recursive: true }),
    cp(join(projectRoot, 'electron-dist'), join(labProject, 'electron-dist'), { recursive: true }),
    cp(join(projectRoot, 'electron', 'assets'), join(labProject, 'electron', 'assets'), { recursive: true }),
    copyFile(join(projectRoot, 'installer', 'windows.nsh'), join(labProject, 'installer', 'windows.nsh')),
    symlink(join(projectRoot, 'node_modules'), join(labProject, 'node_modules'), 'junction'),
  ])
  await writeFile(join(labProject, 'package.json'), JSON.stringify({
    name: 'altgrid-update-lab',
    version,
    description: 'Laboratório isolado do atualizador do AltGrid.',
    author: 'AltGrid',
    main: 'electron-dist/main.js',
    type: 'module',
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
  }, null, 2))

  try {
    await build({
      projectDir: labProject,
      config: {
      appId: 'io.altgrid.desktop.update-lab',
      productName: 'AltGrid Update Lab',
      executableName: 'AltGridUpdateLab',
      protocols: [],
      asar: true,
      directories: { output: temporaryOutput },
      extraMetadata: {
        name: 'altgrid-update-lab',
        version,
      },
      files: [
        'dist/**/*',
        'electron-dist/**/*',
        'electron/assets/**/*',
        'package.json',
      ],
      win: {
        icon: 'electron/assets/icon.png',
        target: ['nsis'],
      },
      nsis: {
        artifactName: 'AltGrid-Update-Lab-Setup-${version}.${ext}',
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        deleteAppDataOnUninstall: true,
        include: 'installer/windows.nsh',
      },
      publish: [{ provider: 'generic', url: feedUrl }],
      },
      publish: 'never',
      targets: Platform.WINDOWS.createTarget(['nsis']),
    })

    await mkdir(outputDirectory, { recursive: true })
    for (const fileName of [
      `AltGrid-Update-Lab-Setup-${version}.exe`,
      `AltGrid-Update-Lab-Setup-${version}.exe.blockmap`,
      'latest.yml',
    ]) {
      await copyFile(join(temporaryOutput, fileName), join(outputDirectory, fileName))
    }
  } finally {
    await rm(temporaryOutput, { force: true, recursive: true })
  }
}

async function validateLab() {
  const oldInstaller = join(oldOutput, `AltGrid-Update-Lab-Setup-${oldVersion}.exe`)
  const newInstaller = join(feedOutput, `AltGrid-Update-Lab-Setup-${newVersion}.exe`)
  const latestPath = join(feedOutput, 'latest.yml')
  const [oldInfo, newInfo, latest] = await Promise.all([
    stat(oldInstaller),
    stat(newInstaller),
    readFile(latestPath, 'utf8'),
  ])

  if (oldInfo.size <= 0 || newInfo.size <= 0) {
    throw new Error('Os instaladores do laboratório estão vazios.')
  }
  if (!latest.includes(`version: ${newVersion}`)) {
    throw new Error(`latest.yml não aponta para ${newVersion}.`)
  }
  if (!latest.includes(`url: AltGrid-Update-Lab-Setup-${newVersion}.exe`)) {
    throw new Error('latest.yml não aponta para o instalador novo.')
  }

  return { latestPath, newInstaller, oldInstaller }
}

async function buildLab() {
  await rm(labRoot, { force: true, recursive: true })
  await mkdir(oldOutput, { recursive: true })
  await mkdir(feedOutput, { recursive: true })
  await run('pnpm', ['desktop:compile'])
  await packageVersion(oldVersion, oldOutput)
  await packageVersion(newVersion, feedOutput)
  await compileRenderer(productionVersion)
  const artifacts = await validateLab()
  console.log(`\nLaboratório pronto.`)
  console.log(`Instalador antigo: ${artifacts.oldInstaller}`)
  console.log(`Feed novo: ${feedUrl}`)
}

async function buildNewVersion() {
  await mkdir(feedOutput, { recursive: true })
  await run('pnpm', ['desktop:compile'])
  await packageVersion(newVersion, feedOutput)
  await compileRenderer(productionVersion)
  const artifacts = await validateLab()
  console.log(`\nNova versão do laboratório pronta: ${artifacts.newInstaller}`)
}

const mimeTypes = {
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.blockmap': 'application/octet-stream',
}

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
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Length': String(info.size),
        'Content-Type': mimeTypes[extname(fileName).toLowerCase()] ?? 'application/octet-stream',
      })
      createReadStream(filePath).pipe(response)
    } catch {
      response.writeHead(404).end('Not found')
    }
  })

  server.listen(port, host, () => {
    console.log(`Feed local ativo em ${feedUrl}`)
    console.log(`Arquivos: ${(process.platform === 'win32' ? '' : '\n')}${feedOutput}`)
    console.log('Mantenha esta janela aberta durante todo o teste.')
  })
}

const command = process.argv[2] ?? 'build'
if (command === 'build') {
  await buildLab()
} else if (command === 'build-new') {
  await buildNewVersion()
} else if (command === 'serve') {
  await serveLab()
} else {
  throw new Error(`Comando desconhecido: ${command}`)
}
