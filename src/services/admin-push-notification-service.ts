import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import {
  PushNotifications,
  type ActionPerformed,
  type PushNotificationSchema,
  type Token,
} from '@capacitor/push-notifications'

import type { BackendApi } from './backend-api'

export const ADMIN_PUSH_EVENT = 'altgrid:admin-push'

export interface AdminPushEventDetail {
  body: string
  data: Record<string, unknown>
  title: string
}

function detailFromNotification(
  notification: PushNotificationSchema,
): AdminPushEventDetail {
  return {
    body: notification.body?.trim() || 'Há uma nova atividade administrativa.',
    data: notification.data && typeof notification.data === 'object'
      ? notification.data as Record<string, unknown>
      : {},
    title: notification.title?.trim() || 'AltGrid — aviso administrativo',
  }
}

export class AdminPushNotificationService {
  private initialized = false
  private registeredToken: string | null = null
  private readonly listeners: PluginListenerHandle[] = []

  constructor(private readonly backendApi: BackendApi) {}

  async enableForCurrentAdmin(): Promise<boolean> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return false
    }

    try {
      await this.backendApi.getAdminSession()
    } catch {
      return false
    }

    await this.initializeListeners()
    await PushNotifications.createChannel({
      id: 'altgrid_admin_alerts',
      name: 'Compras e pedidos AltGrid',
      description: 'Avisos administrativos de compras, pagamentos, anúncios e suporte.',
      importance: 5,
      visibility: 1,
      vibration: true,
    })

    let permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions()
    }
    if (permission.receive !== 'granted') return false

    await PushNotifications.register()
    return true
  }

  async disable(): Promise<void> {
    const token = this.registeredToken
    this.registeredToken = null
    if (token) {
      await this.backendApi.unregisterAdminPushDevice({
        platform: 'android',
        token,
      }).catch(() => undefined)
    }
  }

  async dispose(): Promise<void> {
    await Promise.all(this.listeners.splice(0).map((listener) => listener.remove()))
    this.initialized = false
  }

  private async initializeListeners(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    this.listeners.push(await PushNotifications.addListener(
      'registration',
      (token: Token) => {
        const normalized = token.value.trim()
        if (!normalized) return
        this.registeredToken = normalized
        void this.backendApi.registerAdminPushDevice({
          platform: 'android',
          token: normalized,
        }).catch(() => undefined)
      },
    ))
    this.listeners.push(await PushNotifications.addListener(
      'pushNotificationReceived',
      (notification: PushNotificationSchema) => this.dispatch(notification),
    ))
    this.listeners.push(await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action: ActionPerformed) => this.dispatch(action.notification),
    ))
  }

  private dispatch(notification: PushNotificationSchema): void {
    window.dispatchEvent(new CustomEvent<AdminPushEventDetail>(ADMIN_PUSH_EVENT, {
      detail: detailFromNotification(notification),
    }))
  }
}
