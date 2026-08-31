import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { Platform, build } from 'electron-builder'

import { restoreVelopackCli, runVpk } from './velopack-cli.mjs'

const projectRoot = resolve(process.cwd())
const temporaryRoot = resolve(tmpdir())
const temporaryOutput = await mkdtemp(join(temporaryRoot, 'altgrid-electron-'))
const temporaryReleases = await mkdtemp(join(temporaryRoot, 'altgrid-velopack-'))
const releaseDirectory = resolve(projectRoot, 'release', 'velopack')
const unpackedDirectory = join(temporaryOutput, 'win-unpacked')

for (const candidate of [temporaryOutput, temporaryReleases]) {
  if (!candidate.startsWith(temporaryRoot + sep)) {
    throw new Error('Diretório temporário de build inválido.')
  }
}
if (!releaseDirectory.startsWith(resolve(projectRoot, 'release') + sep)) {
  throw new Error('Diretório de release fora do projeto.')
}

const manifest = JSON.parse(
  await readFile(join(projectRoot, 'package.json'), 'utf8'),
)
const version = String(manifest.version)
const releaseNotesPath = resolve(projectRoot, 'release-notes', `v${version}.md`)

async function validateArtifacts() {
  const files = await readdir(temporaryReleases)
  const setup = files.find((file) => /Setup.*\.exe$/i.test(file))
  const portable = files.find((file) => /Portable.*\.zip$/i.test(file))
  const feed = files.find((file) => /^releases\.win-x64\.json$/i.test(file))
  const fullPackage = files.find((file) => /-full\.nupkg$/i.test(file))

  if (!setup || !portable || !feed || !fullPackage) {
    throw new Error(
      `Saída Velopack incompleta: ${files.sort().join(', ')}`,
    )
  }

  for (const fileName of [setup, portable, feed, fullPackage]) {
    const info = await stat(join(temporaryReleases, fileName))
    if (info.size <= 0) throw new Error(`${fileName} está vazio.`)
  }

  const feedContents = JSON.parse(
    await readFile(join(temporaryReleases, feed), 'utf8'),
  )
  const serializedFeed = JSON.stringify(feedContents)
  if (!serializedFeed.includes(version) || !serializedFeed.includes(fullPackage)) {
    throw new Error('O feed Velopack não referencia a versão e o pacote gerados.')
  }

  return { feed, fullPackage, portable, setup }
}

try {
  await restoreVelopackCli()
  await build({
    config: {
      directories: { output: temporaryOutput },
      win: { target: ['dir'] },
    },
    publish: 'never',
    targets: Platform.WINDOWS.createTarget(['dir']),
  })

  const packArguments = [
    'pack',
    '--packId', 'AltGrid',
    '--packVersion', version,
    '--packDir', unpackedDirectory,
    '--mainExe', 'AltGrid.exe',
    '--packTitle', 'AltGrid',
    '--packAuthors', 'AC Visual Digital',
    '--outputDir', temporaryReleases,
    '--channel', 'win-x64',
    '--runtime', 'win-x64',
    '--icon', resolve(projectRoot, 'electron', 'assets', 'icon.ico'),
    '--shortcuts', 'Desktop,StartMenuRoot',
    '--instLocation', 'PerUser',
  ]
  try {
    await stat(releaseNotesPath)
    packArguments.push('--releaseNotes', releaseNotesPath)
  } catch {
    // Release notes are optional for local builds.
  }
  await runVpk(packArguments)

  const artifacts = await validateArtifacts()
  await rm(releaseDirectory, { force: true, recursive: true })
  await mkdir(releaseDirectory, { recursive: true })
  await cp(temporaryReleases, releaseDirectory, { recursive: true })

  console.log(`Launcher/Setup: ${join(releaseDirectory, artifacts.setup)}`)
  console.log(`Portátil: ${join(releaseDirectory, artifacts.portable)}`)
  console.log(`Feed: ${join(releaseDirectory, artifacts.feed)}`)
  console.log('Artefatos gerados localmente; nenhuma publicação foi executada.')
} finally {
  await Promise.all([
    rm(temporaryOutput, { force: true, recursive: true }),
    rm(temporaryReleases, { force: true, recursive: true }),
  ])
}
