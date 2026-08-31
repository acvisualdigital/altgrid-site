import type { SessionProxyProtocol } from '../../electron/contracts'

export interface ParsedProxyLine {
  host: string
  password: string
  port: number
  protocol: SessionProxyProtocol
  username: string
}

const SUPPORTED_PROTOCOLS = new Set<SessionProxyProtocol>([
  'http',
  'https',
  'socks4',
  'socks5',
])

/**
 * Accepts the provider-friendly `usuario:senha:host:porta` format as well as
 * an explicit proxy URL. Keeping the parser separate makes the compact field
 * deterministic and testable before credentials reach Electron.
 */
export function parseProxyLine(
  rawValue: string,
  fallbackProtocol: SessionProxyProtocol = 'http',
): ParsedProxyLine {
  const value = rawValue.trim()
  if (!value) {
    throw new Error('Cole o proxy no formato usuario:senha:host:porta.')
  }

  if (value.includes('://')) {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new Error('Linha de proxy inválida.')
    }

    const protocol = parsed.protocol.replace(':', '') as SessionProxyProtocol
    if (!SUPPORTED_PROTOCOLS.has(protocol)) {
      throw new Error('Protocolo de proxy inválido.')
    }
    const port = Number(parsed.port)
    if (!parsed.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('Host ou porta do proxy inválidos.')
    }

    return {
      host: parsed.hostname,
      password: decodeURIComponent(parsed.password),
      port,
      protocol,
      username: decodeURIComponent(parsed.username),
    }
  }

  const parts = value.split(':')
  if (parts.length !== 4) {
    throw new Error('Use exatamente usuario:senha:host:porta.')
  }

  const [username, password, host, rawPort] = parts.map((part) => part.trim())
  const port = Number(rawPort)
  if (!username || !password || !host) {
    throw new Error('Usuário, senha e host são obrigatórios nessa linha.')
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('A porta do proxy deve ficar entre 1 e 65535.')
  }

  return { host, password, port, protocol: fallbackProtocol, username }
}
