import { describe, expect, it, vi } from 'vitest'

import type { ChatChannel } from '../types/backend-api'
import { ChatService, type ChatRealtimeGateway } from './chat-service'

const channel: ChatChannel = {
  game_id: null,
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Global',
  type: 'global',
  unread: 0,
}

function chatApi(getChatChannels = vi.fn(async () => ({ channels: [channel] }))) {
  return {
    deleteDirectChat: vi.fn(async () => ({ deleted: true })),
    getChatChannels,
    getChatMessages: vi.fn(async () => ({
      messages: [],
      pagination: { has_more: false, next_before: null },
    })),
    getChatStatus: vi.fn(async () => ({
      status: { banned: false, muted_until: null, reason: null },
    })),
    reportChatMessage: vi.fn(async () => ({ report: { id: 'report', status: 'pending' as const } })),
    sendChatMessage: vi.fn(),
    startDirectChat: vi.fn(),
  }
}

describe('ChatService resource usage', () => {
  it('removes the realtime subscription when the chat closes', async () => {
    const unsubscribe = vi.fn()
    const realtime: ChatRealtimeGateway = {
      subscribe: vi.fn(() => unsubscribe),
    }
    const service = new ChatService(chatApi(), realtime, null)

    await service.open()
    service.close()

    expect(realtime.subscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('throttles repeated unread refreshes while keeping a later refresh available', async () => {
    let now = 1_000_000
    const getChatChannels = vi.fn(async () => ({ channels: [channel] }))
    const service = new ChatService(chatApi(getChatChannels), null, null, () => now)

    await service.start()
    await service.refreshUnread()
    now += 89_000
    await service.refreshUnread()
    expect(getChatChannels).toHaveBeenCalledTimes(1)

    now += 1_001
    await service.refreshUnread()
    expect(getChatChannels).toHaveBeenCalledTimes(2)
  })
})
