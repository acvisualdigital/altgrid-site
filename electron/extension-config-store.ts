import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'

import type { SessionExtensionConfig, SessionExtensionSummary } from './contracts.js'

interface StoredExtensionDocument {
  accounts: Record<string, SessionExtensionConfig>
  version: 1
}

const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

function accountId(value: unknown): string {
  if (typeof value !== 'string' || !ACCOUNT_ID_PATTERN.test(value.trim())) {
    throw new TypeError('accountId interno inválido.')
  }
  return value.trim()
}

function extensionManifest(directoryPath: unknown): SessionExtensionSummary & { path: string } {
  if (typeof directoryPath !== 'string' || !isAbsolute(directoryPath)) {
    throw new TypeError('Selecione uma pasta de extensão válida.')
  }
  const path = realpathSync(directoryPath)
  if (!statSync(path).isDirectory()) throw new TypeError('A extensão deve ser uma pasta.')

  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')) as Record<string, unknown>
  } catch {
    throw new TypeError('A pasta não contém um manifest.json válido.')
  }

  const name = typeof manifest.name === 'string' ? manifest.name.trim() : ''
  const version = typeof manifest.version === 'string' ? manifest.version.trim() : ''
  const manifestVersion = Number(manifest.manifest_version)
  if (!name || name.length > 120 || !version || version.length > 40) {
    throw new TypeError('O nome ou a versão da extensão é inválido.')
  }
  if (manifestVersion !== 2 && manifestVersion !== 3) {
    throw new TypeError('Somente extensões Manifest V2 ou V3 são aceitas.')
  }

  const permissions = [...new Set([
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ].filter((value): value is string => typeof value === 'string'))]
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 40)

  return {
    enabled: true,
    folderName: basename(path),
    manifestVersion,
    name,
    path,
    permissions,
    version,
  }
}

function summary(config: SessionExtensionConfig): SessionExtensionSummary {
  const { path: _path, ...visible } = config
  return visible
}

export class ExtensionConfigStore {
  constructor(private readonly filePath: string) {}

  get(accountIdValue: unknown): SessionExtensionConfig | null {
    const stored = this.readDocument().accounts[accountId(accountIdValue)]
    if (!stored) return null
    try {
      const validated = extensionManifest(stored.path)
      return { ...validated, enabled: stored.enabled !== false }
    } catch {
      return null
    }
  }

  getSummary(accountIdValue: unknown): SessionExtensionSummary | null {
    const config = this.get(accountIdValue)
    return config ? summary(config) : null
  }

  setFromDirectory(accountIdValue: unknown, directoryPath: unknown): SessionExtensionSummary {
    const id = accountId(accountIdValue)
    const config = extensionManifest(directoryPath)
    const document = this.readDocument()
    document.accounts[id] = config
    this.writeDocument(document)
    return summary(config)
  }

  setEnabled(accountIdValue: unknown, enabled: unknown): SessionExtensionSummary {
    if (typeof enabled !== 'boolean') throw new TypeError('Estado da extensão inválido.')
    const id = accountId(accountIdValue)
    const current = this.get(id)
    if (!current) throw new Error('Nenhuma extensão foi configurada nesta conta.')
    const document = this.readDocument()
    document.accounts[id] = { ...current, enabled }
    this.writeDocument(document)
    return summary({ ...current, enabled })
  }

  copy(sourceAccountId: unknown, targetAccountId: unknown): SessionExtensionSummary | null {
    const source = this.get(sourceAccountId)
    if (!source) return null
    const document = this.readDocument()
    document.accounts[accountId(targetAccountId)] = { ...source }
    this.writeDocument(document)
    return summary(source)
  }

  remove(accountIdValue: unknown): boolean {
    const id = accountId(accountIdValue)
    const document = this.readDocument()
    if (!(id in document.accounts)) return false
    delete document.accounts[id]
    this.writeDocument(document)
    return true
  }

  private readDocument(): StoredExtensionDocument {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoredExtensionDocument>
      if (parsed.version !== 1 || !parsed.accounts || typeof parsed.accounts !== 'object') {
        return { accounts: {}, version: 1 }
      }
      return { accounts: { ...parsed.accounts }, version: 1 }
    } catch {
      return { accounts: {}, version: 1 }
    }
  }

  private writeDocument(document: StoredExtensionDocument): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(document), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
  }
}
