/**
 * Company Service — business operations for the Companies module.
 *
 * Sits above `CompanyRepository` (Repository Layer) and below the UI. Uses
 * the existing Foundation exclusively: `getDatabaseClient()` for
 * persistence (in-memory today, Supabase-ready by contract) and
 * `getConfigurationManager()` for Company Settings, namespaced exactly like
 * `PlatformRuntimeService.getPlatformSetting`. No Supabase reference, no new
 * abstraction.
 */

import type { UUID } from "@/core";
import { getConfigurationManager, getDatabaseClient } from "@/core/bootstrap";
import { CompanyRepository } from "./company.repository";
import type { Company } from "./company.model";

export interface CompanyStatistics {
  totalCompaniesOnPlatform: number;
  createdAt: Date;
  updatedAt: Date;
  ageInDays: number;
}

export interface CompanyDashboardSnapshot {
  company: Company;
  statistics: CompanyStatistics;
}

export interface CompanyManagerEntry {
  id: UUID;
  name: string;
  email: string;
}

const MANAGERS_SETTING_KEY = "managers";

const companyRepository = new CompanyRepository(getDatabaseClient());

export class CompanyService {
  listCompanies(platformId: UUID): Promise<Company[]> {
    return companyRepository.findByPlatform(platformId);
  }

  getCompany(id: UUID): Promise<Company | null> {
    return companyRepository.findById(id);
  }

  createCompany(platformId: UUID, name: string): Promise<Company> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Company name is required.");
    }
    return companyRepository.create({ platformId, name: trimmed });
  }

  updateCompany(id: UUID, data: { name: string }): Promise<Company> {
    const trimmed = data.name.trim();
    if (!trimmed) {
      throw new Error("Company name is required.");
    }
    return companyRepository.update(id, { name: trimmed });
  }

  deleteCompany(id: UUID): Promise<void> {
    return companyRepository.softDelete(id);
  }

  restoreCompany(id: UUID): Promise<void> {
    return companyRepository.restore(id);
  }

  getCompanySetting<T>(companyId: UUID, key: string): T | undefined {
    return getConfigurationManager().get<T>(`company:${companyId}:${key}`);
  }

  setCompanySetting<T>(companyId: UUID, key: string, value: T): void {
    getConfigurationManager().set(`company:${companyId}:${key}`, value);
  }

  async getCompanyStatistics(company: Company): Promise<CompanyStatistics> {
    const siblings = await companyRepository.findByPlatform(company.platformId);
    const ageInDays = Math.max(
      0,
      Math.floor((Date.now() - company.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    );
    return {
      totalCompaniesOnPlatform: siblings.length,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      ageInDays,
    };
  }

  async getCompanyDashboard(company: Company): Promise<CompanyDashboardSnapshot> {
    const statistics = await this.getCompanyStatistics(company);
    return { company, statistics };
  }

  /**
   * Company Managers roster — a lightweight, honest list of names/emails
   * kept via the same Company Settings mechanism as every other setting
   * (see `getCompanySetting`/`setCompanySetting`). Not linked to any real
   * account: there is no Company-scoped user directory yet (see
   * `listCompanyUsers`'s doc comment).
   */
  listCompanyManagers(companyId: UUID): CompanyManagerEntry[] {
    return this.getCompanySetting<CompanyManagerEntry[]>(companyId, MANAGERS_SETTING_KEY) ?? [];
  }

  addCompanyManager(companyId: UUID, name: string, email: string): CompanyManagerEntry[] {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Manager name is required.");
    }
    const next: CompanyManagerEntry[] = [
      ...this.listCompanyManagers(companyId),
      { id: crypto.randomUUID() as UUID, name: trimmedName, email: email.trim() },
    ];
    this.setCompanySetting(companyId, MANAGERS_SETTING_KEY, next);
    return next;
  }

  removeCompanyManager(companyId: UUID, managerId: UUID): CompanyManagerEntry[] {
    const next = this.listCompanyManagers(companyId).filter((m) => m.id !== managerId);
    this.setCompanySetting(companyId, MANAGERS_SETTING_KEY, next);
    return next;
  }
}

export const companyService = new CompanyService();
