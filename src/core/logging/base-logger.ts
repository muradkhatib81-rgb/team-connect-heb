/** Base Logger — shared behavior for all channel-specific loggers. */

import type { ILogger, ILogSink, LogLevel } from "./logger.interface";

export class ConsoleLogSink implements ILogSink {
  write(entry: {
    level: LogLevel;
    channel: string;
    message: string;
    meta?: Record<string, unknown>;
  }): void {
    const line = `[${entry.channel}] ${entry.message}`;
    if (entry.level === "error" || entry.level === "critical")
      console.error(line, entry.meta ?? "");
    else if (entry.level === "warn") console.warn(line, entry.meta ?? "");
    else console.log(line, entry.meta ?? "");
  }
}

export abstract class BaseLogger implements ILogger {
  constructor(
    public readonly channel: string,
    protected readonly sink: ILogSink = new ConsoleLogSink(),
  ) {}

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    this.sink.write({ level, channel: this.channel, message, meta, timestamp: new Date() });
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }
  critical(message: string, meta?: Record<string, unknown>): void {
    this.log("critical", message, meta);
  }
}
