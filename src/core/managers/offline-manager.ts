/** Offline Manager — tracks connectivity state and queues pending operations. */

import { BaseManager } from "./manager.interface";

export interface PendingOperation {
  id: string;
  execute: () => Promise<void>;
}

export class OfflineManager extends BaseManager {
  private online = true;
  private readonly queue: PendingOperation[] = [];

  constructor() {
    super("offline-manager");
  }

  isOnline(): boolean {
    return this.online;
  }

  setOnline(online: boolean): void {
    this.online = online;
  }

  enqueue(operation: PendingOperation): void {
    this.queue.push(operation);
  }

  async flush(): Promise<void> {
    if (!this.online) return;
    while (this.queue.length > 0) {
      const operation = this.queue.shift();
      await operation?.execute();
    }
  }
}
