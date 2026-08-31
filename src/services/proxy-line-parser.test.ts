import { describe, expect, it } from 'vitest'

import { parseProxyLine } from './proxy-line-parser'

describe('parseProxyLine', () => {
  it('parses usuario:senha:host:porta using the selected protocol', () => {
    expect(parseProxyLine(' acrux : segredo : proxy.example.com : 1080 ', 'socks5'))
      .toEqual({
        host: 'proxy.example.com',
        password: 'segredo',
        port: 1080,
        protocol: 'socks5',
        username: 'acrux',
      })
  })

  it('also accepts an explicit proxy URL', () => {
    expect(parseProxyLine('https://user:p%40ss@proxy.example.com:8443'))
      .toEqual({
        host: 'proxy.example.com',
        password: 'p@ss',
        port: 8443,
        protocol: 'https',
        username: 'user',
      })
  })

  it.each([
    '',
    'user:pass:host',
    'user::host:8080',
    'user:pass:host:99999',
  ])('rejects malformed input %j', (value) => {
    expect(() => parseProxyLine(value)).toThrow()
  })
})
