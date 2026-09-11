const CONSENT_STORAGE_KEY = 'altgrid.google-consent.v1'
let googleLoaded = false

const loadGoogleServices = () => {
  if (googleLoaded) return
  googleLoaded = true
  window.dataLayer = window.dataLayer || []
  window.gtag = function () { window.dataLayer.push(arguments) }
  window.gtag('consent', 'default', {
    ad_storage: 'denied', analytics_storage: 'denied',
    ad_user_data: 'denied', ad_personalization: 'denied',
  })
  updateGoogleConsent('granted')
  window.gtag('js', new Date())
  window.gtag('config', 'AW-18415695413')
  // Google serves changing scripts: a fixed SRI hash would break updates.
  // The site's CSP restricts these endpoints; neither loads before consent.
  for (const src of [
    'https://www.googletagmanager.com/gtag/js?id=AW-18415695413',
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2576736310394290',
  ]) {
    const script = document.createElement('script')
    script.async = true
    script.src = src
    script.crossOrigin = 'anonymous'
    document.head.append(script)
  }
}

const updateGoogleConsent = (choice) => {
  if (typeof window.gtag !== 'function') return
  const state = choice === 'granted' ? 'granted' : 'denied'
  window.gtag('consent', 'update', {
    ad_storage: state,
    analytics_storage: state,
    ad_user_data: state,
    ad_personalization: state,
  })
}

const readConsentChoice = () => {
  try {
    const choice = localStorage.getItem(CONSENT_STORAGE_KEY)
    return choice === 'granted' || choice === 'denied' ? choice : null
  } catch {
    return null
  }
}

const saveConsentChoice = (choice) => {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, choice)
  } catch {
    // Mantém a decisão na página quando o armazenamento está bloqueado.
  }
  updateGoogleConsent(choice)
  if (choice === 'granted') loadGoogleServices()
  else if (googleLoaded) window.location.reload()
}

const showConsentBanner = () => {
  document.querySelector('.consent-banner')?.remove()

  const banner = document.createElement('aside')
  banner.className = 'consent-banner'
  banner.setAttribute('aria-label', 'Preferências de privacidade')
  banner.innerHTML = `
    <div class="consent-banner__copy">
      <strong>Você controla seus dados</strong>
      <p>Usamos serviços do Google para medir resultados e exibir publicidade. Você pode aceitar ou continuar somente com o funcionamento essencial.</p>
      <a href="privacy.html">Entenda como funciona</a>
    </div>
    <div class="consent-banner__actions">
      <button class="button button-secondary" type="button" data-consent="denied">Somente essenciais</button>
      <button class="button button-primary" type="button" data-consent="granted">Aceitar</button>
    </div>
  `
  document.body.append(banner)

  banner.querySelectorAll('[data-consent]').forEach((button) => {
    button.addEventListener('click', () => {
      saveConsentChoice(button.dataset.consent)
      banner.remove()
    })
  })
}

const storedConsentChoice = readConsentChoice()
if (storedConsentChoice === 'granted') loadGoogleServices()
else if (storedConsentChoice) updateGoogleConsent(storedConsentChoice)
else showConsentBanner()

const consentSettings = document.createElement('button')
consentSettings.className = 'consent-settings'
consentSettings.type = 'button'
consentSettings.textContent = 'Privacidade'
consentSettings.addEventListener('click', showConsentBanner)
document.body.append(consentSettings)
