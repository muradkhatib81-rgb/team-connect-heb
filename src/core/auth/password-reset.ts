/** Password Reset foundation — no email/database connection yet. */

import { generateUUID, type UUID } from "../types";
import type { PasswordResetRequest } from "./types";

export interface IPasswordResetStore {
  save(request: PasswordResetRequest): Promise<PasswordResetRequest>;
  findByToken(token: string): Promise<PasswordResetRequest | null>;
}

export class NotConnectedPasswordResetStore implements IPasswordResetStore {
  async save(): Promise<PasswordResetRequest> {
    return this.notConnected();
  }
  async findByToken(): Promise<PasswordResetRequest | null> {
    return this.notConnected();
  }
  private notConnected(): never {
    throw new Error("Password reset storage is not connected. Prepared abstraction only.");
  }
}

export class PasswordResetManager {
  constructor(private readonly store: IPasswordResetStore = new NotConnectedPasswordResetStore()) {}

  async requestReset(userId: UUID): Promise<PasswordResetRequest> {
    const now = new Date();
    return this.store.save({
      id: generateUUID(),
      userId,
      token: generateUUID(),
      status: "pending",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
      deletedBy: null,
    });
  }

  async validateToken(token: string): Promise<PasswordResetRequest | null> {
    const request = await this.store.findByToken(token);
    if (!request || request.status !== "pending") return null;
    if (request.expiresAt.getTime() <= Date.now()) return null;
    return request;
  }
}
