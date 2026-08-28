import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PasswordVisibilityToggleProps = {
  visible: boolean;
  onToggle: () => void;
  className?: string;
};

export function PasswordVisibilityToggle({
  visible,
  onToggle,
  className,
}: PasswordVisibilityToggleProps) {
  const { t } = useTranslation();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground",
        className,
      )}
      onClick={onToggle}
      aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
      tabIndex={-1}
    >
      {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
    </Button>
  );
}

type PasswordInputProps = React.ComponentProps<typeof Input> & {
  visible: boolean;
};

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ visible, className, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={className}
        {...props}
      />
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
