import { useMemo, useState } from "react";
import { he } from "date-fns/locale";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatHeDate } from "@/lib/date-format";
import { cn } from "@/lib/utils";

// value/onChange use "YYYY-MM-DD" (local) for date and "HH:MM" for time, matching the
// previous native inputs so call sites don't need to change shape.

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromYmd(s: string): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export function HebrewDateInput({
  value,
  onChange,
  placeholder = "בחר תאריך",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => fromYmd(value), [value]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          dir="rtl"
          lang="he"
          className={cn(
            "w-full justify-start text-right font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="ms-0 me-2 size-4 opacity-70" />
          {selected ? formatHeDate(selected) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" dir="rtl">
        <Calendar
          mode="single"
          locale={he}
          dir="rtl"
          selected={selected}
          onSelect={(d) => {
            if (d) {
              onChange(toLocalYmd(d));
              setOpen(false);
            } else {
              onChange("");
            }
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export function HebrewTimeInput({
  value,
  onChange,
  minuteStep = 5,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  minuteStep?: number;
  className?: string;
}) {
  const [hh, mm] = (value || "").split(":");
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = Array.from({ length: Math.floor(60 / minuteStep) }, (_, i) =>
    String(i * minuteStep).padStart(2, "0"),
  );
  const setPart = (h: string, m: string) => onChange(`${h}:${m}`);
  return (
    <div className={cn("flex items-center gap-2", className)} dir="ltr">
      <Clock className="size-4 opacity-70" />
      <Select
        value={hh || ""}
        onValueChange={(h) => setPart(h, mm || "00")}
      >
        <SelectTrigger lang="he" className="w-[5rem] text-center">
          <SelectValue placeholder="שעה" />
        </SelectTrigger>
        <SelectContent className="max-h-60">
          {hours.map((h) => (
            <SelectItem key={h} value={h}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">:</span>
      <Select
        value={mm || ""}
        onValueChange={(m) => setPart(hh || "00", m)}
      >
        <SelectTrigger lang="he" className="w-[5rem] text-center">
          <SelectValue placeholder="דקה" />
        </SelectTrigger>
        <SelectContent className="max-h-60">
          {minutes.map((m) => (
            <SelectItem key={m} value={m}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
