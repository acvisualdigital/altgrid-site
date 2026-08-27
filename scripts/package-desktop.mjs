import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

import { Platform, build } from 'electron-builder'

const projectRoot = resolve(process.cwd())
const temporaryRoot = resolve(tmpdir())
const temporaryOutput = await mkdtemp(join(temporaryRoot, 'altgrid-build-'))
const releaseDirectory = resolve(projectRoot, 'release')

if (!temporaryOutput.startsWith(temporaryRoot + sep)) {
  throw new Error('Diretório temporário de build inválido.')
}
if (!releaseDirectory.startsWith(projectRoot + sep)) {
  throw new Error('Diretório de release fora do projeto.')
}

const manifest = JSON.parse(
  await readFile(join(projectRoot, 'package.json'), 'utf8'),
)
const version = String(manifest.version)
const artifactNames = [
  `AltGrid-Setup-${version}.exe`,
  `AltGrid-Setup-${version}.exe.blockmap`,
  `AltGrid-Portable-${version}.exe`,
  'latest.yml',
]

function readYamlScalar(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(
    new RegExp(`^${escapedKey}:\\s*["']?([^"'#\\r\\n]+)`, 'm'),
  )
  return match?.[1].trim()
}

async function validateUpdateMetadata() {
  const setupArtifactName = `AltGrid-Setup-${version}.exe`
  const latestPath = join(temporaryOutput, 'latest.yml')
  const appUpdatePath = join(
    temporaryOutput,
    'win-unpacked',
    'resources',
    'app-update.yml',
  )
  const [latest, appUpdate] = await Promise.all([
    readFile(latestPath, 'utf8'),
    readFile(appUpdatePath, 'utf8'),
  ])

  if (readYamlScalar(latest, 'version') !== version) {
    throw new Error(`latest.yml não aponta para a versão ${version}.`)
  }
  if (readYamlScalar(latest, 'path') !== setupArtifactName) {
    throw new Error(`latest.yml não aponta para ${setupArtifactName}.`)
  }
  if (!latest.includes(`url: ${setupArtifactName}`)) {
    throw new Error(`latest.yml não lista ${setupArtifactName}.`)
  }

  const expectedProvider = {
    provider: 'github',
    owner: 'acvisualdigital',
    repo: 'altgrid-releases',
  }
  for (const [key, expectedValue] of Object.entries(expectedProvider)) {
    if (readYamlScalar(appUpdate, key) !== expectedValue) {
      throw new Error(
        `app-update.yml possui ${key} inválido; esperado: ${expectedValue}.`,
      )
    }
  }

  console.log('Metadados de atualização automática validados.')
}

try {
  await build({
    config: {
      directories: { output: temporaryOutput },
    },
    publish: 'never',
    targets: Platform.WINDOWS.createTarget(['nsis', 'portable']),
  })

  await validateUpdateMetadata()
  await mkdir(releaseDirectory, { recursive: true })
  for (const artifactName of artifactNames) {
    await copyFile(
      join(temporaryOutput, artifactName),
      join(releaseDirectory, artifactName),
    )
    console.log(`Artefato: release/${artifactName}`)
  }
} finally {
  await rm(temporaryOutput, { force: true, recursive: true }).catch(() => {
    console.warn(`Build temporário mantido em ${temporaryOutput}`)
  })
}
