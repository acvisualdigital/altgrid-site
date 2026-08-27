import { ApiError } from '../lib/api-error'
import type { LicenseSnapshotService } from '../types'
import { EntitlementService } from './entitlement-service'

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodePrivateKey(value: string): ArrayBuffer {
  const normalized = value
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  if (!normalized) {
    throw new ApiError(503, 'license_snapshot_unavailable', 'Assinatura offline indisponível.')
  }
  try {
    const binary = atob(normalized)
    return Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    ).buffer as ArrayBuffer
  } catch {
    throw new ApiError(503, 'license_snapshot_unavailable', 'Chave de licença inválida.')
  }
}

export class AsymmetricLicenseSnapshotService implements LicenseSnapshotService {
  private signingKey: Promise<CryptoKey> | null = null

  constructor(
    private readonly entitlements: EntitlementService,
    private readonly privateKey: string | undefined,
    private readonly keyId = 'altgrid-license-v1',
    private readonly now: () => Date = () => new Date(),
  ) {}

  private getSigningKey(): Promise<CryptoKey> {
    if (!this.privateKey?.trim()) {
      throw new ApiError(
        503,
        'license_snapshot_unavailable',
        'PRIVATE_LICENSE_KEY não configurada.',
      )
    }
    if (this.signingKey) {
      return this.signingKey
    }

    const operation = crypto.subtle.importKey(
      'pkcs8',
      decodePrivateKey(this.privateKey),
      { name: 'Ed25519' },
      false,
      ['sign'],
    ).catch(() => {
      throw new ApiError(
        503,
        'license_snapshot_unavailable',
        'Chave de licença inválida.',
      )
    })
    this.signingKey = operation
    void operation.catch(() => {
      if (this.signingKey === operation) {
        this.signingKey = null
      }
    })
    return operation
  }

  async createSnapshot(userId: string) {
    const resolution = await this.entitlements.resolveForUser(userId)
    const issuedAt = this.now()
    const policyLifetime = resolution.entitlements.plan === 'FREE'
      ? 24 * 60 * 60 * 1_000
      : 7 * 24 * 60 * 60 * 1_000
    const policyExpiration = issuedAt.getTime() + policyLifetime
    const onlineExpiration = (
      !resolution.entitlements.lifetime
      && resolution.entitlements.expires_at
    )
      ? Date.parse(resolution.entitlements.expires_at)
      : Number.POSITIVE_INFINITY
    const expiresAt = new Date(Math.min(policyExpiration, onlineExpiration))

    const payloadObject = {
      user_id: userId,
      plan: resolution.entitlements.plan,
      account_limit: resolution.entitlements.account_limit,
      features: resolution.entitlements.features,
      founder_number: resolution.entitlements.founder_number,
      lifetime: resolution.entitlements.lifetime,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    }
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObject))
    const signature = await crypto.subtle.sign(
      { name: 'Ed25519' },
      await this.getSigningKey(),
      payloadBytes,
    )

    return {
      snapshot: {
        payload: base64Url(payloadBytes),
        signature: base64Url(new Uint8Array(signature)),
        alg: 'EdDSA' as const,
        key_id: this.keyId,
      },
    }
  }
}
