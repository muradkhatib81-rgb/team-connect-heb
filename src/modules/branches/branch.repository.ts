import { BaseRepository, type IDatabaseClient, type IRepository } from "@/core";
import type { Branch } from "./branch.model";

export type IBranchRepository = IRepository<Branch>;

export class BranchRepository extends BaseRepository<Branch> implements IBranchRepository {
  constructor(db: IDatabaseClient) {
    super(db, "branches");
  }
}
