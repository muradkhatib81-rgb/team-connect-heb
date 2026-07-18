/**
 * Branch Service — business operations for the Branches module.
 *
 * Sits above `BranchRepository` (Repository Layer) and below the UI. Uses
 * the existing Foundation exclusively: `getDatabaseClient()` for
 * persistence (Supabase-backed `company_branch_assignments`) and
 * `getConfigurationManager()` for Branch Settings, namespaced exactly like
 * `CompanyService.getCompanySetting`. This service never reads or writes
 * operational `public.branches` itself; it only records which real branch
 * (`sourceBranchId`) is assigned to which Company. The real branch data
 * (and every relationship hanging off it) is read directly by the UI
 * layer, exactly like the existing `useActiveBranch` hook already does
 * (see `branch-dialogs.tsx`).
 */

import type { UUID } from "@/core";
import { getConfigurationManager, getDatabaseClient } from "@/core/bootstrap";
import { BranchRepository, type IBranchRepository } from "./branch.repository";
import type { Branch } from "./branch.model";

export interface BranchStatistics {
  totalBranchesInCompany: number;
  createdAt: Date;
  updatedAt: Date;
  ageInDays: number;
}

export interface BranchDashboardSnapshot {
  branch: Branch;
  statistics: BranchStatistics;
}

/** Snapshot of the real branch at assignment/refresh time — see the module doc comment. */
export interface RealBranchSnapshot {
  id: string;
  name: string;
  code?: string | null;
  address?: string | null;
  is_active?: boolean;
}

export class BranchService {
  constructor(
    private readonly repository: IBranchRepository = new BranchRepository(getDatabaseClient()),
  ) {}

  listBranches(companyId: UUID): Promise<Branch[]> {
    return this.repository.findByCompany(companyId);
  }

  /** Every non-deleted Branch assignment on the Platform, across every Company. */
  listAllBranches(): Promise<Branch[]> {
    return this.repository.findAll();
  }

  getBranch(id: UUID): Promise<Branch | null> {
    return this.repository.findById(id);
  }

  findAssignmentForSourceBranch(sourceBranchId: string): Promise<Branch | null> {
    return this.repository.findBySourceBranchId(sourceBranchId);
  }

  /**
   * Assigns an existing, real branch to a Company. Never creates a new real
   * branch and never duplicates an existing assignment — throws if the
   * source branch is already assigned to any Company (including this one).
   */
  async assignBranch(companyId: UUID, source: RealBranchSnapshot): Promise<Branch> {
    const trimmedName = source.name.trim();
    if (!trimmedName) {
      throw new Error("Branch name is required.");
    }
    const existing = await this.repository.findBySourceBranchId(source.id);
    if (existing) {
      throw new Error("הסניף הזה משויך כבר לחברה אחרת בפלטפורמה.");
    }
    return this.repository.create({
      companyId,
      sourceBranchId: source.id,
      name: trimmedName,
      code: source.code?.trim() || null,
      address: source.address?.trim() || null,
      isActive: source.is_active ?? true,
    });
  }

  /** Refreshes the denormalized snapshot (name/code/address/isActive) from the real branch. */
  refreshBranchSnapshot(id: UUID, source: RealBranchSnapshot): Promise<Branch> {
    const trimmedName = source.name.trim();
    if (!trimmedName) {
      throw new Error("Branch name is required.");
    }
    return this.repository.update(id, {
      name: trimmedName,
      code: source.code?.trim() || null,
      address: source.address?.trim() || null,
      isActive: source.is_active ?? true,
    });
  }

  /** Removes the Company <-> Branch assignment only. The real branch and every relationship it owns are untouched. */
  unassignBranch(id: UUID): Promise<void> {
    return this.repository.softDelete(id);
  }

  restoreBranch(id: UUID): Promise<void> {
    return this.repository.restore(id);
  }

  getBranchSetting<T>(branchId: UUID, key: string): T | undefined {
    return getConfigurationManager().get<T>(`branch:${branchId}:${key}`);
  }

  setBranchSetting<T>(branchId: UUID, key: string, value: T): void {
    getConfigurationManager().set(`branch:${branchId}:${key}`, value);
  }

  async getBranchStatistics(branch: Branch): Promise<BranchStatistics> {
    const siblings = await this.repository.findByCompany(branch.companyId);
    const ageInDays = Math.max(
      0,
      Math.floor((Date.now() - branch.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    );
    return {
      totalBranchesInCompany: siblings.length,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
      ageInDays,
    };
  }

  async getBranchDashboard(branch: Branch): Promise<BranchDashboardSnapshot> {
    const statistics = await this.getBranchStatistics(branch);
    return { branch, statistics };
  }
}

export const branchService = new BranchService();
