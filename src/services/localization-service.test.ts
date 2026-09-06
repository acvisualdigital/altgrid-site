import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  APP_LOCALE_STORAGE_KEY,
  localeTag,
  normalizeAppLocale,
  readPreferredLocale,
  storePreferredLocale,
  translateUiText,
} from './localization-service'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('localization service', () => {
  it('normalizes supported regional languages', () => {
    expect(normalizeAppLocale('pt-PT')).toBe('pt-BR')
    expect(normalizeAppLocale('en-US')).toBe('en')
    expect(normalizeAppLocale('es-MX')).toBe('es')
    expect(normalizeAppLocale('fr-FR')).toBeNull()
  })

  it('translates fixed and dynamic interface messages', () => {
    expect(translateUiText('Configurações', 'en')).toBe('Settings')
    expect(translateUiText('Configurações', 'es')).toBe('Configuración')
    expect(translateUiText('Mensagem para Caco…', 'en')).toBe('Message to Caco…')
    expect(translateUiText('4/10 sessões abertas', 'es')).toBe('4/10 sesiones abiertas')
    expect(translateUiText('Ativos nos últimos 5 minutos', 'en')).toBe('Active in the last 5 minutes')
  })

  it('provides regional tags for formatting and accessibility', () => {
    expect(localeTag('pt-BR')).toBe('pt-BR')
    expect(localeTag('en')).toBe('en-US')
    expect(localeTag('es')).toBe('es-ES')
  })

  it('uses the operating-system language on first access and persists a user choice', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('navigator', { language: 'es-MX' })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    expect(readPreferredLocale()).toBe('es')
    storePreferredLocale('en', 'user-1')
    expect(values.get(APP_LOCALE_STORAGE_KEY)).toBe('en')
    expect(readPreferredLocale('user-1')).toBe('en')
  })
})
