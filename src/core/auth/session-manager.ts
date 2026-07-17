/** Session Manager — validation, expiration, device sessions, inactivity cleanup. */

import { generateUUID, type UUID } from "../types";
import type { DeviceInfo, Session } from "./types";
import { SESSION_INACTIVITY_LIMIT_MS, SESSION_MAX_LIFETIME_MS } from "./types";
import type { ISessionStorage } from "./session-storage";
import { InMemorySessionStorage } from "./session-storage";

export class SessionManager {
  constructor(private readonly storage: ISessionStorage = new InMemorySessionStorage()) {}

  async createSession(userId: UUID, device: DeviceInfo): Promise<Session> {
    const now = new Date();
    const session: Session = {
      id: generateUUID(),
      userId,
      device,
      status: "active",
      issuedAt: now,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + SESSION_MAX_LIFETIME_MS),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
      deletedBy: null,
    };
    return this.storage.save(session);
  }

  async getSession(sessionId: UUID): Promise<Session | null> {
    return this.storage.get(sessionId);
  }

  async getDeviceSessions(userId: UUID): Promise<Session[]> {
    return this.storage.getByUser(userId);
  }

  isExpired(session: Session, now: Date = new Date()): boolean {
    return session.expiresAt.getTime() <= now.getTime();
  }

  isInactive(session: Session, now: Date = new Date()): boolean {
    return now.getTime() - session.lastActiveAt.getTime() > SESSION_INACTIVITY_LIMIT_MS;
  }

  async validateSession(sessionId: UUID): Promise<Session | null> {
    const session = await this.storage.get(sessionId);
    if (!session || session.status !== "active") return null;
    if (this.isExpired(session) || this.isInactive(session)) {
      await this.expireSession(session);
      return null;
    }
    return session;
  }

  async touchSession(sessionId: UUID): Promise<Session | null> {
    const session = await this.storage.get(sessionId);
    if (!session) return null;
    session.lastActiveAt = new Date();
    session.updatedAt = session.lastActiveAt;
    return this.storage.save(session);
  }

  async expireSession(session: Session): Promise<void> {
    session.status = "expired";
    session.updatedAt = new Date();
    await this.storage.save(session);
  }

  async revokeSession(sessionId: UUID): Promise<void> {
    const session = await this.storage.get(sessionId);
    if (!session) return;
    session.status = "revoked";
    session.updatedAt = new Date();
    await this.storage.save(session);
  }

  /** Automatic logout: expires any session older than SESSION_MAX_LIFETIME_MS. */
  async cleanupInactiveSessions(now: Date = new Date()): Promise<number> {
    const sessions = await this.storage.list();
    let cleaned = 0;
    for (const session of sessions) {
      if (
        session.status === "active" &&
        (this.isExpired(session, now) || this.isInactive(session, now))
      ) {
        await this.expireSession(session);
        cleaned += 1;
      }
    }
    return cleaned;
  }
}
