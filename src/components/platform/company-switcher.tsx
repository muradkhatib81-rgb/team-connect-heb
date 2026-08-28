import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UUID } from "@/core";
import { useCompanyContext } from "@/platform";

/** Active-Company switcher. Renders nothing until at least one Company exists. */
export function CompanySwitcher() {
  const { t } = useTranslation();
  const { companies, activeCompanyId, setActiveCompanyId, isLoading } = useCompanyContext();

  if (isLoading || companies.length === 0) return null;

  return (
    <Select
      value={activeCompanyId ?? undefined}
      onValueChange={(v) => setActiveCompanyId(v as UUID)}
    >
      <SelectTrigger className="w-full sm:w-64 gap-2">
        <Building2 className="size-4 text-muted-foreground shrink-0" />
        <SelectValue placeholder={t("platformCompanies.selectActiveCompany")} />
      </SelectTrigger>
      <SelectContent>
        {companies.map((company) => (
          <SelectItem key={company.id} value={company.id}>
            {company.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
