/** Authentication Manager — prepared abstraction, no connected identity provider. */

import type { UUID } from "../types";
import type { AuthCredentials, AuthenticatedIdentity, DeviceInfo } from "./types";
import { SessionManager } from "./session-manager";

export interface IAuthProvider {
  verifyCredentials(credentials: AuthCredentials): Promise<UUID>;
}

export class NotConnectedAuthProvider implements IAuthProvider {
  async verifyCredentials(): Promise<UUID> {
    throw new Error(
      "Authentication provider is not connected. This is a prepared abstraction for future integration.",
    );
  }
}

export class AuthenticationManager {
  constructor(
    private readonly provider: IAuthProvider = new NotConnectedAuthProvider(),
    private readonly sessions: SessionManager = new SessionManager(),
  ) {}

  async login(credentials: AuthCredentials, device: DeviceInfo): Promise<AuthenticatedIdentity> {
    const userId = await this.provider.verifyCredentials(credentials);
    const session = await this.sessions.createSession(userId, device);
    return { userId, session };
  }

  async logout(sessionId: UUID): Promise<void> {
    await this.sessions.revokeSession(sessionId);
  }

  async validate(sessionId: UUID) {
    return this.sessions.validateSession(sessionId);
  }
}
