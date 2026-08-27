import { describe, expect, it, vi } from 'vitest'

import { DeviceRegistrationService } from './device-registration-service'
import type { RegisterDeviceInput } from '../types/backend-api'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  }
}

describe('DeviceRegistrationService', () => {
  it('registers one hashed random installation id without exposing hardware data', async () => {
    const registerDevice = vi.fn(async (_input: RegisterDeviceInput) => ({
      device: {} as never,
    }))
    const storage = createStorage()
    const service = new DeviceRegistrationService(
      { registerDevice },
      {
        randomUuid: () => 'installation-id-not-a-hardware-serial',
        storage,
      },
    )

    await Promise.all([
      service.register({ appVersion: '2.0.0', platform: 'win32' }),
      service.register({ appVersion: '2.0.0', platform: 'win32' }),
    ])
    await service.register({ appVersion: '2.0.0', platform: 'win32' })

    expect(registerDevice).toHaveBeenCalledOnce()
    expect(registerDevice).toHaveBeenCalledWith(expect.objectContaining({
      app_version: '2.0.0',
      display_name: 'AltGrid Desktop · win32',
      platform: 'win32',
    }))
    const input = registerDevice.mock.calls[0]![0]
    expect(input?.device_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(input?.device_hash).not.toContain('installation-id')
    expect(storage.setItem).toHaveBeenCalledOnce()
  })

  it('reuses the local installation identity across service restarts', async () => {
    const storage = createStorage()
    const firstRegister = vi.fn(async (_input: RegisterDeviceInput) => ({
      device: {} as never,
    }))
    const secondRegister = vi.fn(async (_input: RegisterDeviceInput) => ({
      device: {} as never,
    }))
    const options = {
      randomUuid: () => 'stable-installation-id',
      storage,
    }

    await new DeviceRegistrationService(
      { registerDevice: firstRegister },
      options,
    ).register({ appVersion: '2.0.0', platform: 'win32' })
    await new DeviceRegistrationService(
      { registerDevice: secondRegister },
      options,
    ).register({ appVersion: '2.0.1', platform: 'win32' })

    expect(firstRegister.mock.calls[0]![0].device_hash).toBe(
      secondRegister.mock.calls[0]![0].device_hash,
    )
    expect(storage.setItem).toHaveBeenCalledOnce()
  })
})
