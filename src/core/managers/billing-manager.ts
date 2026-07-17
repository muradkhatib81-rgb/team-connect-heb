/** Billing Manager — foundation for future plan/subscription tracking. No payment provider. */

import type { UUID } from "../types";
import { BaseManager } from "./manager.interface";

export type BillingPlan = "free" | "standard" | "enterprise";

export interface BillingAccount {
  ownerId: UUID;
  plan: BillingPlan;
}

export class BillingManager extends BaseManager {
  private readonly accounts = new Map<UUID, BillingAccount>();

  constructor() {
    super("billing-manager");
  }

  setPlan(ownerId: UUID, plan: BillingPlan): void {
    this.accounts.set(ownerId, { ownerId, plan });
  }

  getPlan(ownerId: UUID): BillingPlan {
    return this.accounts.get(ownerId)?.plan ?? "free";
  }
}
