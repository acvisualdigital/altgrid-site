const MAX_URL_LENGTH = 2_048

function parsedUrl(input: unknown): URL | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_URL_LENGTH) {
    return null
  }

  try {
    return new URL(input)
  } catch {
    return null
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
}

export function isAllowedSessionUrl(
  candidate: unknown,
  allowInsecureLoopback: boolean,
): boolean {
  const url = parsedUrl(candidate)

  if (!url || url.username || url.password) {
    return false
  }

  return url.protocol === 'https:'
    || (
      allowInsecureLoopback
      && url.protocol === 'http:'
      && isLoopbackHostname(url.hostname)
    )
}

export function isSafeExternalUrl(candidate: unknown): candidate is string {
  const url = parsedUrl(candidate)
  return Boolean(
    url
    && url.protocol === 'https:'
    && !url.username
    && !url.password,
  )
}

export function parseTrustedRecoveryDeepLink(candidate: unknown): string | null {
  const url = parsedUrl(candidate)

  const isRecovery = url?.searchParams.get('auth') === 'recovery'
  const isOAuth = url?.searchParams.get('auth') === 'oauth'

  if (
    !url
    || url.username
    || url.password
    || url.protocol !== 'altgrid:'
    || url.host !== 'app'
    || (url.pathname !== '' && url.pathname !== '/')
    || (!isRecovery && !isOAuth)
  ) {
    return null
  }

  if (isOAuth) {
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
    const hasImplicitSession = Boolean(
      fragment.get('access_token') && fragment.get('refresh_token'),
    )
    const hasPkceCode = Boolean(url.searchParams.get('code'))
    const allowedQueryKeys = hasPkceCode
      ? ['auth', 'code']
      : ['auth']
    const hasUnexpectedQuery = [...url.searchParams.keys()]
      .some((key) => !allowedQueryKeys.includes(key))

    if ((!hasImplicitSession && !hasPkceCode) || hasUnexpectedQuery) {
      return null
    }
  }

  return url.toString()
}

export function findTrustedRecoveryDeepLink(
  commandLine: readonly string[],
): string | null {
  for (const argument of commandLine) {
    const deepLink = parseTrustedRecoveryDeepLink(argument)

    if (deepLink) {
      return deepLink
    }
  }

  return null
}

export function recoveryDeepLinkToShellUrl(
  deepLink: string,
  shellEntryUrl: string,
): string | null {
  const trustedDeepLink = parseTrustedRecoveryDeepLink(deepLink)
  const shellUrl = parsedUrl(shellEntryUrl)

  if (!trustedDeepLink || !shellUrl) {
    return null
  }

  const recoveryUrl = new URL(trustedDeepLink)
  shellUrl.search = recoveryUrl.search
  shellUrl.hash = recoveryUrl.hash
  return shellUrl.toString()
}

export function isTrustedShellUrl(
  candidate: unknown,
  shellEntryUrl: string,
): boolean {
  const expected = parsedUrl(shellEntryUrl)
  const actual = parsedUrl(candidate)

  if (!expected || !actual || actual.username || actual.password) {
    return false
  }

  if (expected.protocol === 'file:') {
    return actual.protocol === 'file:'
      && actual.host === expected.host
      && actual.pathname === expected.pathname
  }

  if (expected.protocol === 'altgrid:') {
    return actual.protocol === expected.protocol
      && actual.host === expected.host
  }

  return actual.origin === expected.origin
}
