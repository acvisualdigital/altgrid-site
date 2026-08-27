import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'

export const REQUIRED_RELEASE_ENVIRONMENT = Object.freeze([
  'ALTGRID_API_BASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'LICENSE_PUBLIC_KEY',
])

export function validateReleasePreflight({ environment, tag, version }) {
  const errors = []
  const expectedTag = `v${version}`

  if (!tag) {
    errors.push('RELEASE_TAG/GITHUB_REF_NAME não informado.')
  } else if (tag !== expectedTag) {
    errors.push(`Tag ${tag} não corresponde à versão ${version} (esperado: ${expectedTag}).`)
  }

  const missing = REQUIRED_RELEASE_ENVIRONMENT.filter(
    (name) => !String(environment[name] ?? '').trim(),
  )
  if (missing.length > 0) {
    errors.push(`Configuração de release ausente: ${missing.join(', ')}.`)
  }

  return { errors, expectedTag, missing }
}

function readTag(argumentsList, environment) {
  const tagArgument = argumentsList.find((argument) => argument.startsWith('--tag='))
  return (
    tagArgument?.slice('--tag='.length)
    || environment.RELEASE_TAG
    || environment.GITHUB_REF_NAME
    || ''
  ).trim()
}

export async function runReleasePreflight({
  argumentsList = process.argv.slice(2),
  environment = process.env,
  projectRoot = process.cwd(),
} = {}) {
  const manifest = JSON.parse(
    await readFile(resolve(projectRoot, 'package.json'), 'utf8'),
  )
  const version = String(manifest.version ?? '').trim()
  if (!version) {
    throw new Error('package.json não possui uma versão válida.')
  }

  // Local releases use the same Vite environment files as the renderer.
  // Explicit process/CI values always win over values loaded from disk.
  const effectiveEnvironment = {
    ...loadEnv('production', projectRoot, ''),
    ...environment,
  }
  const tag = readTag(argumentsList, effectiveEnvironment)
  const result = validateReleasePreflight({
    environment: effectiveEnvironment,
    tag,
    version,
  })
  if (result.errors.length > 0) {
    throw new Error(result.errors.join('\n'))
  }

  return { tag, version }
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : ''

if (currentFile === invokedFile) {
  try {
    const { tag, version } = await runReleasePreflight()
    console.log(`Preflight aprovado para ${tag} (versão ${version}).`)
  } catch (error) {
    console.error(`Preflight de release falhou:\n${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
