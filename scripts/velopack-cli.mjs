import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(process.cwd())

export function resolveDotnetHost() {
  const configured = process.env.DOTNET_HOST_PATH?.trim()
  if (configured) return resolve(configured)

  const localHost = resolve(projectRoot, '.tools', 'dotnet', 'dotnet.exe')
  return existsSync(localHost) ? localHost : 'dotnet'
}

export function runDotnet(arguments_, environment = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(resolveDotnetHost(), arguments_, {
      cwd: projectRoot,
      env: {
        ...process.env,
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_NOLOGO: '1',
        ...environment,
      },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', rejectRun)
    child.once('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`dotnet terminou com código ${code}.`))
    })
  })
}

export async function restoreVelopackCli() {
  await runDotnet(['tool', 'restore'])
}

export async function runVpk(arguments_) {
  await runDotnet(['tool', 'run', 'vpk', '--', ...arguments_])
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const command = process.argv[2]
  if (command === 'restore') {
    await restoreVelopackCli()
  } else if (command === 'vpk') {
    await runVpk(process.argv.slice(3))
  } else {
    throw new Error('Use: node scripts/velopack-cli.mjs restore|vpk [...argumentos]')
  }
}
