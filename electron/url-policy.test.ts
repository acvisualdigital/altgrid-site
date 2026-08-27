import { describe, expect, it } from 'vitest'

import {
  findTrustedRecoveryDeepLink,
  isAllowedSessionUrl,
  isSafeExternalUrl,
  isTrustedShellUrl,
  parseTrustedRecoveryDeepLink,
  recoveryDeepLinkToShellUrl,
} from './url-policy.js'

describe('desktop URL policies', () => {
  it('allows HTTPS games and only loopback HTTP during development', () => {
    expect(isAllowedSessionUrl('https://game.example/play', false)).toBe(true)
    expect(isAllowedSessionUrl('http://game.example/play', true)).toBe(false)
    expect(isAllowedSessionUrl('http://127.0.0.1:8080/play', true)).toBe(true)
    expect(isAllowedSessionUrl('javascript:alert(1)', true)).toBe(false)
    expect(isAllowedSessionUrl('file:///C:/secret', true)).toBe(false)
    expect(isAllowedSessionUrl('https://user:secret@game.example/', false)).toBe(false)
  })

  it('limits external opening to credential-free HTTPS', () => {
    expect(isSafeExternalUrl('https://altgrid.example/plans')).toBe(true)
    expect(isSafeExternalUrl('http://altgrid.example/plans')).toBe(false)
    expect(isSafeExternalUrl('data:text/html,unsafe')).toBe(false)
    expect(isSafeExternalUrl('https://user:secret@altgrid.example/')).toBe(false)
  })

  it('accepts only the shell entry origin or the exact packaged file', () => {
    expect(isTrustedShellUrl(
      'http://127.0.0.1:3000/admin?tab=games',
      'http://127.0.0.1:3000/',
    )).toBe(true)
    expect(isTrustedShellUrl(
      'http://localhost:3000/',
      'http://127.0.0.1:3000/',
    )).toBe(false)
    expect(isTrustedShellUrl(
      'file:///C:/AltGrid/dist/index.html#/admin',
      'file:///C:/AltGrid/dist/index.html',
    )).toBe(true)
    expect(isTrustedShellUrl(
      'file:///C:/AltGrid/dist/other.html',
      'file:///C:/AltGrid/dist/index.html',
    )).toBe(false)
    expect(isTrustedShellUrl(
      'altgrid://app/admin?tab=games',
      'altgrid://app/',
    )).toBe(true)
    expect(isTrustedShellUrl(
      'altgrid://evil/',
      'altgrid://app/',
    )).toBe(false)
  })

  it('accepts only password-recovery deep links for the AltGrid shell', () => {
    const recovery = 'altgrid://app/?auth=recovery#access_token=opaque&type=recovery'

    expect(parseTrustedRecoveryDeepLink(recovery)).toBe(recovery)
    expect(parseTrustedRecoveryDeepLink('altgrid://app/admin')).toBeNull()
    expect(parseTrustedRecoveryDeepLink('altgrid://evil/?auth=recovery')).toBeNull()
    expect(parseTrustedRecoveryDeepLink('https://app/?auth=recovery')).toBeNull()
    expect(findTrustedRecoveryDeepLink(['AltGrid.exe', '--flag', recovery]))
      .toBe(recovery)
  })

  it('maps a trusted recovery deep link onto the active shell origin', () => {
    expect(recoveryDeepLinkToShellUrl(
      'altgrid://app/?auth=recovery&code=opaque',
      'http://127.0.0.1:3000/',
    )).toBe('http://127.0.0.1:3000/?auth=recovery&code=opaque')
    expect(recoveryDeepLinkToShellUrl(
      'altgrid://evil/?auth=recovery',
      'altgrid://app/',
    )).toBeNull()
  })
})
