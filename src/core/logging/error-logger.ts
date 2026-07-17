import { BaseLogger } from "./base-logger";

export class ErrorLogger extends BaseLogger {
  constructor() {
    super("error");
  }
}
