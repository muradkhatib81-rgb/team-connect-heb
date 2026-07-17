/** Integration Manager — registry for future external integrations. None connected. */

import { BaseManager } from "./manager.interface";

export interface IIntegration {
  readonly key: string;
  isConnected(): boolean;
}

export class IntegrationManager extends BaseManager {
  private readonly integrations = new Map<string, IIntegration>();

  constructor() {
    super("integration-manager");
  }

  register(integration: IIntegration): void {
    this.integrations.set(integration.key, integration);
  }

  get(key: string): IIntegration | undefined {
    return this.integrations.get(key);
  }

  list(): IIntegration[] {
    return [...this.integrations.values()];
  }
}
