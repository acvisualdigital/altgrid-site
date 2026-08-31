const CONSENT_STORAGE_KEY = 'altgrid.google-consent.v1'

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
if (storedConsentChoice) updateGoogleConsent(storedConsentChoice)
else showConsentBanner()

const consentSettings = document.createElement('button')
consentSettings.className = 'consent-settings'
consentSettings.type = 'button'
consentSettings.textContent = 'Privacidade'
consentSettings.addEventListener('click', showConsentBanner)
document.body.append(consentSettings)
