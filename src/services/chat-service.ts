import type {
  ChatChannel,
  ChatMessage,
  ChatStatusResponse,
} from '../types/backend-api'
import type { BackendApi } from './backend-api'

export const CHAT_MESSAGE_MAX_LENGTH = 500
const SEND_COOLDOWN_MS = 1_000
const BLOCKED_USERS_KEY = 'altgrid.chat.blocked-users.v1'

type ChatApi = Pick<
  BackendApi,
  | 'getChatChannels'
  | 'getChatMessages'
  | 'getChatStatus'
  | 'reportChatMessage'
  | 'sendChatMessage'
  | 'startDirectChat'
>

interface ChatStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ChatRealtimeGateway {
  subscribe(
    channelId: string,
    onChange: () => void,
    type?: ChatChannel['type'],
  ): () => void
}

export interface ChatState {
  channels: ChatChannel[]
  selectedChannelId: string | null
  messages: ChatMessage[]
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  sending: boolean
  open: boolean
  error: string | null
  mutedUntil: string | null
  banned: boolean
  moderationReason: string | null
  unread: Record<string, number>
}

function parseBlockedUsers(storage: ChatStorage | null): Set<string> {
  if (!storage) {
    return new Set()
  }

  try {
    const parsed = JSON.parse(storage.getItem(BLOCKED_USERS_KEY) ?? '[]') as unknown
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [],
    )
  } catch {
    return new Set()
  }
}

function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  ;[...current, ...incoming].forEach((message) => byId.set(message.id, message))
  return [...byId.values()].sort(
    (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at),
  )
}

export class ChatService {
  private state: ChatState = {
    banned: false,
    channels: [],
    error: null,
    hasMore: false,
    loading: false,
    loadingMore: false,
    messages: [],
    moderationReason: null,
    mutedUntil: null,
    open: false,
    selectedChannelId: null,
    sending: false,
    unread: {},
  }
  private readonly listeners = new Set<(state: ChatState) => void>()
  private readonly blockedUserIds: Set<string>
  private unsubscribeRealtime: (() => void) | null = null
  private revision = 0
  private lastSentAt = 0
  private refreshInFlight: Promise<void> | null = null
  private channelRefreshInFlight: Promise<void> | null = null

  constructor(
    private readonly api: ChatApi,
    private readonly realtime: ChatRealtimeGateway | null = null,
    private readonly storage: ChatStorage | null =
      typeof localStorage === 'undefined' ? null : localStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.blockedUserIds = parseBlockedUsers(storage)
  }

  subscribe(listener: (state: ChatState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  getState(): ChatState {
    return {
      ...this.state,
      channels: [...this.state.channels],
      messages: this.visibleMessages(),
      unread: { ...this.state.unread },
    }
  }

  async start(preferredGameId: string | null = null): Promise<void> {
    const revision = ++this.revision
    this.patch({ error: null, loading: true })
    const [channelsResult, statusResult] = await Promise.allSettled([
      this.api.getChatChannels(),
      this.api.getChatStatus(),
    ])

    if (revision !== this.revision) {
      return
    }

    if (statusResult.status === 'fulfilled') {
      this.applyStatus(statusResult.value)
    }

    if (channelsResult.status === 'rejected') {
      this.patch({
        channels: [],
        error: 'O chat está indisponível no momento.',
        loading: false,
      })
      return
    }

    const channels = channelsResult.value.channels
    const selected = channels.find((channel) => channel.type === 'global')
      ?? channels[0]
      ?? null
    this.patch({
      channels,
      loading: false,
      unread: Object.fromEntries(channels.map((channel) => [
        channel.id,
        Math.max(0, channel.unread ?? this.state.unread[channel.id] ?? 0),
      ])),
    })

    if (this.state.open && selected) {
      await this.selectChannel(selected.id)
    }
  }

  async open(preferredGameId: string | null = null): Promise<void> {
    this.patch({ open: true })
    await this.start(preferredGameId)
  }

  close(): void {
    this.patch({ loading: false, loadingMore: false, open: false, sending: false })
  }

  refreshUnread(): Promise<void> {
    if (this.channelRefreshInFlight) {
      return this.channelRefreshInFlight
    }

    const revision = this.revision
    const operation = this.api.getChatChannels()
      .then((response) => {
        if (revision !== this.revision) {
          return
        }

        const selectedChannelId = this.state.selectedChannelId
        this.patch({
          channels: response.channels,
          unread: Object.fromEntries(response.channels.map((channel) => [
            channel.id,
            this.state.open && channel.id === selectedChannelId
              ? 0
              : Math.max(0, channel.unread ?? this.state.unread[channel.id] ?? 0),
          ])),
        })
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.channelRefreshInFlight === operation) {
          this.channelRefreshInFlight = null
        }
      })

    this.channelRefreshInFlight = operation
    return operation
  }

  reset(): void {
    this.revision += 1
    this.stopRealtime()
    this.state = {
      banned: false,
      channels: [],
      error: null,
      hasMore: false,
      loading: false,
      loadingMore: false,
      messages: [],
      moderationReason: null,
      mutedUntil: null,
      open: false,
      selectedChannelId: null,
      sending: false,
      unread: {},
    }
    this.emit()
  }

  async selectChannel(channelId: string): Promise<void> {
    const selectedChannel = this.state.channels.find((channel) => channel.id === channelId)
    if (!selectedChannel) {
      return
    }

    const revision = ++this.revision
    this.stopRealtime()
    this.patch({
      error: null,
      hasMore: false,
      loading: true,
      messages: [],
      selectedChannelId: channelId,
      unread: { ...this.state.unread, [channelId]: 0 },
    })

    try {
      const response = await this.api.getChatMessages(channelId)

      if (revision !== this.revision || this.state.selectedChannelId !== channelId) {
        return
      }

      this.patch({
        hasMore: response.pagination.has_more,
        loading: false,
        messages: response.messages,
      })

      if (this.state.open) {
        this.unsubscribeRealtime = this.realtime?.subscribe(
          channelId,
          () => void this.refreshSelectedChannel(channelId),
          selectedChannel.type,
        ) ?? null
      }
    } catch {
      if (revision === this.revision) {
        this.patch({ error: 'Não foi possível carregar as mensagens.', loading: false })
      }
    }
  }

  async loadMore(): Promise<void> {
    const channelId = this.state.selectedChannelId
    const before = this.state.messages[0]?.created_at

    if (!channelId || !before || !this.state.hasMore || this.state.loadingMore) {
      return
    }

    const revision = this.revision
    this.patch({ loadingMore: true })

    try {
      const response = await this.api.getChatMessages(channelId, { before })

      if (revision !== this.revision || channelId !== this.state.selectedChannelId) {
        return
      }

      this.patch({
        hasMore: response.pagination.has_more,
        loadingMore: false,
        messages: mergeMessages(response.messages, this.state.messages),
      })
    } catch {
      if (revision === this.revision) {
        this.patch({ error: 'Não foi possível buscar mensagens antigas.', loadingMore: false })
      }
    }
  }

  async send(message: string): Promise<void> {
    const channelId = this.state.selectedChannelId
    const normalized = message.trim()

    if (!channelId) {
      throw new Error('Selecione um canal.')
    }
    if (!normalized) {
      throw new Error('Digite uma mensagem.')
    }
    if (normalized.length > CHAT_MESSAGE_MAX_LENGTH) {
      throw new Error(`A mensagem pode ter até ${CHAT_MESSAGE_MAX_LENGTH} caracteres.`)
    }
    if (this.state.banned) {
      throw new Error('Seu acesso ao chat está bloqueado.')
    }
    if (this.state.mutedUntil && Date.parse(this.state.mutedUntil) > this.now()) {
      throw new Error('Você está temporariamente silenciado no chat.')
    }
    if (this.now() - this.lastSentAt < SEND_COOLDOWN_MS) {
      throw new Error('Aguarde um instante antes de enviar outra mensagem.')
    }

    this.patch({ error: null, sending: true })

    try {
      const response = await this.api.sendChatMessage(channelId, normalized)
      this.lastSentAt = this.now()
      this.patch({
        messages: mergeMessages(this.state.messages, [response.message]),
        sending: false,
      })
    } catch (error) {
      this.patch({ error: 'Não foi possível enviar a mensagem.', sending: false })
      throw error
    }
  }

  async startDirectConversation(recipientId: string): Promise<void> {
    const normalized = recipientId.trim()
    if (!normalized) {
      throw new Error('Não foi possível identificar esta pessoa.')
    }

    this.patch({ error: null, loading: true })
    try {
      const response = await this.api.startDirectChat(normalized)
      const channels = [
        ...this.state.channels.filter((channel) => channel.id !== response.channel.id),
        response.channel,
      ]
      this.patch({ channels, loading: false })
      await this.selectChannel(response.channel.id)
    } catch (error) {
      this.patch({
        error: 'Não foi possível abrir a conversa direta.',
        loading: false,
      })
      throw error
    }
  }

  async report(messageId: string, reason: string): Promise<void> {
    const normalized = reason.trim()

    if (!normalized) {
      throw new Error('Informe o motivo da denúncia.')
    }

    await this.api.reportChatMessage(messageId, normalized.slice(0, 500))
  }

  blockUser(userId: string): void {
    if (!userId.trim()) {
      return
    }

    this.blockedUserIds.add(userId)
    this.persistBlockedUsers()
    this.emit()
  }

  unblockUser(userId: string): void {
    if (this.blockedUserIds.delete(userId)) {
      this.persistBlockedUsers()
      this.emit()
    }
  }

  isUserBlocked(userId: string): boolean {
    return this.blockedUserIds.has(userId)
  }

  private visibleMessages(): ChatMessage[] {
    return this.state.messages.filter(
      (message) => !this.blockedUserIds.has(message.user_id),
    )
  }

  private refreshSelectedChannel(channelId: string): Promise<void> {
    if (
      this.refreshInFlight
      || channelId !== this.state.selectedChannelId
    ) {
      return this.refreshInFlight ?? Promise.resolve()
    }

    const revision = this.revision
    const operation = this.api.getChatMessages(channelId)
      .then((response) => {
        if (revision !== this.revision || channelId !== this.state.selectedChannelId) {
          return
        }

        const previousIds = new Set(this.state.messages.map((message) => message.id))
        const incomingCount = response.messages.filter(
          (message) => !previousIds.has(message.id),
        ).length
        this.patch({
          messages: mergeMessages(this.state.messages, response.messages),
          unread: this.state.open
            ? this.state.unread
            : {
                ...this.state.unread,
                [channelId]: (this.state.unread[channelId] ?? 0) + incomingCount,
              },
        })
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.refreshInFlight === operation) {
          this.refreshInFlight = null
        }
      })

    this.refreshInFlight = operation
    return operation
  }

  private applyStatus(response: ChatStatusResponse): void {
    this.patch({
      banned: response.status.banned,
      moderationReason: response.status.reason,
      mutedUntil: response.status.muted_until,
    })
  }

  private stopRealtime(): void {
    this.unsubscribeRealtime?.()
    this.unsubscribeRealtime = null
  }

  private patch(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  private emit(): void {
    const state = this.getState()
    this.listeners.forEach((listener) => listener(state))
  }

  private persistBlockedUsers(): void {
    try {
      this.storage?.setItem(BLOCKED_USERS_KEY, JSON.stringify([...this.blockedUserIds]))
    } catch {
      // Local moderation remains best-effort when storage is unavailable.
    }
  }
}
