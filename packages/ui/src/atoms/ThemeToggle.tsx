import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, getStoredTheme, setStoredTheme, type Theme } from "../utils/theme.js";
import { cn } from "../utils/index.js";

export type ThemeToggleProps = {
  className?: string;
  size?: number;
};

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className, size = 16 }) => {
  const [theme, setTheme] = React.useState<Theme | null>(null);

  React.useEffect(() => {
    const effective = applyTheme();
    setTheme(effective);
  }, []);

  const toggle = React.useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setStoredTheme(next);
    applyTheme(next);
    setTheme(next);
  }, [theme]);

  return (
    <button
      aria-label="Toggle theme"
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-input bg-background px-2 py-1 text-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
        className
      )}
      onClick={toggle}
      type="button"
    >
      {theme === "dark" ? <Moon size={size} /> : <Sun size={size} />}
    </button>
  );
};

