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
}
