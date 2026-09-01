import type {
  AdminMobileNotificationInput,
  AdminMobileNotifier,
} from '../types'

interface WhatsAppAdminNotifierOptions {
  accessToken?: string
  apiVersion?: string
  destinationNumber?: string
  fetchImplementation?: typeof fetch
  phoneNumberId?: string
  templateLanguage?: string
  templateName?: string
}

const TYPE_EMOJI: Record<AdminMobileNotificationInput['type'], string> = {
  ad_request: '📣',
  chat_direct: '💬',
  chat_report: '🚨',
  purchase_approved: '✅',
  purchase_attempt: '🛒',
}

function cleanSingleLine(value: string, maximum = 240): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
}

function digits(value: string | undefined): string | null {
  const normalized = (value ?? '').replace(/\D/g, '')
  return /^\d{8,15}$/.test(normalized) ? normalized : null
}

function notificationText(input: AdminMobileNotificationInput): string {
  const title = cleanSingleLine(input.title, 80)
  const details = input.details
    .slice(0, 12)
    .map((detail) => `*${cleanSingleLine(detail.label, 40)}:* ${cleanSingleLine(detail.value)}`)
    .filter((line) => !line.endsWith(': '))
  const occurredAt = input.occurredAt && !Number.isNaN(Date.parse(input.occurredAt))
    ? new Date(input.occurredAt).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
    : new Date().toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
  return [
    `${TYPE_EMOJI[input.type]} *AltGrid — ${title}*`,
    '',
    ...details,
    `*Horário:* ${occurredAt}`,
  ].join('\n').slice(0, 3_900)
}

export class WhatsAppAdminNotifier implements AdminMobileNotifier {
  private readonly fetchImplementation: typeof fetch
  readonly enabled: boolean

  constructor(private readonly options: WhatsAppAdminNotifierOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.enabled = Boolean(
      options.accessToken?.trim()
      && digits(options.phoneNumberId)
      && digits(options.destinationNumber),
    )
  }

  async notify(input: AdminMobileNotificationInput): Promise<void> {
    const token = this.options.accessToken?.trim()
    const phoneNumberId = digits(this.options.phoneNumberId)
    const destination = digits(this.options.destinationNumber)
    if (!this.enabled || !token || !phoneNumberId || !destination) return

    const configuredVersion = this.options.apiVersion?.trim() || 'v23.0'
    const apiVersion = /^v\d{1,2}\.\d{1,2}$/.test(configuredVersion)
      ? configuredVersion
      : 'v23.0'
    const text = notificationText(input)
    const templateName = this.options.templateName?.trim()
    const message = templateName && /^[a-z0-9_]{1,512}$/.test(templateName)
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destination,
          type: 'template',
          template: {
            name: templateName,
            language: { code: this.options.templateLanguage?.trim() || 'pt_BR' },
            components: [{ type: 'body', parameters: [{ type: 'text', text }] }],
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destination,
          type: 'text',
          text: { body: text, preview_url: false },
        }
    const response = await this.fetchImplementation(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(5_000),
      },
    )
    if (!response.ok) {
      throw new Error(`WhatsApp API returned HTTP ${response.status}`)
    }
  }
}
