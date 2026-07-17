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

import type { BaseEntity, UUID } from "@/core";
import { getConfigurationManager, getDatabaseClient } from "@/core/bootstrap";
import { CompanyRepository, type ICompanyRepository } from "./company.repository";
import {
  DEFAULT_COMPANY_CURRENCY,
  DEFAULT_COMPANY_LANGUAGE,
  DEFAULT_COMPANY_TIME_ZONE,
  type Company,
  type CompanyStatus,
} from "./company.model";

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

/** Editable Company fields — every field from Part 1's spec, all optional so partial edits/creates work. */
export interface CompanyEditableFields {
  name?: string;
  logoUrl?: string | null;
  companyCode?: string | null;
  legalName?: string | null;
  taxNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  currency?: string;
  language?: string;
  timeZone?: string;
}

const MANAGERS_SETTING_KEY = "managers";

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export class CompanyService {
  constructor(
    private readonly repository: ICompanyRepository = new CompanyRepository(getDatabaseClient()),
  ) {}

  listCompanies(platformId: UUID): Promise<Company[]> {
    return this.repository.findByPlatform(platformId);
  }

  getCompany(id: UUID): Promise<Company | null> {
    return this.repository.findById(id);
  }

  createCompany(
    platformId: UUID,
    data: CompanyEditableFields & { name: string },
  ): Promise<Company> {
    const trimmed = data.name.trim();
    if (!trimmed) {
      throw new Error("Company name is required.");
    }
    return this.repository.create({
      platformId,
      name: trimmed,
      status: "active",
      archivedAt: null,
      logoUrl: normalizeOptionalText(data.logoUrl),
      companyCode: normalizeOptionalText(data.companyCode),
      legalName: normalizeOptionalText(data.legalName),
      taxNumber: normalizeOptionalText(data.taxNumber),
      phone: normalizeOptionalText(data.phone),
      email: normalizeOptionalText(data.email),
      address: normalizeOptionalText(data.address),
      currency: data.currency?.trim() || DEFAULT_COMPANY_CURRENCY,
      language: data.language?.trim() || DEFAULT_COMPANY_LANGUAGE,
      timeZone: data.timeZone?.trim() || DEFAULT_COMPANY_TIME_ZONE,
    });
  }

  updateCompany(id: UUID, data: CompanyEditableFields): Promise<Company> {
    const patch: Partial<Omit<Company, keyof BaseEntity>> = {};
    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (!trimmed) throw new Error("Company name is required.");
      patch.name = trimmed;
    }
    if (data.logoUrl !== undefined) patch.logoUrl = normalizeOptionalText(data.logoUrl);
    if (data.companyCode !== undefined) patch.companyCode = normalizeOptionalText(data.companyCode);
    if (data.legalName !== undefined) patch.legalName = normalizeOptionalText(data.legalName);
    if (data.taxNumber !== undefined) patch.taxNumber = normalizeOptionalText(data.taxNumber);
    if (data.phone !== undefined) patch.phone = normalizeOptionalText(data.phone);
    if (data.email !== undefined) patch.email = normalizeOptionalText(data.email);
    if (data.address !== undefined) patch.address = normalizeOptionalText(data.address);
    if (data.currency !== undefined)
      patch.currency = data.currency.trim() || DEFAULT_COMPANY_CURRENCY;
    if (data.language !== undefined)
      patch.language = data.language.trim() || DEFAULT_COMPANY_LANGUAGE;
    if (data.timeZone !== undefined)
      patch.timeZone = data.timeZone.trim() || DEFAULT_COMPANY_TIME_ZONE;
    return this.repository.update(id, patch);
  }

  setCompanyStatus(id: UUID, status: CompanyStatus): Promise<Company> {
    return this.repository.update(id, { status });
  }

  archiveCompany(id: UUID): Promise<Company> {
    return this.repository.update(id, { archivedAt: new Date() });
  }

  unarchiveCompany(id: UUID): Promise<Company> {
    return this.repository.update(id, { archivedAt: null });
  }

  deleteCompany(id: UUID): Promise<void> {
    return this.repository.softDelete(id);
  }

  restoreCompany(id: UUID): Promise<void> {
    return this.repository.restore(id);
  }

  getCompanySetting<T>(companyId: UUID, key: string): T | undefined {
    return getConfigurationManager().get<T>(`company:${companyId}:${key}`);
  }

  setCompanySetting<T>(companyId: UUID, key: string, value: T): void {
    getConfigurationManager().set(`company:${companyId}:${key}`, value);
  }

  async getCompanyStatistics(company: Company): Promise<CompanyStatistics> {
    const siblings = await this.repository.findByPlatform(company.platformId);
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
