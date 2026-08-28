import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core'

import type { AppUpdater, AppUpdateState } from '../app'

const RELEASES_API =
  'https://api.github.com/repos/acvisualdigital/altgrid-releases/releases?per_page=20'
const STARTUP_CHECK_DELAY_MS = 5_000
const PERIODIC_CHECK_INTERVAL_MS = 30 * 60 * 1_000
const MAX_RELEASE_NOTES_LENGTH = 4_000

interface AndroidUpdatePlugin {
  addListener(
    eventName: 'downloadProgress',
    listener: (event: { percent?: number }) => void,
  ): Promise<PluginListenerHandle>
  downloadUpdate(options: {
    expectedSha256?: string
    expectedSize: number
    url: string
    version: string
  }): Promise<void>
  installUpdate(): Promise<{ started?: boolean }>
}

interface GithubReleaseAsset {
  browser_download_url?: unknown
  digest?: unknown
  name?: unknown
  size?: unknown
}

interface GithubRelease {
  assets?: unknown
  body?: unknown
  draft?: unknown
  prerelease?: unknown
  tag_name?: unknown
}

interface MobileRelease {
  downloadUrl: string
  expectedSha256?: string
  expectedSize: number
  releaseNotes?: string
  version: string
}

interface ParsedVersion {
  core: [number, number, number]
  prerelease: Array<number | string>
}

interface MobileUpdateServiceOptions {
  currentVersion: string
  fetcher?: typeof fetch
  plugin?: AndroidUpdatePlugin
  releaseApiUrl?: string
  scheduleChecks?: boolean
}

const AndroidUpdater = registerPlugin<AndroidUpdatePlugin>('AltGridMobileUpdater')

export class MobileUpdateService implements AppUpdater {
  private availableRelease: MobileRelease | null = null
  private checkPromise: Promise<AppUpdateState> | null = null
  private disposed = false
  private readonly fetcher: typeof fetch
  private readonly listeners = new Set<(state: AppUpdateState) => void>()
  private periodicTimer: ReturnType<typeof setInterval> | null = null
  private readonly plugin: AndroidUpdatePlugin
  private progressListener: Promise<PluginListenerHandle | null>
  private readonly releaseApiUrl: string
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private state: AppUpdateState = { status: 'idle', supported: true }

  constructor(private readonly options: MobileUpdateServiceOptions) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis)
    this.plugin = options.plugin ?? AndroidUpdater
    this.releaseApiUrl = options.releaseApiUrl ?? RELEASES_API
    this.progressListener = this.plugin.addListener('downloadProgress', ({ percent }) => {
      if (this.disposed || this.state.status !== 'downloading') {
        return
      }

      this.setState({
        percent: clampPercent(percent),
        status: 'downloading',
        supported: true,
        version: this.availableRelease?.version,
      })
    }).catch(() => null)

    if (options.scheduleChecks !== false) {
      this.start()
    }
  }

  start(): void {
    if (this.disposed || this.startupTimer || this.periodicTimer) {
      return
    }

    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      void this.checkForUpdates()
    }, STARTUP_CHECK_DELAY_MS)

    this.periodicTimer = setInterval(() => {
      void this.checkForUpdates()
    }, PERIODIC_CHECK_INTERVAL_MS)
  }

  dispose(): void {
    this.disposed = true
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer)
      this.periodicTimer = null
    }
    void this.progressListener.then((listener) => listener?.remove())
    this.listeners.clear()
  }

  async checkForUpdates(): Promise<AppUpdateState> {
    if (this.checkPromise) {
      return this.checkPromise
    }
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') {
      return this.getState()
    }

    this.checkPromise = this.performUpdateCheck().finally(() => {
      this.checkPromise = null
    })
    return this.checkPromise
  }

  async downloadUpdate(): Promise<AppUpdateState> {
    const release = this.availableRelease
    if (!release || this.state.status !== 'available') {
      return this.getState()
    }

    this.setState({
      percent: 0,
      status: 'downloading',
      supported: true,
      version: release.version,
    })

    try {
      await this.plugin.downloadUpdate({
        expectedSha256: release.expectedSha256,
        expectedSize: release.expectedSize,
        url: release.downloadUrl,
        version: release.version,
      })
      this.setState({
        releaseNotes: release.releaseNotes,
        status: 'downloaded',
        supported: true,
        version: release.version,
      })
    } catch (error) {
      this.setState({
        message: updateErrorMessage(
          error,
          'Não foi possível baixar ou validar a atualização.',
        ),
        status: 'error',
        supported: true,
        version: release.version,
      })
    }

    return this.getState()
  }

  async getState(): Promise<AppUpdateState> {
    return { ...this.state }
  }

  onStateChange(listener: (state: AppUpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async quitAndInstall(): Promise<boolean> {
    if (this.state.status !== 'downloaded') {
      return false
    }

    try {
      const result = await this.plugin.installUpdate()
      return result.started === true
    } catch {
      return false
    }
  }

  private async performUpdateCheck(): Promise<AppUpdateState> {
    this.setState({ status: 'checking', supported: true })

    try {
      const response = await this.fetcher(this.releaseApiUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
      if (!response.ok) {
        throw new Error(`GitHub respondeu ${response.status}.`)
      }

      const payload: unknown = await response.json()
      const release = selectMobileRelease(
        payload,
        this.options.currentVersion,
      )
      this.availableRelease = release

      if (!release) {
        this.setState({
          status: 'not_available',
          supported: true,
          version: this.options.currentVersion,
        })
      } else {
        this.setState({
          releaseNotes: release.releaseNotes,
          status: 'available',
          supported: true,
          version: release.version,
        })
      }
    } catch {
      this.setState({
        message: 'Não foi possível verificar atualizações do Android.',
        status: 'error',
        supported: true,
      })
    }

    return this.getState()
  }

  private setState(state: AppUpdateState): void {
    this.state = { ...state }
    for (const listener of this.listeners) {
      listener({ ...this.state })
    }
  }
}

export function createMobileUpdateService(
  currentVersion: string,
): MobileUpdateService | null {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return null
  }

  return new MobileUpdateService({ currentVersion })
}

export function selectMobileRelease(
  payload: unknown,
  currentVersion: string,
): MobileRelease | null {
  if (!Array.isArray(payload)) {
    throw new Error('A lista de versões é inválida.')
  }

  const parsedCurrent = parseVersion(currentVersion)
  if (!parsedCurrent) {
    throw new Error('A versão instalada é inválida.')
  }
  const allowPrerelease = parsedCurrent.prerelease.length > 0

  const candidates = payload.flatMap((raw): MobileRelease[] => {
    const release = raw as GithubRelease
    if (!release || release.draft === true || (!allowPrerelease && release.prerelease === true)) {
      return []
    }

    const version = normalizeVersion(release.tag_name)
    const parsed = version ? parseVersion(version) : null
    if (!version || !parsed || compareVersions(parsed, parsedCurrent) <= 0) {
      return []
    }

    const assets = Array.isArray(release.assets)
      ? release.assets as GithubReleaseAsset[]
      : []
    const expectedName = `AltGrid-Android-${version}.apk`
    const asset = assets.find((candidate) => candidate?.name === expectedName)
    const downloadUrl = typeof asset?.browser_download_url === 'string'
      ? asset.browser_download_url
      : ''
    const expectedSize = typeof asset?.size === 'number' ? asset.size : 0
    if (!isTrustedDownloadUrl(downloadUrl, version) || expectedSize <= 0) {
      return []
    }

    const digest = typeof asset?.digest === 'string' ? asset.digest : ''
    const expectedSha256 = /^sha256:[a-f\d]{64}$/i.test(digest)
      ? digest.slice('sha256:'.length).toLowerCase()
      : undefined
    const releaseNotes = typeof release.body === 'string'
      ? normalizeReleaseNotes(release.body)
      : undefined

    return [{
      downloadUrl,
      expectedSha256,
      expectedSize,
      releaseNotes,
      version,
    }]
  })

  return candidates.sort((left, right) => {
    return compareVersions(parseVersion(right.version)!, parseVersion(left.version)!)
  })[0] ?? null
}

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().replace(/^v/i, '')
  return parseVersion(normalized) ? normalized : null
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  )
  if (!match) {
    return null
  }

  const core = match.slice(1, 4).map(Number) as [number, number, number]
  if (core.some((entry) => !Number.isSafeInteger(entry))) {
    return null
  }

  const prerelease = match[4]
    ? match[4].split('.').map((entry) => /^\d+$/.test(entry) ? Number(entry) : entry)
    : []
  return { core, prerelease }
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (let index = 0; index < left.core.length; index += 1) {
    const difference = left.core[index] - right.core[index]
    if (difference !== 0) {
      return difference
    }
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0 ? 1 : -1
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1
    }
    if (leftPart === rightPart) {
      continue
    }
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return leftPart - rightPart
    }
    if (typeof leftPart === 'number') {
      return -1
    }
    if (typeof rightPart === 'number') {
      return 1
    }
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

function isTrustedDownloadUrl(url: string, version: string): boolean {
  try {
    const parsed = new URL(url)
    const expectedPath = `/acvisualdigital/altgrid-releases/releases/download/v${version}/AltGrid-Android-${version}.apk`
    return parsed.protocol === 'https:'
      && parsed.hostname === 'github.com'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.port === ''
      && parsed.pathname === expectedPath
      && parsed.search === ''
      && parsed.hash === ''
  } catch {
    return false
  }
}

function normalizeReleaseNotes(value: string): string | undefined {
  const normalized = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r/g, '')
    .trim()
    .slice(0, MAX_RELEASE_NOTES_LENGTH)
  return normalized || undefined
}

function clampPercent(value: number | undefined): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(100, value!))
    : 0
}

function updateErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback
  }

  const message = error.message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300)
  return message || fallback
}
