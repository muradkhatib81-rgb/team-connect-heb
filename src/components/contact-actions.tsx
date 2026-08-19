import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toTelUrl, toWhatsAppUrl } from "@/lib/whatsapp";
import { WhatsAppIcon } from "@/components/whatsapp-icon";

type ContactActionsProps = {
  phone: string | null | undefined;
  size?: "sm" | "default" | "icon";
  className?: string;
  /** Hide button labels on narrow layouts (icons only). */
  compact?: boolean;
};

/**
 * Call + WhatsApp shortcuts for a phone already visible to the current user.
 * Renders nothing when the number is missing or cannot be dialed.
 */
export function ContactActions({
  phone,
  size = "sm",
  className,
  compact = false,
}: ContactActionsProps) {
  const tel = toTelUrl(phone);
  const wa = toWhatsAppUrl(phone);
  if (!tel && !wa) return null;

  if (size === "icon") {
    return (
      <div className={`flex items-center gap-1 ${className ?? ""}`}>
        {tel && (
          <Button asChild variant="ghost" size="icon" className="size-8 shrink-0" aria-label="התקשרות">
            <a href={tel}>
              <Phone className="size-4" />
            </a>
          </Button>
        )}
        {wa && (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-green-700 hover:text-green-800"
            aria-label="WhatsApp"
          >
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon className="size-4" />
            </a>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
      {tel && (
        <Button asChild variant="outline" size={size} className="gap-1.5">
          <a href={tel}>
            <Phone className="size-4" />
            {!compact && "התקשרות"}
          </a>
        </Button>
      )}
      {wa && (
        <Button
          asChild
          variant="outline"
          size={size}
          className="gap-1.5 text-green-700 hover:text-green-800 border-green-200 hover:bg-green-50 dark:hover:bg-green-950/20"
        >
          <a href={wa} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon className="size-4" />
            {!compact && "WhatsApp"}
          </a>
        </Button>
      )}
    </div>
  );
}

export function ProfilePhoneField({
  label,
  phone,
}: {
  label: string;
  phone: string | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="min-w-0 sm:text-right">
        <span className="text-sm font-medium" dir="ltr">
          {phone?.trim() || "—"}
        </span>
        <ContactActions phone={phone} className="mt-2 sm:justify-end" />
      </div>
    </div>
  );
}
