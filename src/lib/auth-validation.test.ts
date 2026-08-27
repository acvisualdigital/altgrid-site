import { describe, expect, it } from 'vitest'

import {
  normalizeReferralCode,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  validateReferralCode,
} from './auth-validation'

describe('auth validation', () => {
  it('accepts a trimmed email and rejects malformed email', () => {
    expect(validateEmail('  hunter@example.com ')).toBeNull()
    expect(validateEmail('hunter-at-example')).toBe('Digite um e-mail válido.')
  })

  it('uses only a small six-character minimum for passwords', () => {
    expect(validatePassword('123456')).toBeNull()
    expect(validatePassword('12345')).toBe(
      'A senha deve ter pelo menos 6 caracteres.',
    )
  })

  it('requires equal password confirmation', () => {
    expect(validatePasswordConfirmation('secret', 'secret')).toBeNull()
    expect(validatePasswordConfirmation('secret', 'different')).toBe(
      'As senhas não são iguais.',
    )
  })

  it('normalizes optional referral codes and rejects invalid ones', () => {
    expect(normalizeReferralCode('  hunt-abcd2345 ')).toBe('HUNT-ABCD2345')
    expect(validateReferralCode('')).toBeNull()
    expect(validateReferralCode(' hunt-abcd2345 ')).toBeNull()
    expect(validateReferralCode('HUNT-INVALID!')).toBe(
      'Use um código no formato HUNT-XXXXXXXX.',
    )
  })
})
