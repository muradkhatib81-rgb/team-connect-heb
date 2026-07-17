/** Notification Manager — in-app notification dispatch abstraction. No provider connected. */

import { BaseManager } from "./manager.interface";

export interface NotificationPayload {
  title: string;
  body: string;
  recipientId: string;
}

export interface INotificationChannel {
  send(payload: NotificationPayload): Promise<void>;
}

export class NoopNotificationChannel implements INotificationChannel {
  async send(): Promise<void> {}
}

export class NotificationManager extends BaseManager {
  constructor(private readonly channel: INotificationChannel = new NoopNotificationChannel()) {
    super("notification-manager");
  }

  async notify(payload: NotificationPayload): Promise<void> {
    await this.channel.send(payload);
  }
}
