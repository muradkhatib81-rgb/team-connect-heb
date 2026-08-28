/**
 * Realtime Manager — channel subscription abstraction. No realtime provider
 * connected: every channel lives only in this manager's own memory for the
 * current session (same persistence model as the rest of the in-memory
 * Foundation — see `core/database/database-client.ts`).
 *
 * Beyond the raw pub/sub primitive (`IRealtimeChannel`), this manager also
 * tracks real, honest channel metadata (description, visibility, open/closed
 * state) and real, derived statistics (connected clients, active
 * subscriptions, events published, last activity) so the Platform's
 * Real-Time page (Part 5) can be fully functional without fabricating any
 * data: every number here is actually counted from `subscribe`/`publish`
 * calls made against that channel.
 */

import { BaseManager } from "./manager.interface";

export type RealtimeHandler<T = unknown> = (payload: T) => void;

export type ChannelVisibility = "public" | "private" | "system";

export interface IRealtimeChannel {
  subscribe<T>(handler: RealtimeHandler<T>): () => void;
  publish<T>(payload: T): void;
}

export interface OpenChannelInput {
  name: string;
  description?: string | null;
  visibility?: ChannelVisibility;
}

export interface UpdateChannelInput {
  description?: string | null;
  visibility?: ChannelVisibility;
}

export interface ChannelSnapshot {
  name: string;
  description: string | null;
  visibility: ChannelVisibility;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  /** Every currently-active `subscribe()` on this channel — the only honest notion of a "connected client" this in-memory abstraction has. */
  connectedClients: number;
  activeSubscriptions: number;
  eventsPublished: number;
  lastActivityAt: Date | null;
}

class InMemoryRealtimeChannel implements IRealtimeChannel {
  private readonly handlers = new Set<RealtimeHandler>();
  eventsPublished = 0;
  lastActivityAt: Date | null = null;

  subscribe<T>(handler: RealtimeHandler<T>): () => void {
    this.handlers.add(handler as RealtimeHandler);
    return () => this.handlers.delete(handler as RealtimeHandler);
  }

  publish<T>(payload: T): void {
    this.eventsPublished += 1;
    this.lastActivityAt = new Date();
    this.handlers.forEach((handler) => handler(payload));
  }

  get subscriberCount(): number {
    return this.handlers.size;
  }
}

interface ChannelRecord {
  channel: InMemoryRealtimeChannel;
  description: string | null;
  visibility: ChannelVisibility;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

export class RealtimeManager extends BaseManager {
  private readonly records = new Map<string, ChannelRecord>();

  constructor() {
    super("realtime-manager");
  }

  /** Raw pub/sub handle for a channel, creating it (open, public) if it doesn't exist yet. */
  channel(name: string): IRealtimeChannel {
    return this.ensureRecord(name).channel;
  }

  private ensureRecord(name: string): ChannelRecord {
    let record = this.records.get(name);
    if (!record) {
      const now = new Date();
      record = {
        channel: new InMemoryRealtimeChannel(),
        description: null,
        visibility: "public",
        createdAt: now,
        updatedAt: now,
        closedAt: null,
      };
      this.records.set(name, record);
    }
    return record;
  }

  /** Opens a brand-new channel, or reopens a previously closed one (never a duplicate — throws if it's already open). */
  openChannel(input: OpenChannelInput): ChannelSnapshot {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Channel name is required.");
    }
    const existing = this.records.get(name);
    if (existing && !existing.closedAt) {
      throw new Error("ערוץ בשם זה כבר פתוח.");
    }
    const now = new Date();
    if (existing) {
      existing.closedAt = null;
      existing.description = input.description?.trim() || null;
      existing.visibility = input.visibility ?? "public";
      existing.updatedAt = now;
    } else {
      this.records.set(name, {
        channel: new InMemoryRealtimeChannel(),
        description: input.description?.trim() || null,
        visibility: input.visibility ?? "public",
        createdAt: now,
        updatedAt: now,
        closedAt: null,
      });
    }
    return this.getSnapshot(name)!;
  }

  updateChannel(name: string, input: UpdateChannelInput): ChannelSnapshot {
    const record = this.records.get(name);
    if (!record) {
      throw new Error("הערוץ לא נמצא.");
    }
    if (input.description !== undefined) record.description = input.description?.trim() || null;
    if (input.visibility !== undefined) record.visibility = input.visibility;
    record.updatedAt = new Date();
    return this.getSnapshot(name)!;
  }

  closeChannel(name: string): ChannelSnapshot {
    const record = this.records.get(name);
    if (!record) {
      throw new Error("הערוץ לא נמצא.");
    }
    record.closedAt = new Date();
    record.updatedAt = record.closedAt;
    return this.getSnapshot(name)!;
  }

  deleteChannel(name: string): void {
    if (!this.records.has(name)) {
      throw new Error("הערוץ לא נמצא.");
    }
    this.records.delete(name);
  }

  getSnapshot(name: string): ChannelSnapshot | null {
    const record = this.records.get(name);
    if (!record) return null;
    return {
      name,
      description: record.description,
      visibility: record.visibility,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      closedAt: record.closedAt,
      connectedClients: record.channel.subscriberCount,
      activeSubscriptions: record.channel.subscriberCount,
      eventsPublished: record.channel.eventsPublished,
      lastActivityAt: record.channel.lastActivityAt,
    };
  }

  /** Every channel opened so far this session (open or closed), most recently updated first. */
  listChannels(): ChannelSnapshot[] {
    return [...this.records.keys()]
      .map((name) => this.getSnapshot(name)!)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /** Records a postgres_changes (or similar) event against an open channel — used by RealtimeBridge. */
  recordActivity(name: string): void {
    const record = this.records.get(name);
    if (!record || record.closedAt) return;
    record.channel.eventsPublished += 1;
    record.channel.lastActivityAt = new Date();
    record.updatedAt = new Date();
  }

  /** @deprecated kept for backward compatibility — prefer `listChannels()`. */
  listChannelNames(): string[] {
    return [...this.records.keys()];
  }
}
