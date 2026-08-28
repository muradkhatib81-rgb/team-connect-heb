import * as React from "react";

import { cn } from "@/lib/utils";
import { isNumericLikeInput, toWesternDigits } from "@/lib/app-locale";

function normalizeNumericInputValue(target: HTMLInputElement): void {
  if (!isNumericLikeInput(target)) return;
  const normalized = toWesternDigits(target.value);
  if (normalized !== target.value) {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    target.value = normalized;
    if (start != null && end != null) {
      target.setSelectionRange(start, end);
    }
  }
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onChange, onInput, ...props }, ref) => {
    const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
      normalizeNumericInputValue(e.currentTarget);
      onInput?.(e);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      normalizeNumericInputValue(e.currentTarget);
      onChange?.(e);
    };

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onInput={handleInput}
        onChange={handleChange}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
