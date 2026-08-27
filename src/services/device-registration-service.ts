import type { BackendApi } from './backend-api'

const INSTALLATION_ID_KEY = 'altgrid.device.installation-id.v1'

type DeviceBackend = Pick<BackendApi, 'registerDevice'>

export interface DeviceRegistrationInput {
  appVersion: string
  platform: string
}
export interface DeviceRegistrationOptions {
  randomUuid?: () => string
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return bytesToHex(new Uint8Array(digest))
}

function defaultRandomUuid(): string {
  return crypto.randomUUID()
}

/**
 * Registers a random installation identity. It deliberately avoids hardware
 * serials and sends only a one-way hash to the AltGrid backend.
 */
export class DeviceRegistrationService {
  private readonly randomUuid: () => string
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>
  private inFlight: Promise<void> | null = null
  private registeredKey: string | null = null

  constructor(
    private readonly backend: DeviceBackend,
    options: DeviceRegistrationOptions = {},
  ) {
    this.randomUuid = options.randomUuid ?? defaultRandomUuid
    this.storage = options.storage ?? localStorage
  }

  register(input: DeviceRegistrationInput): Promise<void> {
    const platform = input.platform.trim().slice(0, 100)
    const appVersion = input.appVersion.trim().slice(0, 50)
    const registrationKey = `${platform}:${appVersion}`

    if (this.registeredKey === registrationKey) {
      return Promise.resolve()
    }

    if (this.inFlight) {
      return this.inFlight
    }

    const operation = this.performRegistration(platform, appVersion)
      .then(() => {
        this.registeredKey = registrationKey
      })
      .finally(() => {
        if (this.inFlight === operation) {
          this.inFlight = null
        }
      })

    this.inFlight = operation
    return operation
  }

  private async performRegistration(
    platform: string,
    appVersion: string,
  ): Promise<void> {
    let installationId = this.storage.getItem(INSTALLATION_ID_KEY)?.trim()

    if (!installationId) {
      installationId = this.randomUuid()
      this.storage.setItem(INSTALLATION_ID_KEY, installationId)
    }

    const mobile = ['android', 'ios'].includes(platform.toLowerCase())

    await this.backend.registerDevice({
      app_version: appVersion || null,
      device_hash: await sha256(`altgrid-device-v1:${installationId}`),
      display_name: platform
        ? `AltGrid ${mobile ? 'Mobile' : 'Desktop'} · ${platform}`
        : 'AltGrid',
      platform: platform || null,
    })
  }
}
