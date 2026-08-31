import './styles.css'
import altgridLogoUrl from './assets/altgrid-mark.png'

import { AuthApp } from './app'
import { createSupabaseClient } from './lib/supabase'
import { AuthService } from './services/auth-service'
import { BackendApi } from './services/backend-api'
import { ChatService } from './services/chat-service'
import { ConfiguredAccountService } from './services/configured-account-service'
import { createElectronDesktopIntegration } from './services/electron-desktop-adapter'
import { DeviceRegistrationService } from './services/device-registration-service'
import { GamePresetService } from './services/game-preset-service'
import { createEmbeddedOfflineLicenseService } from './services/license-snapshot-service'
import { PermissionService } from './services/permission-service'
import { SupabaseChatRealtimeGateway } from './services/supabase-chat-realtime'
import { createMobileSessionLauncher } from './services/mobile-session-adapter'
import { createMobileUpdateService } from './services/mobile-update-service'

const root = document.querySelector<HTMLElement>('#app')

if (!root) {
  throw new Error('Application root was not found')
}

function renderStartupError(): void {
  root!.innerHTML = `
    <div class="app-frame">
      <header class="topbar">
        <div class="brand" aria-label="AltGrid">
          <img class="brand__logo" src="${altgridLogoUrl}" alt="" />
          <span class="brand__name">AltGrid</span>
        </div>
      </header>
      <main class="auth-stage">
        <section class="auth-card auth-card--message" aria-labelledby="config-title">
          <span class="message-icon message-icon--warning" aria-hidden="true">!</span>
          <p class="eyebrow">Configuração necessária</p>
          <h1 id="config-title">Conecte o Supabase</h1>
          <p class="auth-card__subtitle">
            Configure as credenciais públicas do Supabase e a URL da API.
          </p>
        </section>
      </main>
    </div>
  `
}

try {
  const supabase = createSupabaseClient({
    SUPABASE_ANON_KEY: __SUPABASE_ANON_KEY__,
    SUPABASE_URL: __SUPABASE_URL__,
  })
  const authService = new AuthService(supabase)
  const backendApi = __API_BASE_URL__.trim()
    ? new BackendApi({
        authService,
        baseUrl: __API_BASE_URL__,
      })
    : null
  const desktop = createElectronDesktopIntegration()
  const mobile = desktop ? null : createMobileSessionLauncher()
  const mobileUpdater = desktop ? null : createMobileUpdateService(__APP_VERSION__)
  const chatService = backendApi
    ? new ChatService(
        backendApi,
        new SupabaseChatRealtimeGateway(supabase),
      )
    : null
  const gamePresetService = new GamePresetService({
    loader: backendApi
      ? () => backendApi.getGames()
      : () => Promise.reject(new Error('Serviços AltGrid indisponíveis.')),
  })
  const offlineLicenseService = backendApi && __LICENSE_PUBLIC_KEY__.trim()
    ? createEmbeddedOfflineLicenseService(backendApi)
    : null
  const deviceRegistrationService = backendApi && (desktop || mobile)
    ? new DeviceRegistrationService(backendApi)
    : null
  const resolvePlatform = desktop
    ? () => desktop.getPlatform()
    : mobile
      ? () => Promise.resolve(mobile.getPlatform())
      : null
  const unsubscribeFromDeviceRegistration = deviceRegistrationService && resolvePlatform
    ? authService.onAuthStateChange((_event, session) => {
        if (!session) {
          return
        }

        void resolvePlatform()
          .then((platform) => deviceRegistrationService.register({
            appVersion: __APP_VERSION__,
            platform,
          }))
          .catch(() => undefined)
      })
    : null
  const adminRoute = /^\/admin(?:\/|$)/.test(window.location.pathname)
  if (adminRoute && !backendApi) {
    throw new Error('ALTGRID_API_BASE_URL is required for admin')
  }
  const appPromise = adminRoute
    ? import('./admin-app').then(({ AdminApp }) => (
        new AdminApp(root, authService, backendApi!)
      ))
    : Promise.resolve(new AuthApp(root, authService, {
        accountService: new ConfiguredAccountService(),
        backendApi: backendApi ?? undefined,
        chatService: chatService ?? undefined,
        gamePresetService,
        offlineLicenseService: offlineLicenseService ?? undefined,
        openExternalUrl: desktop?.openExternalUrl,
        permissionService: new PermissionService(),
        sessionLauncher: desktop?.sessionLauncher ?? mobile ?? undefined,
        updater: desktop?.updater ?? mobileUpdater ?? undefined,
      }))

  void appPromise.then((app) => {
    void app.start()
    window.addEventListener('beforeunload', () => {
      unsubscribeFromDeviceRegistration?.()
      app.destroy()
      desktop?.dispose()
      mobileUpdater?.dispose()
    }, { once: true })
  }).catch(() => {
    unsubscribeFromDeviceRegistration?.()
    desktop?.dispose()
    mobileUpdater?.dispose()
    renderStartupError()
  })
} catch {
  renderStartupError()
}
