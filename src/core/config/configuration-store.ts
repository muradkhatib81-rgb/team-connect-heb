/** Configuration Store — generic in-memory key/value store used by settings + feature flags. */

export class ConfigurationStore<T = unknown> {
  private readonly values = new Map<string, T>();

  get(key: string): T | undefined {
    return this.values.get(key);
  }

  set(key: string, value: T): void {
    this.values.set(key, value);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  entries(): [string, T][] {
    return [...this.values.entries()];
  }
}
