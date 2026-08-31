const { join } = require('node:path')

async function main() {
  const feed = process.argv[2]
  const expected = process.argv[3]
  const mode = process.argv[4] || 'update'
  if (!feed || !expected) throw new Error('Uso: <feed> <versão esperada> [update|verify]')

  const installRoot = process.env.ALTGRID_UPDATE_LAB_INSTALL_ROOT
  if (!installRoot) throw new Error('ALTGRID_UPDATE_LAB_INSTALL_ROOT não informado.')
  const currentDir = join(installRoot, 'current')
  const { UpdateManager } = require('velopack')
  const manager = new UpdateManager(feed, {
    AllowVersionDowngrade: false,
    MaximumDeltasBeforeFallback: 5,
  }, {
    RootAppDir: installRoot,
    UpdateExePath: join(installRoot, 'Update.exe'),
    PackagesDir: join(installRoot, 'packages'),
    ManifestPath: join(currentDir, 'sq.version'),
    CurrentBinaryDir: currentDir,
    IsPortable: false,
  })

  if (mode === 'verify') {
    const current = manager.getCurrentVersion()
    if (current !== expected) throw new Error(`Versão instalada ${current}; esperado ${expected}.`)
    console.log(`SMOKE_OK version=${current}`)
    return
  }

  const update = await manager.checkForUpdatesAsync()
  if (!update) throw new Error('O launcher não encontrou a atualização local.')
  if (update.TargetFullRelease.Version !== expected) {
    throw new Error(`Feed ofereceu ${update.TargetFullRelease.Version}; esperado ${expected}.`)
  }
  await manager.downloadUpdateAsync(update, (percent) => {
    if (percent === 100) console.log('DOWNLOAD_OK percent=100')
  })
  manager.waitExitThenApplyUpdate(update, true, false)
  console.log(`APPLY_SCHEDULED version=${expected}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
