/** Audit Manager — facade over the Audit Logger (see ../logging). */

import { BaseManager } from "./manager.interface";
import { AuditLogger } from "../logging/audit-logger";

export class AuditManager extends BaseManager {
  constructor(private readonly logger: AuditLogger = new AuditLogger()) {
    super("audit-manager");
  }

  record(action: string, meta?: Record<string, unknown>): void {
    this.logger.info(action, meta);
  }
}
