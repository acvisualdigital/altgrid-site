import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { Arch, Platform, build } from 'electron-builder'

const projectRoot = resolve(process.cwd())
const temporaryRoot = resolve(tmpdir())
const releaseDirectory = resolve(projectRoot, 'release', 'mac')
const architectureName = process.env.ALTGRID_MAC_ARCH?.trim().toLowerCase() || 'arm64'
const architecture = architectureName === 'arm64'
  ? Arch.arm64
  : architectureName === 'x64'
    ? Arch.x64
    : null

if (process.platform !== 'darwin') {
  throw new Error('O pacote macOS precisa ser gerado em um computador ou runner macOS.')
}
if (architecture === null) {
  throw new Error('ALTGRID_MAC_ARCH deve ser arm64 ou x64.')
}
const temporaryOutput = await mkdtemp(join(temporaryRoot, 'altgrid-macos-'))
if (!temporaryOutput.startsWith(temporaryRoot + sep)) {
  throw new Error('Diretório temporário de build inválido.')
}

const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const version = String(manifest.version)
const signed = Boolean(process.env.CSC_LINK?.trim() && process.env.CSC_KEY_PASSWORD?.trim())
const notarized = Boolean(
  signed
  && process.env.APPLE_ID?.trim()
  && process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim()
  && process.env.APPLE_TEAM_ID?.trim(),
)

try {
  await build({
    config: {
      directories: { output: temporaryOutput },
      mac: {
        artifactName: `AltGrid-mac-${architectureName}-${version}.\${ext}`,
        category: 'public.app-category.utilities',
        entitlements: 'electron/entitlements.mac.plist',
        entitlementsInherit: 'electron/entitlements.mac.plist',
        gatekeeperAssess: false,
        hardenedRuntime: true,
        icon: 'electron/assets/icon.png',
        identity: signed ? undefined : null,
        notarize: notarized ? { teamId: process.env.APPLE_TEAM_ID } : false,
      },
    },
    publish: 'never',
    targets: Platform.MAC.createTarget(['dmg', 'zip'], architecture),
  })

  const expected = new Map([
    ['dmg', `AltGrid-mac-${architectureName}-${version}.dmg`],
    ['zip', `AltGrid-mac-${architectureName}-${version}.zip`],
  ])
  const files = await readdir(temporaryOutput)
  await mkdir(releaseDirectory, { recursive: true })
  for (const [extension, name] of expected) {
    const source = files.find((file) => file === name)
    if (!source) throw new Error(`Pacote ${extension.toUpperCase()} não foi gerado.`)
    const sourcePath = join(temporaryOutput, source)
    if ((await stat(sourcePath)).size <= 0) throw new Error(`${source} está vazio.`)
    await copyFile(sourcePath, join(releaseDirectory, name))
  }

  console.log(`macOS ${architectureName}: DMG e ZIP gerados em ${releaseDirectory}`)
  console.log(signed ? 'Assinatura Developer ID habilitada.' : 'Pacote sem assinatura Apple.')
  console.log(notarized ? 'Notarização Apple habilitada.' : 'Pacote sem notarização Apple.')
} finally {
  await rm(temporaryOutput, { force: true, recursive: true })
}
