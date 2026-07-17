/** Audit Manager — facade over the Audit Logger (see ../logging). */

import { BaseManager } from "./manager.interface";
import { AuditLogger } from "../logging/audit-logger";

export interface AuditRecord {
  id: string;
  action: string;
  meta: Record<string, unknown>;
  createdAt: Date;
}

export class AuditManager extends BaseManager {
  private readonly records: AuditRecord[] = [];

  constructor(private readonly logger: AuditLogger = new AuditLogger()) {
    super("audit-manager");
  }

  record(action: string, meta?: Record<string, unknown>): void {
    const record = { id: crypto.randomUUID(), action, meta: meta ?? {}, createdAt: new Date() };
    this.records.unshift(record);
    this.logger.info(action, record.meta);
  }

  list(): AuditRecord[] {
    return [...this.records];
  }
}
