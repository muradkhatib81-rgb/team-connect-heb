import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type EmployeeListSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  id?: string;
};

/** Shared name / national-ID filter field for long employee lists. */
export function EmployeeListSearch({
  value,
  onChange,
  placeholder,
  className,
  id,
}: EmployeeListSearchProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={placeholder}
        className="pr-10"
      />
    </div>
  );
}
