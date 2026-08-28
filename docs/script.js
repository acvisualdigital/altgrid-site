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

const findAsset = (assets, pattern) => assets.find((asset) => pattern.test(asset.name))

const applyLatestRelease = async () => {
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(`Release API returned ${response.status}`)

    const release = await response.json()
    const assets = Array.isArray(release.assets) ? release.assets : []
    const windows = findAsset(assets, /^AltGrid-Setup-.*\.exe$/i)

    if (windows?.browser_download_url) {
      document.querySelectorAll('.download-windows').forEach((link) => {
        link.href = windows.browser_download_url
      })
    }
    document.querySelectorAll('.current-version-short').forEach((element) => {
      element.textContent = '1.0.0'
    })
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
