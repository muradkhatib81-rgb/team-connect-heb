/** Logging Foundation — common contract for all loggers. */

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

export interface LogEntry {
  level: LogLevel;
  channel: string;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: Date;
}

export interface ILogger {
  readonly channel: string;
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}

export interface ILogSink {
  write(entry: LogEntry): void;
}
