import { BaseRepository, type IDatabaseClient, type IRepository, type UUID } from "@/core";
import type { Company } from "./company.model";

export type ICompanyRepository = IRepository<Company>;

export class CompanyRepository extends BaseRepository<Company> implements ICompanyRepository {
  constructor(db: IDatabaseClient) {
    super(db, "companies");
  }

  /** All non-deleted Companies belonging to a given Platform. */
  async findByPlatform(platformId: UUID): Promise<Company[]> {
    const all = await this.findAll();
    return all.filter((company) => company.platformId === platformId);
  }
}
