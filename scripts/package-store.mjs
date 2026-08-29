import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { Platform, build } from 'electron-builder'

const projectRoot = resolve(process.cwd())
const manifest = JSON.parse(
  await readFile(resolve(projectRoot, 'package.json'), 'utf8'),
)

const storeIdentityName = process.env.ALTGRID_STORE_IDENTITY_NAME
  || 'ACVisualDigital.AltGrid'
const storePublisher = process.env.ALTGRID_STORE_PUBLISHER
  || 'CN=3D4AF3C6-922C-4857-9388-E115B75606CC'
const storePublisherDisplayName = process.env.ALTGRID_STORE_PUBLISHER_DISPLAY_NAME
  || 'AC Visual Digital'

const outputDirectory = resolve(projectRoot, 'store-release')
const temporaryOutput = await mkdtemp(join(tmpdir(), 'altgrid-store-'))
const artifactName = `AltGrid-Store-${manifest.version}.appx`
const storeBuildResources = resolve(projectRoot, 'store-assets')
const requiredAssets = new Map([
  ['StoreLogo.png', [50, 50]],
  ['Square44x44Logo.png', [44, 44]],
  ['Square150x150Logo.png', [150, 150]],
  ['Wide310x150Logo.png', [310, 150]],
])

async function validateAppxAssets() {
  for (const [fileName, [expectedWidth, expectedHeight]] of requiredAssets) {
    const assetPath = resolve(storeBuildResources, 'appx', fileName)
    const contents = await readFile(assetPath)
    const signature = contents.subarray(0, 8).toString('hex')
    const width = contents.readUInt32BE(16)
    const height = contents.readUInt32BE(20)

    if (
      signature !== '89504e470d0a1a0a'
      || width !== expectedWidth
      || height !== expectedHeight
    ) {
      throw new Error(
        `${fileName} deve ser um PNG ${expectedWidth}x${expectedHeight}; recebido ${width}x${height}.`,
      )
    }
  }
}

await validateAppxAssets()

async function useInstalledWindowsKitWhenAvailable() {
  if (process.platform !== 'win32' || process.env.ELECTRON_BUILDER_WINDOWS_KITS_PATH) {
    return
  }

  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (!programFilesX86) {
    return
  }

  const kitsRoot = join(programFilesX86, 'Windows Kits', '10', 'bin')
  let versions
  try {
    versions = (await readdir(kitsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^10\.\d+(?:\.\d+){2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  } catch {
    return
  }

  for (const version of versions) {
    const candidate = join(kitsRoot, version, 'x64')
    try {
      await Promise.all([
        access(join(candidate, 'makeappx.exe')),
        access(join(candidate, 'makepri.exe')),
        access(join(candidate, 'signtool.exe')),
      ])
      process.env.ELECTRON_BUILDER_WINDOWS_KITS_PATH = candidate
      console.log(`Windows Kit do sistema: ${candidate}`)
      return
    } catch {
      // Continue looking for an installed complete kit.
    }
  }
}

await useInstalledWindowsKitWhenAvailable()

try {
  await build({
    config: {
      appId: 'io.altgrid.desktop',
      productName: 'AltGrid',
      directories: {
        buildResources: storeBuildResources,
        output: temporaryOutput,
      },
      win: {
        icon: resolve(projectRoot, 'electron/assets/icon.png'),
        target: ['appx'],
      },
      appx: {
        applicationId: 'AltGrid',
        artifactName,
        backgroundColor: '#07130d',
        displayName: 'AltGrid',
        identityName: storeIdentityName,
        languages: ['pt-BR'],
        publisher: storePublisher,
        publisherDisplayName: storePublisherDisplayName,
        setBuildNumber: true,
      },
      // The legacy Windows Kit bundled with older electron-builder releases
      // cannot start on current Windows installations (side-by-side error).
      // Pin the modern 10.0.26100 toolset used to generate and validate APPX.
      toolsets: {
        winCodeSign: '1.1.0',
      },
    },
    publish: 'never',
    targets: Platform.WINDOWS.createTarget(['appx']),
  })

  await mkdir(outputDirectory, { recursive: true })
  await copyFile(join(temporaryOutput, artifactName), join(outputDirectory, artifactName))
  console.log(`Pacote Microsoft Store gerado em ${join(outputDirectory, artifactName)}`)
} finally {
  await rm(temporaryOutput, { force: true, recursive: true })
}
