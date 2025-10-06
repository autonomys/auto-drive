export type Theme = "light" | "dark";

export const getStoredTheme = (): Theme | null => {
  try {
    const theme = localStorage.getItem("theme");
    if (theme === "light" || theme === "dark") return theme;
    return null;
  } catch {
    return null;
  }
};

export const setStoredTheme = (theme: Theme): void => {
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // ignore
  }
};

export const isSystemDark = (): boolean => {
  if (typeof window === "undefined") return false;
  return (
    !!window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
};

export const getEffectiveTheme = (): Theme => {
  const stored = getStoredTheme();
  if (stored) return stored;
  return isSystemDark() ? "dark" : "light";
};

export const applyTheme = (theme?: Theme | null): Theme => {
  const resolvedTheme = theme ?? getEffectiveTheme();
  const root = document.documentElement;
  if (resolvedTheme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  return resolvedTheme;
};

export const getNoFlashScript = (): string => {
  // Minified, self-contained script to set the initial theme class ASAP
  return "(()=>{try{var s=localStorage.getItem('theme');var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var d=s==='dark'||(s!=='light'&&m);var e=document.documentElement;e.classList[d?'add':'remove']('dark')}catch(e){}})();";
};

