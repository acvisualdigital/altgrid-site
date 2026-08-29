import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

import type {
  SessionProxyConfig,
  SessionProxyInput,
  SessionProxySummary,
} from './contracts.js'

interface EncryptionProvider {
  decryptString(encrypted: Buffer): string
  encryptString(plainText: string): Buffer
  isEncryptionAvailable(): boolean
}

interface StoredProxyDocument {
  accounts: Record<string, string>
  version: 1
}

const EMPTY_DOCUMENT: StoredProxyDocument = { accounts: {}, version: 1 }
const PROXY_PROTOCOLS = new Set(['http', 'https', 'socks4', 'socks5'])
const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

function normalizedAccountId(value: unknown): string {
  if (typeof value !== 'string' || !ACCOUNT_ID_PATTERN.test(value.trim())) {
    throw new TypeError('accountId interno inválido.')
  }
  return value.trim()
}

function normalizedHost(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Informe o servidor do proxy.')
  }

  const host = value.trim()
  if (!host || host.length > 253 || /[\s/@?#]/.test(host) || host.includes('://')) {
    throw new TypeError('Servidor de proxy inválido.')
  }

  try {
    const parsed = new URL(`http://${host}`)
    if (parsed.hostname !== host && parsed.hostname !== host.toLowerCase()) {
      throw new Error('host mismatch')
    }
  } catch {
    throw new TypeError('Servidor de proxy inválido.')
  }

  return host.toLowerCase()
}

export function normalizeProxyConfig(
  input: unknown,
  previous: SessionProxyConfig | null = null,
): SessionProxyConfig {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Configuração de proxy inválida.')
  }

  const candidate = input as Partial<SessionProxyInput>
  if (typeof candidate.enabled !== 'boolean') {
    throw new TypeError('O estado do proxy deve ser booleano.')
  }
  if (!PROXY_PROTOCOLS.has(String(candidate.protocol))) {
    throw new TypeError('Protocolo de proxy inválido.')
  }
  if (!Number.isInteger(candidate.port) || Number(candidate.port) < 1 || Number(candidate.port) > 65_535) {
    throw new RangeError('A porta do proxy deve ficar entre 1 e 65535.')
  }

  const username = String(candidate.username ?? '').trim()
  if (username.length > 256 || /[\r\n\0]/.test(username)) {
    throw new TypeError('Usuário do proxy inválido.')
  }

  let password = candidate.preservePassword && previous
    ? previous.password
    : String(candidate.password ?? '')
  if (!username) {
    password = ''
  }
  if (password.length > 1_024 || /[\r\n\0]/.test(password)) {
    throw new TypeError('Senha do proxy inválida.')
  }
  if (username && !password) {
    throw new TypeError('Informe a senha do proxy.')
  }

  return {
    enabled: candidate.enabled,
    host: normalizedHost(candidate.host),
    password,
    port: Number(candidate.port),
    protocol: candidate.protocol as SessionProxyConfig['protocol'],
    username,
  }
}

export function proxySummary(config: SessionProxyConfig): SessionProxySummary {
  return {
    enabled: config.enabled,
    hasPassword: Boolean(config.password),
    host: config.host,
    port: config.port,
    protocol: config.protocol,
    username: config.username,
  }
}

export function proxyRules(config: SessionProxyConfig): string {
  const host = config.host.includes(':') && !config.host.startsWith('[')
    ? `[${config.host}]`
    : config.host
  return `${config.protocol}://${host}:${config.port}`
}

export class ProxyConfigStore {
  constructor(
    private readonly filePath: string,
    private readonly encryption: EncryptionProvider,
  ) {}

  get(accountId: unknown): SessionProxyConfig | null {
    const normalizedId = normalizedAccountId(accountId)
    const encoded = this.readDocument().accounts[normalizedId]
    if (!encoded) {
      return null
    }

    try {
      const decrypted = this.encryption.decryptString(Buffer.from(encoded, 'base64'))
      return normalizeProxyConfig(JSON.parse(decrypted))
    } catch {
      return null
    }
  }

  set(accountId: unknown, input: unknown): SessionProxySummary {
    const normalizedId = normalizedAccountId(accountId)
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('A proteção de credenciais do Windows não está disponível.')
    }

    const config = normalizeProxyConfig(input, this.get(normalizedId))
    const document = this.readDocument()
    document.accounts[normalizedId] = this.encryption
      .encryptString(JSON.stringify(config))
      .toString('base64')
    this.writeDocument(document)
    return proxySummary(config)
  }

  remove(accountId: unknown): boolean {
    const normalizedId = normalizedAccountId(accountId)
    const document = this.readDocument()
    if (!(normalizedId in document.accounts)) {
      return false
    }

    delete document.accounts[normalizedId]
    this.writeDocument(document)
    return true
  }

  private readDocument(): StoredProxyDocument {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoredProxyDocument>
      if (parsed.version !== 1 || !parsed.accounts || typeof parsed.accounts !== 'object') {
        return { ...EMPTY_DOCUMENT, accounts: {} }
      }
      return { accounts: { ...parsed.accounts }, version: 1 }
    } catch {
      return { ...EMPTY_DOCUMENT, accounts: {} }
    }
  }

  private writeDocument(document: StoredProxyDocument): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(document), {
      encoding: 'utf8',
      mode: 0o600,
    })
    renameSync(temporaryPath, this.filePath)
  }
}
