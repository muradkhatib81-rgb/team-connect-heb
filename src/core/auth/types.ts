/** Authentication Foundation — shared types. Not connected to any provider. */

import type { BaseEntity, UUID } from "../types";

export type SessionStatus = "active" | "expired" | "revoked";

export interface DeviceInfo {
  deviceId: UUID;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface Session extends BaseEntity {
  userId: UUID;
  device: DeviceInfo;
  status: SessionStatus;
  issuedAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
}

export interface AuthCredentials {
  identifier: string;
  secret: string;
}

export interface AuthenticatedIdentity {
  userId: UUID;
  session: Session;
}

export type PasswordResetStatus = "pending" | "completed" | "expired";

export interface PasswordResetRequest extends BaseEntity {
  userId: UUID;
  token: string;
  status: PasswordResetStatus;
  expiresAt: Date;
}

export const SESSION_MAX_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const SESSION_INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
