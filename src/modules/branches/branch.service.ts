/**
 * Branch Service — business operations for the Branches module.
 *
 * Sits above `BranchRepository` (Repository Layer) and below the UI. Uses
 * the existing Foundation exclusively: `getDatabaseClient()` for
 * persistence (in-memory today, Supabase-ready by contract) and
 * `getConfigurationManager()` for Branch Settings, namespaced exactly like
 * `CompanyService.getCompanySetting`. No Supabase reference, no new
 * abstraction — this service never reads or writes the real `branches`
 * table itself; it only records which real branch (`sourceBranchId`) is
 * assigned to which Company. The real branch data (and every relationship
 * hanging off it) is read directly by the UI layer, exactly like the
 * existing `useActiveBranch` hook already does (see `branch-dialogs.tsx`).
 */

import type { UUID } from "@/core";
import { getConfigurationManager, getDatabaseClient } from "@/core/bootstrap";
import { BranchRepository } from "./branch.repository";
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

const branchRepository = new BranchRepository(getDatabaseClient());

export class BranchService {
  listBranches(companyId: UUID): Promise<Branch[]> {
    return branchRepository.findByCompany(companyId);
  }

  /** Every non-deleted Branch assignment on the Platform, across every Company. */
  listAllBranches(): Promise<Branch[]> {
    return branchRepository.findAll();
  }

  getBranch(id: UUID): Promise<Branch | null> {
    return branchRepository.findById(id);
  }

  findAssignmentForSourceBranch(sourceBranchId: string): Promise<Branch | null> {
    return branchRepository.findBySourceBranchId(sourceBranchId);
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
    const existing = await branchRepository.findBySourceBranchId(source.id);
    if (existing) {
      throw new Error("הסניף הזה משויך כבר לחברה אחרת בפלטפורמה.");
    }
    return branchRepository.create({
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
    return branchRepository.update(id, {
      name: trimmedName,
      code: source.code?.trim() || null,
      address: source.address?.trim() || null,
      isActive: source.is_active ?? true,
    });
  }

  /** Removes the Company <-> Branch assignment only. The real branch and every relationship it owns are untouched. */
  unassignBranch(id: UUID): Promise<void> {
    return branchRepository.softDelete(id);
  }

  restoreBranch(id: UUID): Promise<void> {
    return branchRepository.restore(id);
  }

  getBranchSetting<T>(branchId: UUID, key: string): T | undefined {
    return getConfigurationManager().get<T>(`branch:${branchId}:${key}`);
  }

  setBranchSetting<T>(branchId: UUID, key: string, value: T): void {
    getConfigurationManager().set(`branch:${branchId}:${key}`, value);
  }

  async getBranchStatistics(branch: Branch): Promise<BranchStatistics> {
    const siblings = await branchRepository.findByCompany(branch.companyId);
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
