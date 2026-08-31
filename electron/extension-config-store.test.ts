import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ExtensionConfigStore } from './extension-config-store.js'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'altgrid-extension-test-'))
  temporaryDirectories.push(path)
  return path
}

function extensionFolder(root: string): string {
  const path = join(root, 'sample-extension')
  mkdirSync(path)
  writeFileSync(join(path, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Idle Helper',
    permissions: ['storage'],
    host_permissions: ['https://game.example/*'],
    version: '1.2.0',
  }))
  return path
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach((path) => rmSync(path, { force: true, recursive: true }))
})

describe('ExtensionConfigStore', () => {
  it('validates and persists an unpacked extension without exposing its full path', () => {
    const root = temporaryDirectory()
    const store = new ExtensionConfigStore(join(root, 'config.json'))
    const summary = store.setFromDirectory('account-1', extensionFolder(root))

    expect(summary).toEqual({
      enabled: true,
      folderName: 'sample-extension',
      manifestVersion: 3,
      name: 'Idle Helper',
      permissions: ['storage', 'https://game.example/*'],
      version: '1.2.0',
    })
    expect(store.setEnabled('account-1', false).enabled).toBe(false)
    expect(store.get('account-1')?.path).toContain('sample-extension')
  })

  it('rejects folders without a compatible manifest', () => {
    const root = temporaryDirectory()
    const invalid = join(root, 'invalid')
    mkdirSync(invalid)
    const store = new ExtensionConfigStore(join(root, 'config.json'))
    expect(() => store.setFromDirectory('account-1', invalid)).toThrow(/manifest\.json/i)
  })

  it('copies and removes the assignment independently per account', () => {
    const root = temporaryDirectory()
    const store = new ExtensionConfigStore(join(root, 'config.json'))
    store.setFromDirectory('source', extensionFolder(root))
    expect(store.copy('source', 'target')?.name).toBe('Idle Helper')
    expect(store.remove('source')).toBe(true)
    expect(store.getSummary('source')).toBeNull()
    expect(store.getSummary('target')?.enabled).toBe(true)
  })
})
