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
  it('sounds only new mentions or direct messages from other unblocked users and releases its listener', async () => {
    let receive: Parameters<NonNullable<ChatRealtimeGateway['subscribeIncoming']>>[0] = () => undefined
    const unsubscribe = vi.fn()
    const direct: ChatChannel = { ...channel, id: 'direct', name: 'Direct', type: 'direct' }
    const service = new ChatService(chatApi(vi.fn(async () => ({ channels: [channel, direct] }))), {
      subscribe: () => () => undefined,
      subscribeIncoming: (callback) => { receive = callback; return unsubscribe },
    }, null)
    const sound = vi.fn()
    await service.start()
    service.watchMentions('me', 'Caco', sound)
    const message = { id: '1', channel_id: channel.id, user_id: 'other', message: 'Oi @Caco!' }
    receive(message)
    receive(message)
    receive({ ...message, id: '2', user_id: 'me' })
    receive({ ...message, id: '3', message: '@Cacolina' })
    service.blockUser('blocked')
    receive({ ...message, id: '4', user_id: 'blocked' })
    receive({ ...message, id: '5', channel_id: direct.id, message: 'Mensagem privada' })
    expect(sound).toHaveBeenCalledTimes(2)
    service.reset()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('bounds retained messages during sustained sending', async () => {
    let now = 10_000
    const api = chatApi()
    api.sendChatMessage.mockImplementation(async (_channel, message) => ({ message: {
      id: String(now), channel_id: channel.id, user_id: 'me', message,
      display_name: 'Me', created_at: new Date(now).toISOString(), edited_at: null, plan: 'free', founder_number: null,
    } }))
    const service = new ChatService(api, null, null, () => now)
    await service.open()
    for (let index = 0; index < 220; index++) { now += 1100; await service.send(`message ${index}`) }
    expect(service.getState().messages).toHaveLength(200)
    expect(service.getState().messages[0]?.message).toBe('message 20')
  })
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
