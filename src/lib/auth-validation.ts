const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
