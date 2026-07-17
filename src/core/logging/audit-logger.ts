import { BaseLogger } from "./base-logger";

export class AuditLogger extends BaseLogger {
  constructor() {
    super("audit");
  }
}
