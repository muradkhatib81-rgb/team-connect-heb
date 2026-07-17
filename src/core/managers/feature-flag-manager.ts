/** Feature Flag Manager — evaluates FeatureFlag records via the Configuration Store. */

import { BaseManager } from "./manager.interface";
import type { FeatureFlag } from "../config/types";

export class FeatureFlagManager extends BaseManager {
  private readonly flags = new Map<string, FeatureFlag>();

  constructor() {
    super("feature-flag-manager");
  }

  register(flag: FeatureFlag): void {
    this.flags.set(flag.key, flag);
  }

  get(key: string): FeatureFlag | null {
    return this.flags.get(key) ?? null;
  }

  update(key: string, patch: Partial<Omit<FeatureFlag, "id" | "key" | "createdAt" | "createdBy">>): FeatureFlag {
    const existing = this.flags.get(key);
    if (!existing) throw new Error("Feature flag not found.");
    const next = { ...existing, ...patch, updatedAt: new Date() };
    this.flags.set(key, next);
    return next;
  }

  remove(key: string): void {
    if (!this.flags.delete(key)) throw new Error("Feature flag not found.");
  }

  isEnabled(key: string): boolean {
    const flag = this.flags.get(key);
    return flag?.enabled === true && !flag.archivedAt;
  }

  list(): FeatureFlag[] {
    return [...this.flags.values()];
  }
}
