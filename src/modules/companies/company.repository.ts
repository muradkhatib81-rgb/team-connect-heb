import { BaseRepository, type IDatabaseClient, type IRepository, type UUID } from "@/core";
import type { Company } from "./company.model";

export interface ICompanyRepository extends IRepository<Company> {
  findByPlatform(platformId: UUID): Promise<Company[]>;
}

export class CompanyRepository extends BaseRepository<Company> implements ICompanyRepository {
  constructor(db: IDatabaseClient) {
    super(db, "companies");
  }

  /** All non-deleted Companies belonging to a given Platform. */
  findByPlatform(platformId: UUID): Promise<Company[]> {
    return this.db.findMany<Company>(this.tableName, { platformId, deletedAt: null });
  }
}
