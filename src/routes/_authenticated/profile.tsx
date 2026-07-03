import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound, User } from "lucide-react";
import { ROLE_LABELS, isPlatformOwner } from "@/lib/constants";
import { EmployeeOfMonthSection } from "@/components/employee-of-month-section";


export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { data: me, isLoading } = useAuth();

  if (isLoading || !me) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const roleLabel = me.roles?.[0] ? ROLE_LABELS[me.roles[0]] : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <User className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">הפרופיל שלי</h1>
          <p className="text-sm text-muted-foreground">פרטי החשבון האישי שלך</p>
        </div>
      </div>

      <Card className="p-6 space-y-4">
        <Row label="שם מלא" value={me.full_name ?? "—"} />
        <Row label="מספר זהות" value={me.id_number ?? "—"} />
        <Row label="טלפון" value={me.phone ?? "—"} />
        {!isPlatformOwner(me.roles) && <Row label="מחלקה" value={me.department_name ?? "—"} />}
        <Row label="תפקיד" value={roleLabel} />
      </Card>

      <Card className="p-6 flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">סיסמה</p>
          <p className="text-sm text-muted-foreground">החלפת סיסמה אישית</p>
        </div>
        <Button asChild variant="outline" className="gap-2">
          <Link to="/change-password">
            <KeyRound className="size-4" />
            החלפת סיסמה
          </Link>
        </Button>
      </Card>

      <EmployeeOfMonthSection />
    </div>
  );
}


function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
