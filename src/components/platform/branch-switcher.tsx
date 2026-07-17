import { GitBranch } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBranchContext } from "@/platform";

/**
 * Active-Branch switcher for the Platform's Branches module, scoped to the
 * active Company. Renders nothing until that Company has at least one
 * Branch. Named `PlatformBranchSwitcher` (rather than `BranchSwitcher`) to
 * avoid any confusion with the existing single-tenant `BranchSwitcher` in
 * `@/components/branch-switcher`, which is unrelated and untouched.
 */
export function PlatformBranchSwitcher() {
  const { branches, activeBranchId, setActiveBranchId, isLoading } = useBranchContext();

  if (isLoading || branches.length === 0) return null;

  return (
    <Select
      value={activeBranchId ?? undefined}
      onValueChange={(v) => {
        const branch = branches.find((b) => b.id === v);
        if (branch) setActiveBranchId(branch);
      }}
    >
      <SelectTrigger className="w-full sm:w-64 gap-2">
        <GitBranch className="size-4 text-muted-foreground shrink-0" />
        <SelectValue placeholder="בחירת סניף פעיל" />
      </SelectTrigger>
      <SelectContent>
        {branches.map((branch) => (
          <SelectItem key={branch.id} value={branch.id}>
            {branch.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
