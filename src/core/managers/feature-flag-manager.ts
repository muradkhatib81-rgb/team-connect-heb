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

  isEnabled(key: string): boolean {
    return this.flags.get(key)?.enabled ?? false;
  }
}
