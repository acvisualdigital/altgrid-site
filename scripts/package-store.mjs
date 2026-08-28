import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
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

try {
  await build({
    config: {
      appId: 'io.altgrid.desktop',
      productName: 'AltGrid',
      directories: { output: temporaryOutput },
      win: {
        target: ['appx'],
      },
      appx: {
        applicationId: 'AltGrid',
        artifactName,
        displayName: 'AltGrid',
        identityName: storeIdentityName,
        languages: ['pt-BR'],
        publisher: storePublisher,
        publisherDisplayName: storePublisherDisplayName,
        setBuildNumber: true,
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
