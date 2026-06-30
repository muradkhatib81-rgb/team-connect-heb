import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

interface Props {
  title: string;
  icon: LucideIcon;
  description?: string;
}

export function SystemAdminPlaceholder({ title, icon: Icon, description }: Props) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-12 rounded-xl gradient-brand flex items-center justify-center shadow-soft">
          <Icon className="size-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">ניהול מערכת · מנהל מערכת ראשי</p>
        </div>
      </div>

      <Card className="p-8 text-center space-y-3">
        <div className="text-lg font-semibold">המודול מוכן לפיתוח</div>
        <div className="text-sm text-muted-foreground">This module is ready for implementation.</div>
        {description && (
          <div className="text-xs text-muted-foreground pt-3 border-t border-border/60">
            {description}
          </div>
        )}
      </Card>
    </div>
  );
}
