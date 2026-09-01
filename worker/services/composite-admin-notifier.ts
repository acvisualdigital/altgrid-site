import type {
  AdminMobileNotificationInput,
  AdminMobileNotifier,
} from '../types'

export class CompositeAdminNotifier implements AdminMobileNotifier {
  readonly enabled: boolean

  constructor(private readonly notifiers: readonly AdminMobileNotifier[]) {
    this.enabled = notifiers.some((notifier) => notifier.enabled !== false)
  }

  async notify(input: AdminMobileNotificationInput): Promise<void> {
    const active = this.notifiers.filter((notifier) => notifier.enabled !== false)
    if (active.length === 0) return
    const results = await Promise.allSettled(active.map((notifier) => notifier.notify(input)))
    if (results.every((result) => result.status === 'rejected')) {
      throw new Error('Every configured admin notification channel failed')
    }
  }
}
