import { useState, useEffect } from "react";

/**
 * Custom hook to manage the application UI theme (light, dark, system).
 * Automatically updates document classes when the theme changes.
 */
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("dark");

  useEffect(() => {
    const root = window.document.documentElement;
    const applyTheme = (t: "light" | "dark") => {
      root.classList.remove("light", "dark", "bp6-dark");
      root.classList.add(t);
      if (t === "dark") root.classList.add("bp6-dark");
    };

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      applyTheme(systemTheme);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  return { theme, setTheme };
}
