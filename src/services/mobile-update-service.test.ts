import { describe, expect, it, vi } from 'vitest'

import {
  MobileUpdateService,
  selectMobileRelease,
} from './mobile-update-service'

function release(
  version: string,
  options: { prerelease?: boolean; url?: string } = {},
) {
  return {
    assets: [{
      browser_download_url: options.url
        ?? `https://github.com/acvisualdigital/altgrid-releases/releases/download/v${version}/AltGrid-Android-${version}.apk`,
      digest: `sha256:${'a'.repeat(64)}`,
      name: `AltGrid-Android-${version}.apk`,
      size: 42_000_000,
    }],
    body: `AltGrid ${version}`,
    draft: false,
    prerelease: options.prerelease ?? false,
    tag_name: `v${version}`,
  }
}

describe('Android update releases', () => {
  it('selects the newest stable Android APK for a stable installation', () => {
    const selected = selectMobileRelease([
      release('1.2.0-beta.1', { prerelease: true }),
      release('1.1.0'),
      release('1.0.1'),
    ], '1.0.0')

    expect(selected).toMatchObject({
      expectedSha256: 'a'.repeat(64),
      expectedSize: 42_000_000,
      version: '1.1.0',
    })
  })

  it('rejects assets outside the official versioned GitHub release path', () => {
    expect(selectMobileRelease([
      release('1.1.0', { url: 'https://example.com/AltGrid-Android-1.1.0.apk' }),
    ], '1.0.0')).toBeNull()
  })

  it('ignores a newer Windows-only release and keeps Android on its own channel', () => {
    const windowsOnlyRelease = {
      assets: [{
        browser_download_url: 'https://github.com/acvisualdigital/altgrid-releases/releases/download/v1.1.1/AltGrid-Setup-1.1.1.exe',
        name: 'AltGrid-Setup-1.1.1.exe',
        size: 120_000_000,
      }],
      draft: false,
      prerelease: false,
      tag_name: 'v1.1.1',
    }

    expect(selectMobileRelease([
      windowsOnlyRelease,
      release('1.1.0'),
    ], '1.1.0')).toBeNull()
  })

  it('checks, downloads and starts the native installer through one update state', async () => {
    const downloadUpdate = vi.fn(async () => undefined)
    const installUpdate = vi.fn(async () => ({ started: true }))
    const remove = vi.fn(async () => undefined)
    const service = new MobileUpdateService({
      currentVersion: '1.0.0',
      fetcher: vi.fn(async () => new Response(JSON.stringify([release('1.1.0')]), {
        status: 200,
      })),
      plugin: {
        addListener: vi.fn(async () => ({ remove })),
        downloadUpdate,
        installUpdate,
      },
      scheduleChecks: false,
    })

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      status: 'available',
      version: '1.1.0',
    })
    await expect(service.downloadUpdate()).resolves.toMatchObject({
      status: 'downloaded',
      version: '1.1.0',
    })
    expect(downloadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      expectedSize: 42_000_000,
      version: '1.1.0',
    }))
    await expect(service.quitAndInstall()).resolves.toBe(true)

    service.dispose()
    await Promise.resolve()
    expect(remove).toHaveBeenCalledOnce()
  })
})
