const menuToggle = document.querySelector('.menu-toggle')
const siteNav = document.querySelector('#site-nav')
const header = document.querySelector('[data-header]')
const year = document.querySelector('#year')

const closeMenu = () => {
  siteNav?.classList.remove('is-open')
  menuToggle?.setAttribute('aria-expanded', 'false')
}

menuToggle?.addEventListener('click', () => {
  const isOpen = siteNav?.classList.toggle('is-open') ?? false
  menuToggle.setAttribute('aria-expanded', String(isOpen))
})

document.querySelectorAll('.site-nav a').forEach((link) => link.addEventListener('click', closeMenu))

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenu()
})

const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 12)
window.addEventListener('scroll', updateHeader, { passive: true })
updateHeader()

if (year) year.textContent = String(new Date().getFullYear())

document.querySelectorAll('.download-windows, .download-android').forEach((link) => {
  link.addEventListener('click', () => {
    if (typeof window.gtag !== 'function') return
    const platform = link.classList.contains('download-windows') ? 'windows' : 'android'
    window.gtag('event', 'conversion', {
      send_to: 'AW-18415695413/HbUGCI6y8ekcELXspM1E',
      value: 1.0,
      currency: 'BRL',
      platform,
      link_url: link.href,
      transport_type: 'beacon',
    })
  })
})

document.querySelectorAll('.faq-item button').forEach((button) => {
  button.addEventListener('click', () => {
    const item = button.closest('.faq-item')
    const willOpen = !item?.classList.contains('is-open')

    document.querySelectorAll('.faq-item.is-open').forEach((openItem) => {
      openItem.classList.remove('is-open')
      openItem.querySelector('button')?.setAttribute('aria-expanded', 'false')
    })

    if (willOpen) {
      item?.classList.add('is-open')
      button.setAttribute('aria-expanded', 'true')
    }
  })
})

const revealElements = document.querySelectorAll('.reveal')
if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  )
  revealElements.forEach((element) => revealObserver.observe(element))
} else {
  revealElements.forEach((element) => element.classList.add('is-visible'))
}

const RELEASE_API = 'https://api.github.com/repos/acvisualdigital/altgrid-releases/releases/latest'
const METRICS_API = 'https://altgrid-api.altgrid.workers.dev/v1/app/metrics'
const METRICS_REFRESH_INTERVAL_MS = 60_000
const PAGE_RELEASE_VERSION = '1.5.0'

const findAsset = (assets, pattern) => assets.find((asset) => pattern.test(asset.name))
const versionParts = (version) => version.split('.').map((part) => Number.parseInt(part, 10) || 0)
const isSameOrNewerVersion = (candidate, baseline) => {
  const candidateParts = versionParts(candidate)
  const baselineParts = versionParts(baseline)
  const length = Math.max(candidateParts.length, baselineParts.length)
  for (let index = 0; index < length; index += 1) {
    const candidatePart = candidateParts[index] ?? 0
    const baselinePart = baselineParts[index] ?? 0
    if (candidatePart > baselinePart) return true
    if (candidatePart < baselinePart) return false
  }
  return true
}

const applyLatestRelease = async () => {
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(`Release API returned ${response.status}`)

    const release = await response.json()
    const assets = Array.isArray(release.assets) ? release.assets : []
    const windows = findAsset(assets, /^(?:AltGrid-Setup-.*|AltGrid-win-x64-Setup)\.exe$/i)
    const releaseVersion = String(release.tag_name ?? '').replace(/^v/i, '')
    const canApplyRelease = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(releaseVersion)
      && isSameOrNewerVersion(releaseVersion.split(/[-+]/, 1)[0], PAGE_RELEASE_VERSION)

    if (windows?.browser_download_url && canApplyRelease) {
      document.querySelectorAll('.download-windows').forEach((link) => {
        link.href = windows.browser_download_url
      })
    }
    if (canApplyRelease) {
      document.querySelectorAll('.download-windows .current-version, .download-card-main .current-version').forEach((element) => {
        element.textContent = `Versão ${releaseVersion}`
      })
      document.querySelectorAll('.current-version-short').forEach((element) => {
        element.textContent = releaseVersion
      })
    }
  } catch (error) {
    console.info('AltGrid: usando links de download estáveis.', error)
  }
}

applyLatestRelease()

const applyPublicMetrics = async () => {
  try {
    const response = await fetch(METRICS_API, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Metrics API returned ${response.status}`)

    const metrics = await response.json()
    const numberFormat = new Intl.NumberFormat('pt-BR')
    const activeUsers = Number(metrics?.users?.active)
    const totalUsers = Number(metrics?.users?.total)

    if (Number.isFinite(activeUsers)) {
      document.querySelector('#active-users').textContent = numberFormat.format(activeUsers)
    }
    if (Number.isFinite(totalUsers)) {
      document.querySelector('#total-users').textContent = numberFormat.format(totalUsers)
    }
  } catch (error) {
    console.info('AltGrid: métricas públicas temporariamente indisponíveis.', error)
  }
}

applyPublicMetrics()
window.setInterval(applyPublicMetrics, METRICS_REFRESH_INTERVAL_MS)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') applyPublicMetrics()
})

const referralCode = (new URLSearchParams(window.location.search).get('ref') ?? '')
  .trim()
  .toUpperCase()

if (/^HUNT-[A-HJ-NP-Z2-9]{8}$/.test(referralCode)) {
  try {
    localStorage.setItem('altgrid.referral-code.v1', referralCode)
  } catch {
    // The invitation remains visible even when browser storage is blocked.
  }

  const invitation = document.createElement('aside')
  invitation.className = 'referral-invitation'
  invitation.setAttribute('aria-label', 'Convite AltGrid')
  invitation.innerHTML = `
    <button class="referral-invitation__close" type="button" aria-label="Fechar convite">×</button>
    <span class="referral-invitation__icon" aria-hidden="true">✦</span>
    <div><small>VOCÊ RECEBEU UM CONVITE</small><strong>${referralCode}</strong><p>Abra o AltGrid e crie sua conta com este código já identificado.</p></div>
    <div class="referral-invitation__actions"><a class="button button-primary" href="altgrid://app/?ref=${encodeURIComponent(referralCode)}">Abrir AltGrid</a><button class="button button-secondary" type="button" data-copy-site-referral>Copiar código</button></div>
  `
  document.body.append(invitation)

  invitation.querySelector('.referral-invitation__close')?.addEventListener('click', () => {
    invitation.remove()
  })
  invitation.querySelector('[data-copy-site-referral]')?.addEventListener('click', (event) => {
    const button = event.currentTarget
    navigator.clipboard.writeText(referralCode)
      .then(() => { button.textContent = 'Código copiado' })
      .catch(() => undefined)
  })
}
