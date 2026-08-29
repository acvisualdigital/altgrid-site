import { describe, expect, it } from 'vitest'

import {
  isStonegyUrl,
  loadStonegyBotScripts,
  normalizeDiscordWebhookRequest,
  STONEGY_BOT_RETRY_DELAYS_MS,
  STONEGY_BOT_VERSION,
  stonegyBotProbeScript,
} from './stonegy-bot.js'

describe('Stonegy bot security boundary', () => {
  it('accepts only HTTPS pages on the official Stonegy domain', () => {
    expect(isStonegyUrl('https://stonegy-online.com/play')).toBe(true)
    expect(isStonegyUrl('https://game.stonegy-online.com/')).toBe(true)

    expect(isStonegyUrl('http://stonegy-online.com/play')).toBe(false)
    expect(isStonegyUrl('https://stonegy-online.com.evil.example/play')).toBe(false)
    expect(isStonegyUrl('https://evilstonegy-online.com/play')).toBe(false)
    expect(isStonegyUrl('not-a-url')).toBe(false)
  })

  it('allows only official HTTPS Discord webhook endpoints', () => {
    expect(normalizeDiscordWebhookRequest(
      'https://discord.com/api/webhooks/123/token',
      { content: 'Teste' },
    )).toEqual({
      body: '{"content":"Teste"}',
      url: 'https://discord.com/api/webhooks/123/token',
    })

    expect(() => normalizeDiscordWebhookRequest(
      'https://discord.com.evil.example/api/webhooks/123/token',
      { content: 'Teste' },
    )).toThrow('Somente webhooks oficiais do Discord')
    expect(() => normalizeDiscordWebhookRequest(
      'http://discord.com/api/webhooks/123/token',
      { content: 'Teste' },
    )).toThrow('Somente webhooks oficiais do Discord')
    expect(() => normalizeDiscordWebhookRequest(
      'https://discord.com/channels/123/456',
      { content: 'Teste' },
    )).toThrow('Somente webhooks oficiais do Discord')
  })

  it('uses the AltGrid Bot brand in outgoing Discord messages', () => {
    expect(normalizeDiscordWebhookRequest(
      'https://discord.com/api/webhooks/123/token',
      {
        embeds: [{ footer: { text: 'STONER • backup automático' } }],
        username: 'STONER — Loot Splitter',
      },
    ).body).toBe(
      '{"embeds":[{"footer":{"text":"AltGrid Bot • backup automático"}}],"username":"AltGrid Bot — Loot Splitter"}',
    )
  })

  it('rejects oversized webhook payloads', () => {
    expect(() => normalizeDiscordWebhookRequest(
      'https://discord.com/api/webhooks/123/token',
      { content: 'x'.repeat(256_001) },
    )).toThrow('excede o limite')
  })

  it('loads the audited bot in a deterministic isolated-world sequence', () => {
    const scripts = loadStonegyBotScripts()

    expect(scripts.map((script) => script.url)).toEqual([
      'altgrid://stoner/bridge.js',
      'altgrid://stoner/stoner-hunt-catalog.js',
      'altgrid://stoner/stoner-bot.js',
      'altgrid://stoner/stoner-enhancements.js',
      'altgrid://stoner/ready.js',
    ])
    expect(scripts.every((script) => script.code.trim().length > 0)).toBe(true)
    expect(scripts[0]?.code).toContain('__ALTGRID_BOT_LOGO__')
    expect(scripts[0]?.code).toContain('data:image/png;base64,')
    expect(scripts[2]?.code).toMatch(/^globalThis\.__STONER_LOGO__=globalThis\.__ALTGRID_BOT_LOGO__;/)
    expect(scripts[2]?.code).not.toMatch(/^globalThis\.__STONER_LOGO__="data:image\/png;base64,/)
    expect(scripts[2]?.code).toContain('_0x2ff2da(_0x4f6a67()?"PARTY_WAIT":"EXPLORE")')
    expect(scripts[2]?.code).toContain(
      'case\'LEAVING\':{if(_0x3b6bc0())_0x2ff2da(_0x475959());else',
    )
    expect(scripts[2]?.code).not.toContain(
      'if(_0x473bb8())_0x2ff2da(\'HUNTING\');else{if(_0x3b6bc0())_0x2ff2da(_0x475959());else',
    )
    expect(scripts[2]?.code).toContain('setPhase: (phase)')
    expect(scripts[2]?.code).toContain('start: ()')
    expect(scripts[3]?.code).toContain('installEmptyQuickSellGuard')
    expect(scripts[3]?.code).toContain('driveInitialHuntStart')
    expect(scripts.at(-1)?.code).toContain(STONEGY_BOT_VERSION)
    expect(stonegyBotProbeScript()[0]).toMatchObject({
      code: expect.stringContaining('#stonegy-auto-hunt-fab'),
      url: 'altgrid://stoner/probe.js',
    })
    expect(STONEGY_BOT_RETRY_DELAYS_MS).toEqual([
      0,
      500,
      1_500,
      3_000,
      6_000,
      10_000,
      15_000,
    ])
  })
})
