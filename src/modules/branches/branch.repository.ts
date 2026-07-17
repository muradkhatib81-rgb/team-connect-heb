import { BaseRepository, type IDatabaseClient, type IRepository, type UUID } from "@/core";
import type { Branch } from "./branch.model";

export type IBranchRepository = IRepository<Branch>;

export class BranchRepository extends BaseRepository<Branch> implements IBranchRepository {
  constructor(db: IDatabaseClient) {
    super(db, "branches");
  }

  /** All non-deleted Branches belonging to a given Company. */
  async findByCompany(companyId: UUID): Promise<Branch[]> {
    const all = await this.findAll();
    return all.filter((branch) => branch.companyId === companyId);
  }

  /** The assignment (if any) pointing at a given real Supabase branch id, across every Company. */
  async findBySourceBranchId(sourceBranchId: string): Promise<Branch | null> {
    const all = await this.findAll();
    return all.find((branch) => branch.sourceBranchId === sourceBranchId) ?? null;
  }
}
