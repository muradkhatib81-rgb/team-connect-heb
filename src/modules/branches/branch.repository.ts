import { BaseRepository, type IDatabaseClient, type IRepository, type UUID } from "@/core";
import type { Branch } from "./branch.model";

export interface IBranchRepository extends IRepository<Branch> {
  findByCompany(companyId: UUID): Promise<Branch[]>;
  findBySourceBranchId(sourceBranchId: string): Promise<Branch | null>;
}

export class BranchRepository extends BaseRepository<Branch> implements IBranchRepository {
  constructor(db: IDatabaseClient) {
    // Physical table: public.company_branch_assignments (mapped in SupabaseDatabaseClient).
    // Logical name stays "branches" so Foundation Branch assignments never collide with
    // operational public.branches.
    super(db, "branches");
  }

  /** All non-deleted Branches belonging to a given Company. */
  findByCompany(companyId: UUID): Promise<Branch[]> {
    return this.db.findMany<Branch>(this.tableName, { companyId, deletedAt: null });
  }

  /** The assignment (if any) pointing at a given real Supabase branch id, across every Company. */
  findBySourceBranchId(sourceBranchId: string): Promise<Branch | null> {
    return this.db.findOne<Branch>(this.tableName, { sourceBranchId, deletedAt: null });
  }
}
