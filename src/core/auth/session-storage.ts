/** Session Storage abstraction. In-memory default; swappable for a real store later. */

import type { UUID } from "../types";
import type { Session } from "./types";

export interface ISessionStorage {
  get(sessionId: UUID): Promise<Session | null>;
  getByUser(userId: UUID): Promise<Session[]>;
  save(session: Session): Promise<Session>;
  remove(sessionId: UUID): Promise<void>;
  list(): Promise<Session[]>;
}

export class InMemorySessionStorage implements ISessionStorage {
  private readonly sessions = new Map<UUID, Session>();

  async get(sessionId: UUID): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async getByUser(userId: UUID): Promise<Session[]> {
    return [...this.sessions.values()].filter((s) => s.userId === userId);
  }

  async save(session: Session): Promise<Session> {
    this.sessions.set(session.id, session);
    return session;
  }

  async remove(sessionId: UUID): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async list(): Promise<Session[]> {
    return [...this.sessions.values()];
  }
}
