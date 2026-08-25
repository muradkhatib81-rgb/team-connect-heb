import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchablePickerOption = {
  id: string;
  label: string;
  sublabel?: string;
};

function searchValue(opt: SearchablePickerOption) {
  return `${opt.label} ${opt.sublabel ?? ""}`.trim();
}

type BaseProps = {
  options: SearchablePickerOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
};

export function SearchableSingleSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
}: BaseProps & {
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between gap-2 font-normal h-10"
        >
          <span className="truncate text-right flex-1">
            {selected ? (
              <>
                {selected.label}
                {selected.sublabel ? (
                  <span className="text-muted-foreground text-xs ms-1">({selected.sublabel})</span>
                ) : null}
              </>
            ) : (
              placeholder ?? t("common.select")
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        side="bottom"
        avoidCollisions={false}
        dir="rtl"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? t("common.searchPlaceholder")} />
          <CommandList className="max-h-[min(16rem,calc(100dvh-10rem))]">
            <CommandEmpty>{emptyText ?? t("common.noResults")}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.id}
                  value={searchValue(opt)}
                  onSelect={() => {
                    onChange(opt.id);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check className={cn("size-4 shrink-0", value === opt.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.sublabel ? (
                    <span className="text-xs text-muted-foreground shrink-0">{opt.sublabel}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SearchableMultiSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
}: BaseProps & {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => value.map((id) => options.find((o) => o.id === id)).filter(Boolean) as SearchablePickerOption[],
    [value, options],
  );

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  function remove(id: string) {
    onChange(value.filter((x) => x !== id));
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between gap-2 font-normal h-10"
          >
            <span className="truncate text-right flex-1">
              {selected.length
                ? t("common.selectedCount", { count: selected.length })
                : placeholder ?? t("common.selectMultiple")}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          side="bottom"
          avoidCollisions={false}
          dir="rtl"
        >
          <Command>
            <CommandInput placeholder={searchPlaceholder ?? t("common.searchPlaceholder")} />
            <CommandList className="max-h-[min(16rem,calc(100dvh-10rem))]">
              <CommandEmpty>{emptyText ?? t("common.noResults")}</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => {
                  const on = value.includes(opt.id);
                  return (
                    <CommandItem
                      key={opt.id}
                      value={searchValue(opt)}
                      onSelect={() => toggle(opt.id)}
                      className="gap-2"
                    >
                      <Check className={cn("size-4 shrink-0", on ? "opacity-100" : "opacity-0")} />
                      <span className="flex-1 truncate">{opt.label}</span>
                      {opt.sublabel ? (
                        <span className="text-xs text-muted-foreground shrink-0">{opt.sublabel}</span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((opt) => (
            <Badge key={opt.id} variant="secondary" className="gap-1 pe-1 max-w-full">
              <span className="truncate">{opt.label}</span>
              <button
                type="button"
                className="rounded-full hover:bg-muted p-0.5 shrink-0"
                onClick={() => remove(opt.id)}
                aria-label={t("common.remove")}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
