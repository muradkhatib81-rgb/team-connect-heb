import { forwardRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 24-hour time input (HH:mm) that never shows AM/PM.
 *
 * Uses a masked text input rather than `<input type="time">` because native
 * time pickers follow the OS locale — Chrome/Safari on en-US OS renders a
 * 12-hour picker with AM/PM even when `lang="he-IL"` is set. This component
 * guarantees 24h display and parsing on every browser / OS.
 */
export type Time24InputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  value: string | null | undefined; // "HH:MM" or "HH:MM:SS"
  onChange: (value: string) => void; // emits "HH:MM" or ""
};

function normalize(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function clampHHMM(v: string): string {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(v);
  if (!m) return v;
  let h = Math.min(23, Math.max(0, Number(m[1])));
  let mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export const Time24Input = forwardRef<HTMLInputElement, Time24InputProps>(
  ({ value, onChange, className, ...rest }, ref) => {
    const initial = value ? String(value).slice(0, 5) : "";
    const [text, setText] = useState(initial);

    useEffect(() => {
      setText(value ? String(value).slice(0, 5) : "");
    }, [value]);

    return (
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        pattern="[0-2][0-9]:[0-5][0-9]"
        placeholder="HH:MM"
        maxLength={5}
        dir="ltr"
        value={text}
        onChange={(e) => {
          const next = normalize(e.target.value);
          setText(next);
          if (/^\d{2}:\d{2}$/.test(next)) {
            const clamped = clampHHMM(next);
            onChange(clamped);
          } else if (next === "") {
            onChange("");
          }
        }}
        onBlur={(e) => {
          const m = /^(\d{1,2}):?(\d{0,2})$/.exec(text);
          if (!m) {
            if (text === "") onChange("");
            rest.onBlur?.(e);
            return;
          }
          const h = m[1].padStart(2, "0");
          const mm = (m[2] || "00").padStart(2, "0");
          const clamped = clampHHMM(`${h}:${mm}`);
          setText(clamped);
          onChange(clamped);
          rest.onBlur?.(e);
        }}
        className={cn("tabular-nums", className)}
      />
    );
  },
);
Time24Input.displayName = "Time24Input";
