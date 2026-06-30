import { useMemo, useState } from "react";
import { Building2, Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useActiveBranch } from "@/lib/use-active-branch";

/**
 * Branch selector for the System Administrator.
 * Hidden for every other role (they are locked to their own branch).
 */
export function BranchSwitcher({ className }: { className?: string }) {
  const { canSwitch, activeBranch, branches, setActiveBranchId, activeBranchId } =
    useActiveBranch();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.code ?? "").toLowerCase().includes(q),
    );
  }, [branches, query]);

  if (!canSwitch || !activeBranch) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-2 max-w-[220px]", className)}
          aria-label="בחר סניף פעיל"
        >
          <Building2 className="size-4 text-primary shrink-0" />
          <span className="truncate text-sm font-medium">{activeBranch.name}</span>
          <ChevronDown className="size-4 opacity-60 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש סניף..."
              className="pr-8 h-9"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              לא נמצאו סניפים
            </p>
          ) : (
            filtered.map((b) => {
              const active = b.id === activeBranchId;
              return (
                <button
                  key={b.id}
                  onClick={() => {
                    setActiveBranchId(b.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-right",
                    active && "bg-accent/60 font-medium",
                    !b.is_active && "opacity-60",
                  )}
                >
                  <Building2 className="size-4 text-primary shrink-0" />
                  <span className="flex-1 truncate">{b.name}</span>
                  {!b.is_active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      מושבת
                    </span>
                  )}
                  {active && <Check className="size-4 text-primary shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Compact, read-only badge shown in the page header so every page shows the active branch. */
export function ActiveBranchBadge({ className }: { className?: string }) {
  const { activeBranch } = useActiveBranch();
  if (!activeBranch) return null;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium",
        className,
      )}
    >
      <Building2 className="size-3.5" />
      <span className="truncate max-w-[180px]">{activeBranch.name}</span>
    </div>
  );
}
