/** Resource Manager — tracks per-scope resource usage/quotas. No business rules yet. */

import type { UUID } from "../types";
import { BaseManager } from "./manager.interface";

export interface ResourceUsage {
  scopeTargetId: UUID;
  resourceKey: string;
  used: number;
  limit: number | null;
}

export class ResourceManager extends BaseManager {
  private readonly usage = new Map<string, ResourceUsage>();

  constructor() {
    super("resource-manager");
  }

  private key(scopeTargetId: UUID, resourceKey: string): string {
    return `${scopeTargetId}:${resourceKey}`;
  }

  setUsage(usage: ResourceUsage): void {
    this.usage.set(this.key(usage.scopeTargetId, usage.resourceKey), usage);
  }

  getUsage(scopeTargetId: UUID, resourceKey: string): ResourceUsage | undefined {
    return this.usage.get(this.key(scopeTargetId, resourceKey));
  }

  isWithinLimit(scopeTargetId: UUID, resourceKey: string): boolean {
    const usage = this.getUsage(scopeTargetId, resourceKey);
    if (!usage || usage.limit === null) return true;
    return usage.used <= usage.limit;
  }
}
