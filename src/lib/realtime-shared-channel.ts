import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Supabase throws if `.on()` is called after `subscribe()` on an existing channel name. */
const sharedChannelRefs = new Map<string, number>();
const sharedChannels = new Map<string, RealtimeChannel>();

export function retainSharedRealtimeChannel(
  channelName: string,
  setup: (channel: RealtimeChannel) => RealtimeChannel,
): () => void {
  const nextRefs = (sharedChannelRefs.get(channelName) ?? 0) + 1;
  sharedChannelRefs.set(channelName, nextRefs);
  if (nextRefs === 1) {
    const channel = setup(supabase.channel(channelName));
    channel.subscribe();
    sharedChannels.set(channelName, channel);
  }
  return () => {
    const remaining = (sharedChannelRefs.get(channelName) ?? 1) - 1;
    if (remaining <= 0) {
      sharedChannelRefs.delete(channelName);
      const channel = sharedChannels.get(channelName);
      if (channel) {
        void supabase.removeChannel(channel);
        sharedChannels.delete(channelName);
      }
    } else {
      sharedChannelRefs.set(channelName, remaining);
    }
  };
}
