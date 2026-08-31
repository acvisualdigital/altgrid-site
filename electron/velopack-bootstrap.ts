import { VelopackApp } from 'velopack'

// Velopack must process installer/update hooks before Electron creates windows,
// obtains the single-instance lock or starts any native game renderer.
if (process.platform === 'win32') {
  VelopackApp.build()
    .setAutoApplyOnStartup(true)
    .run()
}
