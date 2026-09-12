import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../types/database'
import type { ChatChannel } from '../types/backend-api'
import type { ChatRealtimeGateway } from './chat-service'

export class SupabaseChatRealtimeGateway implements ChatRealtimeGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  subscribeIncoming(onMessage: Parameters<NonNullable<ChatRealtimeGateway['subscribeIncoming']>>[0]): () => void {
    const channel = this.client.channel('altgrid-chat:mentions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const row = payload.new
        if (typeof row.id === 'string' && typeof row.channel_id === 'string'
          && typeof row.user_id === 'string' && typeof row.message === 'string') {
          onMessage({ id: row.id, channel_id: row.channel_id, user_id: row.user_id, message: row.message })
        }
      }).subscribe()
    return () => { void this.client.removeChannel(channel) }
  }

  subscribe(
    channelId: string,
    onChange: () => void,
    _type?: ChatChannel['type'],
  ): () => void {
    const channel = this.client
      .channel(`altgrid-chat:${channelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          filter: `channel_id=eq.${channelId}`,
          schema: 'public',
          table: 'chat_messages',
        },
        onChange,
      )
      .subscribe()

    return () => {
      void this.client.removeChannel(channel)
    }
  }
}
