import { BaseRepository, type IDatabaseClient, type IRepository } from "@/core";
import type { Company } from "./company.model";

export type ICompanyRepository = IRepository<Company>;

export class CompanyRepository extends BaseRepository<Company> implements ICompanyRepository {
  constructor(db: IDatabaseClient) {
    super(db, "companies");
  }
}
