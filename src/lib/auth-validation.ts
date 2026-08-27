const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const REFERRAL_CODE_PATTERN = /^HUNT-[A-HJ-NP-Z2-9]{8}$/

export function validateEmail(email: string): string | null {
  return EMAIL_PATTERN.test(email.trim())
    ? null
    : 'Digite um e-mail válido.'
}

export function validatePassword(password: string): string | null {
  return password.length >= 6
    ? null
    : 'A senha deve ter pelo menos 6 caracteres.'
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): string | null {
  return password === confirmation ? null : 'As senhas não são iguais.'
}

export function normalizeReferralCode(referralCode: string): string {
  return referralCode.trim().toUpperCase()
}

export function validateReferralCode(referralCode: string): string | null {
  const normalizedCode = normalizeReferralCode(referralCode)

  return normalizedCode === '' || REFERRAL_CODE_PATTERN.test(normalizedCode)
    ? null
    : 'Use um código no formato HUNT-XXXXXXXX.'
}
