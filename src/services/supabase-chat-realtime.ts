import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../types/database'
import type { ChatChannel } from '../types/backend-api'
import type { ChatRealtimeGateway } from './chat-service'

export class SupabaseChatRealtimeGateway implements ChatRealtimeGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

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
