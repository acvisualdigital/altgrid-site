import type { PublicAnnouncement } from '../types/backend-api'

export interface AltgridNotification {
  id: string
  category: 'announcement' | 'system' | 'update'
  title: string
  summary: string
  occurredAt: string
  actionLabel: string | null
  read: boolean
  severity: PublicAnnouncement['type']
}

interface NotificationStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'altgrid.notifications.read.v1'

function readPersistedIds(storage: NotificationStorage | null): Set<string> {
  if (!storage) {
    return new Set()
  }

  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return new Set(
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [],
    )
  } catch {
    return new Set()
  }
}

export class NotificationCenterService {
  private readonly readIds: Set<string>
  private announcementNotifications: AltgridNotification[] = []
  private readonly systemNotifications = new Map<string, AltgridNotification>()
  private notifications: AltgridNotification[] = []

  constructor(
    private readonly storage: NotificationStorage | null =
      typeof localStorage === 'undefined' ? null : localStorage,
  ) {
    this.readIds = readPersistedIds(storage)
  }

  setAnnouncements(announcements: readonly PublicAnnouncement[]): void {
    this.announcementNotifications = [...announcements]
      .filter((announcement) => {
        if (!announcement.expires_at) {
          return true
        }

        const expiresAt = Date.parse(announcement.expires_at)
        return Number.isNaN(expiresAt) || expiresAt > Date.now()
      })
      .sort((left, right) =>
        Date.parse(right.published_at) - Date.parse(left.published_at))
      .map((announcement) => ({
        actionLabel: null,
        category: 'announcement',
        id: announcement.id,
        occurredAt: announcement.published_at,
        read: this.readIds.has(announcement.id),
        severity: announcement.type,
        summary: announcement.message,
        title: announcement.title,
      }))
    this.rebuild()
  }

  upsertSystemNotification(input: {
    id: string
    title: string
    summary: string
    occurredAt?: string
    category?: 'system' | 'update'
  }): void {
    const existing = this.systemNotifications.get(input.id)
    this.systemNotifications.set(input.id, {
      actionLabel: null,
      category: input.category ?? 'system',
      id: input.id,
      occurredAt: input.occurredAt ?? existing?.occurredAt ?? new Date().toISOString(),
      read: this.readIds.has(input.id),
      severity: 'info',
      summary: input.summary,
      title: input.title,
    })
    this.rebuild()
  }

  list(): AltgridNotification[] {
    return this.notifications.map((notification) => ({ ...notification }))
  }

  getUnreadCount(): number {
    return this.notifications.filter((notification) => !notification.read).length
  }

  markRead(notificationId: string): void {
    const notification = this.notifications.find(
      (candidate) => candidate.id === notificationId,
    )

    if (!notification || notification.read) {
      return
    }

    notification.read = true
    this.readIds.add(notificationId)
    this.persist()
  }

  markAllRead(): void {
    let changed = false

    this.notifications.forEach((notification) => {
      if (!notification.read) {
        changed = true
        notification.read = true
        this.readIds.add(notification.id)
      }
    })

    if (changed) {
      this.persist()
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.readIds]))
    } catch {
      // Read state is a convenience. Storage failures must never block the app.
    }
  }

  private rebuild(): void {
    this.notifications = [
      ...this.systemNotifications.values(),
      ...this.announcementNotifications,
    ].sort(
      (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    )
  }
}
