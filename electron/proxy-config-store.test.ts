import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  normalizeProxyConfig,
  ProxyConfigStore,
  proxyRules,
} from './proxy-config-store.js'

const temporaryDirectories: string[] = []

function createStore(encryptionAvailable = true) {
  const directory = mkdtempSync(join(tmpdir(), 'altgrid-proxy-test-'))
  temporaryDirectories.push(directory)
  const encryption = {
    decryptString: vi.fn((encrypted: Buffer) => (
      Buffer.from(encrypted.toString('utf8'), 'base64').toString('utf8')
    )),
    encryptString: vi.fn((plainText: string) => (
      Buffer.from(Buffer.from(plainText, 'utf8').toString('base64'), 'utf8')
    )),
    isEncryptionAvailable: vi.fn(() => encryptionAvailable),
  }
  const filePath = resolve(directory, 'proxy-config.v1.json')
  return { encryption, filePath, store: new ProxyConfigStore(filePath, encryption) }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()!
    if (resolve(directory).startsWith(resolve(tmpdir()))) {
      rmSync(directory, { force: true, recursive: true })
    }
  }
})

describe('proxy configuration', () => {
  it('normalizes supported fixed-server proxy inputs', () => {
    const config = normalizeProxyConfig({
      enabled: true,
      host: 'Proxy.Example.com',
      password: 'secret',
      port: 1080,
      protocol: 'socks5',
      username: 'player',
    })

    expect(config).toEqual({
      enabled: true,
      host: 'proxy.example.com',
      password: 'secret',
      port: 1080,
      protocol: 'socks5',
      username: 'player',
    })
    expect(proxyRules(config)).toBe('socks5://proxy.example.com:1080')
  })

  it.each([
    [{ enabled: true, host: 'https://proxy.example.com', port: 80, protocol: 'http' }],
    [{ enabled: true, host: 'proxy.example.com/path', port: 80, protocol: 'http' }],
    [{ enabled: true, host: 'proxy.example.com', port: 0, protocol: 'http' }],
    [{ enabled: true, host: 'proxy.example.com', port: 80, protocol: 'pac' }],
    [{ enabled: true, host: 'proxy.example.com', port: 80, protocol: 'http', username: 'user' }],
  ])('rejects unsafe or incomplete proxy input %#', (input) => {
    expect(() => normalizeProxyConfig(input)).toThrow()
  })

  it('encrypts credentials at rest and returns only a safe summary', () => {
    const { encryption, filePath, store } = createStore()
    const summary = store.set('account-1', {
      enabled: true,
      host: 'proxy.example.com',
      password: 'top-secret',
      port: 443,
      protocol: 'https',
      username: 'founder',
    })

    expect(summary).toEqual({
      enabled: true,
      hasPassword: true,
      host: 'proxy.example.com',
      port: 443,
      protocol: 'https',
      username: 'founder',
    })
    expect(readFileSync(filePath, 'utf8')).not.toContain('top-secret')
    expect(store.get('account-1')).toMatchObject({ password: 'top-secret' })
    expect(encryption.encryptString).toHaveBeenCalledOnce()
  })

  it('preserves an encrypted password while editing the endpoint', () => {
    const { store } = createStore()
    store.set('account-1', {
      enabled: true,
      host: 'one.example.com',
      password: 'secret',
      port: 8080,
      protocol: 'http',
      username: 'user',
    })
    store.set('account-1', {
      enabled: true,
      host: 'two.example.com',
      port: 1080,
      preservePassword: true,
      protocol: 'socks5',
      username: 'user',
    })

    expect(store.get('account-1')).toMatchObject({
      host: 'two.example.com',
      password: 'secret',
      port: 1080,
      protocol: 'socks5',
    })
  })

  it('refuses to persist proxy credentials without OS encryption', () => {
    const { store } = createStore(false)
    expect(() => store.set('account-1', {
      enabled: true,
      host: 'proxy.example.com',
      port: 8080,
      protocol: 'http',
    })).toThrow('proteção de credenciais')
  })

  it('removes only the selected account configuration', () => {
    const { store } = createStore()
    for (const accountId of ['account-1', 'account-2']) {
      store.set(accountId, {
        enabled: true,
        host: `${accountId}.example.com`,
        port: 8080,
        protocol: 'http',
      })
    }

    expect(store.remove('account-1')).toBe(true)
    expect(store.get('account-1')).toBeNull()
    expect(store.get('account-2')).not.toBeNull()
  })
})
