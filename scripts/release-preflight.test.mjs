import { describe, expect, it } from 'vitest'

import {
  REQUIRED_RELEASE_ENVIRONMENT,
  validateReleasePreflight,
} from './release-preflight.mjs'

function completeEnvironment() {
  return Object.fromEntries(
    REQUIRED_RELEASE_ENVIRONMENT.map((name) => [name, `${name}-configured`]),
  )
}

describe('release preflight', () => {
  it('accepts an exact v-prefixed package version with every required setting', () => {
    expect(validateReleasePreflight({
      environment: completeEnvironment(),
      tag: 'v2.0.0',
      version: '2.0.0',
    })).toMatchObject({ errors: [], expectedTag: 'v2.0.0', missing: [] })
  })

  it('rejects a tag that does not match package.json version', () => {
    const result = validateReleasePreflight({
      environment: completeEnvironment(),
      tag: 'v2.0.1',
      version: '2.0.0',
    })

    expect(result.errors).toContain(
      'Tag v2.0.1 não corresponde à versão 2.0.0 (esperado: v2.0.0).',
    )
  })

  it('reports missing settings by name without including configured values', () => {
    const environment = completeEnvironment()
    environment.SUPABASE_ANON_KEY = '   '
    delete environment.LICENSE_PUBLIC_KEY

    const result = validateReleasePreflight({
      environment,
      tag: 'v2.0.0',
      version: '2.0.0',
    })

    expect(result.missing).toEqual(['SUPABASE_ANON_KEY', 'LICENSE_PUBLIC_KEY'])
    expect(result.errors.join(' ')).not.toContain(environment.ALTGRID_API_BASE_URL)
  })
})
