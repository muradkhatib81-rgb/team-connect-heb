import * as React from "react";

import { cn } from "@/lib/utils";
import { normalizeWesternDigitsInField } from "@/lib/app-locale";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onChange, onInput, ...props }, ref) => {
    const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
      normalizeWesternDigitsInField(e.currentTarget);
      onInput?.(e);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      normalizeWesternDigitsInField(e.currentTarget);
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
