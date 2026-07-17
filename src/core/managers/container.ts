/** Minimal Dependency Injection container for Core Managers. */

export class ManagerContainer {
  private readonly instances = new Map<string, unknown>();

  register<T>(token: string, instance: T): void {
    this.instances.set(token, instance);
  }

  resolve<T>(token: string): T {
    const instance = this.instances.get(token);
    if (!instance) throw new Error(`No manager registered for token "${token}"`);
    return instance as T;
  }

  has(token: string): boolean {
    return this.instances.has(token);
  }
}
