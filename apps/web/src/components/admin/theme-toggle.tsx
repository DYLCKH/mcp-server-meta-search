import { Laptop, Moon, Sun } from "lucide-react";

import { useTheme, type Theme } from "@/components/admin/theme-provider";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{
  value: Theme;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "system", label: "System", icon: Laptop },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-background p-0.5 shadow-sm",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={active}
            aria-label={option.label}
            title={option.label}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
