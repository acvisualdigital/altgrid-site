import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STONEGY_BOT_WORLD_ID } from './contracts.js'

export const STONEGY_BOT_FEATURE = 'stonegy_bot'
export const STONEGY_BOT_VERSION = '2.1.6'
export const STONEGY_BOT_RETRY_DELAYS_MS = Object.freeze([
  0,
  500,
  1_500,
  3_000,
  6_000,
  10_000,
  15_000,
])

const STONEGY_ROOT_HOST = 'stonegy-online.com'
const DISCORD_WEBHOOK_HOSTS = new Set(['discord.com', 'discordapp.com'])
const MAX_DISCORD_PAYLOAD_BYTES = 256_000
const assetDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'electron',
  'assets',
  'stoner',
)

interface StonegyBotAssets {
  bot: string
  catalog: string
  enhancements: string
  logo: string
}

export interface StonegyBotScript {
  code: string
  url: string
}

export interface DiscordWebhookRequest {
  body: string
  url: string
}

let cachedAssets: StonegyBotAssets | null = null

export function isStonegyUrl(input: unknown): boolean {
  if (typeof input !== 'string') {
    return false
  }

  try {
    const url = new URL(input)
    return url.protocol === 'https:' && (
      url.hostname === STONEGY_ROOT_HOST
      || url.hostname.endsWith(`.${STONEGY_ROOT_HOST}`)
    )
  } catch {
    return false
  }
}

export function normalizeDiscordWebhookRequest(
  rawWebhook: unknown,
  payload: unknown,
): DiscordWebhookRequest {
  if (typeof rawWebhook !== 'string') {
    throw new TypeError('URL do webhook inválida.')
  }

  let webhook: URL
  try {
    webhook = new URL(rawWebhook)
  } catch {
    throw new TypeError('URL do webhook inválida.')
  }

  const pathParts = webhook.pathname.split('/').filter(Boolean)
  if (
    webhook.protocol !== 'https:'
    || !DISCORD_WEBHOOK_HOSTS.has(webhook.hostname)
    || pathParts.length < 4
    || pathParts[0] !== 'api'
    || pathParts[1] !== 'webhooks'
  ) {
    throw new TypeError('Somente webhooks oficiais do Discord são permitidos.')
  }

  let body: string
  try {
    body = JSON.stringify(payload, (_key, value) => (
      typeof value === 'string'
        ? value.replace(/stoner/gi, 'AltGrid Bot')
        : value
    ))
  } catch {
    throw new TypeError('O conteúdo do webhook é inválido.')
  }

  if (Buffer.byteLength(body, 'utf8') > MAX_DISCORD_PAYLOAD_BYTES) {
    throw new RangeError('O conteúdo do webhook excede o limite permitido.')
  }

  return { body, url: webhook.href }
}

export function stonegyBotWorldId(): number {
  return STONEGY_BOT_WORLD_ID
}

export function loadStonegyBotScripts(): StonegyBotScript[] {
  const assets = cachedAssets ??= {
    bot: readAsset('stoner-bot.altgrid.js'),
    catalog: readAsset('stoner-hunt-catalog.js'),
    enhancements: readAsset('stoner-enhancements.js'),
    logo: `data:image/png;base64,${readFileSync(join(assetDirectory, '..', 'icon.png')).toString('base64')}`,
  }
  const brandedBot = prepareEmbeddedBot(assets.bot)

  return [
    {
      code: `
        (() => {
          globalThis.__ALTGRID_BOT_LOGO__ = ${JSON.stringify(assets.logo)};
          const bridge = globalThis.altgridStoner;
          if (!bridge || typeof bridge.sendDiscordWebhook !== 'function') {
            throw new Error('A ponte segura do AltGrid Bot não está disponível.');
          }
          const runtime = {
            sendMessage(message) {
              if (!message || message.type !== 'stoner:discord-webhook') {
                return Promise.resolve({});
              }
              return bridge.sendDiscordWebhook(message.webhook, message.payload);
            },
          };
          const chromeApi = globalThis.chrome && typeof globalThis.chrome === 'object'
            ? globalThis.chrome
            : {};
          chromeApi.runtime = runtime;
          globalThis.chrome = chromeApi;
        })();
      `,
      url: 'altgrid://stoner/bridge.js',
    },
    {
      code: assets.catalog,
      url: 'altgrid://stoner/stoner-hunt-catalog.js',
    },
    {
      code: brandedBot,
      url: 'altgrid://stoner/stoner-bot.js',
    },
    {
      code: assets.enhancements,
      url: 'altgrid://stoner/stoner-enhancements.js',
    },
    {
      code: `globalThis.__ALTGRID_STONER__ = Object.freeze({ version: ${JSON.stringify(STONEGY_BOT_VERSION)} });`,
      url: 'altgrid://stoner/ready.js',
    },
  ]
}

function prepareEmbeddedBot(source: string): string {
  const branded = source.replace(
    /^globalThis\.__STONER_LOGO__="data:image\/png;base64,[^"]+";/,
    'globalThis.__STONER_LOGO__=globalThis.__ALTGRID_BOT_LOGO__;',
  )
  if (branded === source) {
    throw new Error('Não foi possível aplicar a identidade visual do AltGrid Bot.')
  }

  // Match the complete startup branch. The shorter city/sell fragment also exists
  // in the LEAVING phase and changing that route makes Quick Sell oscillate.
  const startupSellRoute =
    'if(_0x473bb8())_0x2ff2da(\'HUNTING\');else{if(_0x3b6bc0())_0x2ff2da(_0x475959());else _0x2ff2da(_0x4f6a67()?"PARTY_WAIT":\'HUNTING\');'
  const directHuntRoute =
    'if(_0x473bb8())_0x2ff2da(\'HUNTING\');else{if(_0x3b6bc0())_0x2ff2da(_0x4f6a67()?"PARTY_WAIT":"EXPLORE");else _0x2ff2da(_0x4f6a67()?"PARTY_WAIT":\'HUNTING\');'
  const routed = branded.replace(startupSellRoute, directHuntRoute)
  if (routed === branded) {
    throw new Error('Não foi possível preparar o início direto da hunt no AltGrid Bot.')
  }

  const phaseBridge = '  getPhase: () => String(_0x13ac72.phase || ""),\n  setExternalBusy:'
  const runtimeBridge = `  getPhase: () => String(_0x13ac72.phase || ""),
  setPhase: (phase) => {
    _0x2ff2da(String(phase || "HUNTING"));
    return String(_0x13ac72.phase || "");
  },
  start: () => {
    if (!_0x13ac72.running) _0x11614a();
    return Boolean(_0x13ac72.running);
  },
  stop: () => {
    if (_0x13ac72.running) _0x4ac782();
    return Boolean(_0x13ac72.running);
  },
  setExternalBusy:`
  const prepared = routed.replace(phaseBridge, runtimeBridge)
  if (prepared === routed) {
    throw new Error('Não foi possível preparar o controle de navegação do AltGrid Bot.')
  }
  return prepared
}

export function stonegyBotProbeScript(): StonegyBotScript[] {
  return [{
    code: `Boolean(
      document.querySelector('#stonegy-auto-hunt')
      || document.querySelector('#stonegy-auto-hunt-fab')
    )`,
    url: 'altgrid://stoner/probe.js',
  }]
}

export function resetStonegyBotAssetCacheForTests(): void {
  cachedAssets = null
}

function readAsset(fileName: string): string {
  const contents = readFileSync(join(assetDirectory, fileName), 'utf8')
  if (!contents.trim()) {
    throw new Error(`O arquivo ${fileName} do AltGrid Bot está vazio.`)
  }
  // Git may materialize tracked JavaScript assets with CRLF on Windows runners.
  // Normalize before applying the audited, exact startup patches so local and
  // CI packages receive identical bot code.
  return contents.replace(/\r\n?/g, '\n')
}
