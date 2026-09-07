import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { Arch, Platform, build } from 'electron-builder'

const projectRoot = resolve(process.cwd())
const temporaryRoot = resolve(tmpdir())
const outputDirectory = resolve(projectRoot, 'release', 'linux')
const architectureName = process.env.ALTGRID_LINUX_ARCH?.trim().toLowerCase() || 'x64'
const architecture = architectureName === 'x64'
  ? Arch.x64
  : architectureName === 'arm64'
    ? Arch.arm64
    : null

if (architecture === null) {
  throw new Error('ALTGRID_LINUX_ARCH deve ser x64 ou arm64.')
}

const temporaryOutput = await mkdtemp(join(temporaryRoot, 'altgrid-linux-'))
if (!temporaryOutput.startsWith(temporaryRoot + sep)) {
  throw new Error('Diretório temporário de build inválido.')
}

const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const version = String(manifest.version)
const targetNames = process.platform === 'win32' ? ['dir'] : ['AppImage', 'deb']

try {
  await build({
    config: {
      directories: { output: temporaryOutput },
      linux: {
        artifactName: `AltGrid-linux-${architectureName}-${version}.\${ext}`,
        category: 'Game',
        executableName: 'altgrid',
        icon: resolve(projectRoot, 'electron/assets/icon.png'),
      },
    },
    publish: 'never',
    targets: Platform.LINUX.createTarget(targetNames, architecture),
  })

  const files = await readdir(temporaryOutput)
  if (process.platform === 'win32') {
    const unpackedDirectory = join(temporaryOutput, 'linux-unpacked')
    const unpackedInfo = await stat(unpackedDirectory)
    if (!unpackedInfo.isDirectory()) throw new Error('Pacote Linux descompactado inválido.')
    console.log('Linux x64: empacotamento descompactado validado no Windows.')
    console.log('AppImage e DEB serão gerados no runner Linux da publicação.')
  } else {
    const expected = targetNames.map((target) => (
      `AltGrid-linux-${architectureName}-${version}.${target === 'AppImage' ? 'AppImage' : 'deb'}`
    ))
    await mkdir(outputDirectory, { recursive: true })
    for (const name of expected) {
      const source = files.find((file) => file === name)
      if (!source) throw new Error(`Pacote Linux não foi gerado: ${name}`)
      const sourcePath = join(temporaryOutput, source)
      if ((await stat(sourcePath)).size <= 0) throw new Error(`${name} está vazio.`)
      await copyFile(sourcePath, join(outputDirectory, name))
    }

    console.log(`Linux ${architectureName}: ${targetNames.join(' e ')} gerado(s) em ${outputDirectory}`)
  }
  console.log('Artefatos gerados localmente; nenhuma publicação foi executada.')
} finally {
  await rm(temporaryOutput, { force: true, recursive: true })
}
