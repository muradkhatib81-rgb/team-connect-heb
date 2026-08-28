import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";

interface Props {
  title: string;
  icon: LucideIcon;
  description?: string;
}

export function SystemAdminPlaceholder({ title, icon: Icon, description }: Props) {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-12 rounded-xl gradient-brand flex items-center justify-center shadow-soft">
          <Icon className="size-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{t("systemAdminPlaceholder.subtitle")}</p>
        </div>
      </div>

      <Card className="p-8 text-center space-y-3">
        <div className="text-lg font-semibold">{t("systemAdminPlaceholder.readyTitle")}</div>
        <div className="text-sm text-muted-foreground">{t("systemAdminPlaceholder.readyDesc")}</div>
        {description && (
          <div className="text-xs text-muted-foreground pt-3 border-t border-border/60">
            {description}
          </div>
        )}
      </Card>
    </div>
  );
}
