import type {
  AdminMobileNotificationInput,
  AdminMobileNotifier,
  AdminRepository,
} from '../types'

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

interface FirebaseAdminNotifierOptions {
  projectId?: string
  repository: AdminRepository
  serviceAccountJson?: string
  fetchImplementation?: typeof fetch
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function parseServiceAccount(value: string | undefined): ServiceAccount | null {
  if (!value?.trim()) return null
  try {
    const parsed = JSON.parse(value) as Partial<ServiceAccount>
    return parsed.client_email?.trim() && parsed.private_key?.includes('PRIVATE KEY')
      ? parsed as ServiceAccount
      : null
  } catch {
    return null
  }
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (character) => character.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

function compactBody(input: AdminMobileNotificationInput): string {
  return input.details
    .slice(0, 5)
    .map((detail) => `${detail.label}: ${detail.value}`)
    .join(' • ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .slice(0, 450) || 'Abra o painel administrativo para conferir os detalhes.'
}

export class FirebaseAdminNotifier implements AdminMobileNotifier {
  readonly enabled: boolean
  private readonly fetchImplementation: typeof fetch
  private readonly serviceAccount: ServiceAccount | null
  private accessToken: { token: string; expiresAt: number } | null = null

  constructor(private readonly options: FirebaseAdminNotifierOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.serviceAccount = parseServiceAccount(options.serviceAccountJson)
    this.enabled = Boolean(options.projectId?.trim() && this.serviceAccount)
  }

  async notify(input: AdminMobileNotificationInput): Promise<void> {
    if (!this.enabled) return
    const tokens = await this.options.repository.getActiveAdminPushTokens()
    if (tokens.length === 0) return
    const accessToken = await this.getAccessToken()
    const projectId = this.options.projectId!.trim()
    const title = `AltGrid ADM — ${input.title}`.slice(0, 100)
    const body = compactBody(input)
    const results = await Promise.allSettled(tokens.map((token) => (
      this.fetchImplementation(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body },
              data: {
                event_key: input.eventKey,
                event_type: input.type,
                occurred_at: input.occurredAt ?? new Date().toISOString(),
              },
              android: {
                priority: 'high',
                notification: {
                  channel_id: 'altgrid_admin_alerts',
                  default_sound: true,
                  notification_priority: 'PRIORITY_MAX',
                  visibility: 'PRIVATE',
                },
              },
            },
          }),
          signal: AbortSignal.timeout(8_000),
        },
      ).then((response) => {
        if (!response.ok) throw new Error(`FCM returned HTTP ${response.status}`)
      })
    )))
    if (results.every((result) => result.status === 'rejected')) {
      throw new Error('FCM delivery failed for every registered admin device')
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.token
    }
    const account = this.serviceAccount!
    const tokenUri = account.token_uri?.trim() || 'https://oauth2.googleapis.com/token'
    const now = Math.floor(Date.now() / 1000)
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = base64Url(JSON.stringify({
      aud: tokenUri,
      exp: now + 3600,
      iat: now,
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    }))
    const unsigned = `${header}.${claims}`
    const signature = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      await importPrivateKey(account.private_key),
      new TextEncoder().encode(unsigned),
    )
    const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`
    const response = await this.fetchImplementation(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        assertion,
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error(`Google OAuth returned HTTP ${response.status}`)
    const payload = await response.json() as { access_token?: string; expires_in?: number }
    if (!payload.access_token) throw new Error('Google OAuth response did not include an access token')
    this.accessToken = {
      token: payload.access_token,
      expiresAt: Date.now() + Math.max(300, payload.expires_in ?? 3600) * 1000,
    }
    return this.accessToken.token
  }
}
