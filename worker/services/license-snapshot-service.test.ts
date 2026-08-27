import { describe, expect, it } from 'vitest'

import type { PlanRecord } from '../types'
import { EntitlementService } from './entitlement-service'
import { AsymmetricLicenseSnapshotService } from './license-snapshot-service'
import { FakeRepository } from '../test/fake-repository'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-25T12:00:00.000Z')

const freePlan: PlanRecord = {
  id: 'free-plan',
  code: 'FREE',
  name: 'Free',
  max_accounts: 2,
  enabled: true,
  entitlement_rank: 0,
  features: { basic_grids: true, advanced_grids: false },
}

function standardBase64(buffer: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer
}

describe('AsymmetricLicenseSnapshotService', () => {
  it('signs a bounded license snapshot that verifies with the public key', async () => {
    const keys = await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify'],
    ) as CryptoKeyPair
    const privateKey = standardBase64(await crypto.subtle.exportKey('pkcs8', keys.privateKey))
    const repository = new FakeRepository()
    repository.plans = [freePlan]
    const service = new AsymmetricLicenseSnapshotService(
      new EntitlementService(repository, () => NOW),
      privateKey,
      'test-key-v1',
      () => NOW,
    )

    const { snapshot } = await service.createSnapshot(USER_ID)
    const payload = decodeBase64Url(snapshot.payload)
    const signature = decodeBase64Url(snapshot.signature)

    await expect(crypto.subtle.verify(
      { name: 'Ed25519' },
      keys.publicKey,
      signature,
      payload,
    )).resolves.toBe(true)
    expect(snapshot).toMatchObject({ alg: 'EdDSA', key_id: 'test-key-v1' })
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({
      user_id: USER_ID,
      plan: 'FREE',
      account_limit: 2,
      features: { basic_grids: true, advanced_grids: false },
      founder_number: null,
      lifetime: false,
      issued_at: '2026-08-25T12:00:00.000Z',
      expires_at: '2026-08-26T12:00:00.000Z',
    })
  })

  it('never issues a snapshot beyond a non-lifetime online license expiration', async () => {
    const keys = await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify'],
    ) as CryptoKeyPair
    const privateKey = standardBase64(await crypto.subtle.exportKey('pkcs8', keys.privateKey))
    const repository = new FakeRepository()
    repository.plans = [freePlan, {
      ...freePlan,
      id: 'pro-plan',
      code: 'PRO',
      name: 'PRO',
      max_accounts: 10,
      entitlement_rank: 10,
      features: { basic_grids: true, advanced_grids: true },
    }]
    repository.licenses = [{
      id: '10000000-0000-4000-8000-000000000001',
      user_id: USER_ID,
      plan_id: 'pro-plan',
      status: 'active',
      starts_at: '2026-08-24T12:00:00.000Z',
      expires_at: '2026-08-27T12:00:00.000Z',
      lifetime: false,
      founder_number: null,
      created_at: '2026-08-24T12:00:00.000Z',
    }]
    const service = new AsymmetricLicenseSnapshotService(
      new EntitlementService(repository, () => NOW),
      privateKey,
      'test-key-v1',
      () => NOW,
    )

    const { snapshot } = await service.createSnapshot(USER_ID)
    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(snapshot.payload)),
    ) as Record<string, unknown>
    expect(payload).toMatchObject({
      plan: 'PRO',
      account_limit: 10,
      expires_at: '2026-08-27T12:00:00.000Z',
    })
  })

  it('fails closed when the server signing key is absent', async () => {
    const repository = new FakeRepository()
    repository.plans = [freePlan]
    const service = new AsymmetricLicenseSnapshotService(
      new EntitlementService(repository, () => NOW),
      undefined,
      'test-key-v1',
      () => NOW,
    )

    await expect(service.createSnapshot(USER_ID)).rejects.toMatchObject({
      status: 503,
      code: 'license_snapshot_unavailable',
    })
  })

  it('maps malformed signing material to the same safe unavailable response', async () => {
    const repository = new FakeRepository()
    repository.plans = [freePlan]
    const service = new AsymmetricLicenseSnapshotService(
      new EntitlementService(repository, () => NOW),
      btoa('not-a-pkcs8-key'),
      'test-key-v1',
      () => NOW,
    )

    await expect(service.createSnapshot(USER_ID)).rejects.toMatchObject({
      status: 503,
      code: 'license_snapshot_unavailable',
      message: 'Chave de licença inválida.',
    })
  })
})
