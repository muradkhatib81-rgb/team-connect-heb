/** Realtime Manager — channel subscription abstraction. No realtime provider connected. */

import { BaseManager } from "./manager.interface";

export type RealtimeHandler<T = unknown> = (payload: T) => void;

export interface IRealtimeChannel {
  subscribe<T>(handler: RealtimeHandler<T>): () => void;
  publish<T>(payload: T): void;
}

class InMemoryRealtimeChannel implements IRealtimeChannel {
  private readonly handlers = new Set<RealtimeHandler>();

  subscribe<T>(handler: RealtimeHandler<T>): () => void {
    this.handlers.add(handler as RealtimeHandler);
    return () => this.handlers.delete(handler as RealtimeHandler);
  }

  publish<T>(payload: T): void {
    this.handlers.forEach((handler) => handler(payload));
  }
}

export class RealtimeManager extends BaseManager {
  private readonly channels = new Map<string, IRealtimeChannel>();

  constructor() {
    super("realtime-manager");
  }

  channel(name: string): IRealtimeChannel {
    if (!this.channels.has(name)) this.channels.set(name, new InMemoryRealtimeChannel());
    return this.channels.get(name)!;
  }

  /** Names of every channel opened so far this session. Read-only introspection. */
  listChannelNames(): string[] {
    return [...this.channels.keys()];
  }
}
