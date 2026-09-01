import { describe, expect, it, vi } from 'vitest'

import { WhatsAppAdminNotifier } from './whatsapp-admin-notifier'

describe('WhatsAppAdminNotifier', () => {
  it('sends a compact detailed notification without exposing the access token', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
    const notifier = new WhatsAppAdminNotifier({
      accessToken: 'secret-token',
      apiVersion: 'v23.0',
      destinationNumber: '+55 (71) 99999-0000',
      fetchImplementation: fetcher,
      phoneNumberId: '1234567890',
    })

    await notifier.notify({
      eventKey: 'payment:one:approved',
      type: 'purchase_approved',
      title: 'Compra aprovada',
      occurredAt: '2026-09-01T12:00:00.000Z',
      details: [
        { label: 'Cliente', value: 'Caco · cliente@example.com' },
        { label: 'Valor', value: 'BRL 129.90' },
      ],
    })

    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v23.0/1234567890/messages')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret-token')
    const body = JSON.parse(String(init.body))
    expect(body.to).toBe('5571999990000')
    expect(body.text.body).toContain('Compra aprovada')
    expect(body.text.body).toContain('cliente@example.com')
    expect(JSON.stringify(body)).not.toContain('secret-token')
  })

  it('stays disabled when server credentials are incomplete', async () => {
    const fetcher = vi.fn()
    const notifier = new WhatsAppAdminNotifier({ fetchImplementation: fetcher })
    await notifier.notify({
      eventKey: 'test',
      type: 'chat_report',
      title: 'Teste',
      details: [],
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
