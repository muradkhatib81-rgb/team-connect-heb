/**
 * Branch Service — business operations for the Branches module.
 *
 * Sits above `BranchRepository` (Repository Layer) and below the UI. Uses
 * the existing Foundation exclusively: `getDatabaseClient()` for
 * persistence (in-memory today, Supabase-ready by contract) and
 * `getConfigurationManager()` for Branch Settings, namespaced exactly like
 * `CompanyService.getCompanySetting`. No Supabase reference, no new
 * abstraction.
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

const branchRepository = new BranchRepository(getDatabaseClient());

export class BranchService {
  listBranches(companyId: UUID): Promise<Branch[]> {
    return branchRepository.findByCompany(companyId);
  }

  /** Every non-deleted Branch on the Platform, across every Company. */
  listAllBranches(): Promise<Branch[]> {
    return branchRepository.findAll();
  }

  getBranch(id: UUID): Promise<Branch | null> {
    return branchRepository.findById(id);
  }

  createBranch(companyId: UUID, name: string): Promise<Branch> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Branch name is required.");
    }
    return branchRepository.create({ companyId, name: trimmed });
  }

  updateBranch(id: UUID, data: { name: string }): Promise<Branch> {
    const trimmed = data.name.trim();
    if (!trimmed) {
      throw new Error("Branch name is required.");
    }
    return branchRepository.update(id, { name: trimmed });
  }

  deleteBranch(id: UUID): Promise<void> {
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
