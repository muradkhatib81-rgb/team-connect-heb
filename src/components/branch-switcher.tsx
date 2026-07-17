import { useMemo, useState } from "react";
import { Building2, Check, ChevronDown, MapPin, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useActiveBranch } from "@/lib/use-active-branch";

/**
 * Active-branch badge with switcher behaviour.
 *
 * - Platform Owners (system_admin / main_admin) see a clickable badge that
 *   opens a searchable dropdown of every Branch (name, code, address,
 *   current indicator). Since Platform Owners are never dropped into a
 *   Branch automatically, the badge renders even with no Branch selected
 *   yet — it is the explicit action that enters Branch Mode.
 * - Non-owners (branch managers, employees…) always see the read-only
 *   badge — they are locked to their assigned branch.
 *
 * Selecting a branch updates the active id (persisted in localStorage by
 * the provider) and triggers a global query invalidation so every module
 * refetches under the new branch context.
 */

function BadgeShell({
  children,
  asButton,
  className,
  ...rest
}: {
  children: React.ReactNode;
  asButton?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium shadow-sm border border-primary/15";
  if (asButton) {
    return (
      <button
        type="button"
        className={cn(
          base,
          "hover:bg-primary/15 active:scale-[0.98] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  }
  return <div className={cn(base, className)}>{children}</div>;
}

function BadgeContent({ name }: { name: string }) {
  return (
    <>
      <Building2 className="size-3.5 shrink-0" />
      <span className="truncate max-w-[200px]">{name}</span>
    </>
  );
}

/**
 * Primary branch indicator + switcher. Render once in the page chrome.
 * The legacy `ActiveBranchBadge` (read-only) is now an alias of this
 * component so existing layouts keep working without duplication.
 */
export function BranchSwitcher({ className }: { className?: string }) {
  const { activeBranch, branches, activeBranchId, setActiveBranchId, canSwitch } =
    useActiveBranch();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = branches.filter((b) => b.is_active || b.id === activeBranchId);
    if (!q) return list;
    return list.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.code ?? "").toLowerCase().includes(q) ||
        (b.address ?? "").toLowerCase().includes(q),
    );
  }, [branches, query, activeBranchId]);

  // Read-only badge (non-owner, locked to their own branch).
  if (!canSwitch) {
    if (!activeBranch) return null;
    return (
      <BadgeShell className={className}>
        <BadgeContent name={activeBranch.name} />
      </BadgeShell>
    );
  }

  // Platform Owner: always render the picker, even with no Branch selected
  // yet — this badge is the explicit action that enters Branch Mode.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <BadgeShell asButton aria-label="בחר סניף פעיל" className={className}>
          <BadgeContent name={activeBranch?.name ?? "בחירת סניף"} />
          <ChevronDown
            className={cn(
              "size-3.5 opacity-70 shrink-0 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </BadgeShell>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-0 overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      >
        <div className="p-2 border-b bg-muted/40">
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש סניף..."
              className="pr-9 h-9 bg-background"
            />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">לא נמצאו סניפים</p>
          ) : (
            filtered.map((b) => {
              const active = b.id === activeBranchId;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setActiveBranchId(b.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "w-full flex items-start gap-2.5 px-3 py-2.5 text-sm hover:bg-accent transition-colors text-right border-b last:border-b-0 border-border/40",
                    active && "bg-primary/5",
                  )}
                >
                  <Building2
                    className={cn(
                      "size-4 mt-0.5 shrink-0",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate",
                          active ? "font-semibold text-primary" : "font-medium",
                        )}
                      >
                        {b.name}
                      </span>
                      {b.code && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
                          {b.code}
                        </span>
                      )}
                    </div>
                    {b.address && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <MapPin className="size-3 shrink-0" />
                        <span className="truncate">{b.address}</span>
                      </div>
                    )}
                  </div>
                  {active && <Check className="size-4 text-primary shrink-0 mt-0.5" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Legacy alias kept so existing layouts that import `ActiveBranchBadge`
 * keep working. Returns null because `BranchSwitcher` now renders the
 * badge itself — avoids showing the active branch twice in the chrome.
 */
export function ActiveBranchBadge(_props: { className?: string }) {
  return null;
}
