import { useCallback, useEffect, useState } from "react";
/** "full": icons and labels (240px). "rail": icons only (80px), labels in tooltips. */
export type NavMode = "full" | "rail";
const KEY = "erad-nav";
/** Below 1280px the default is the rail, so the page reflows at 400% zoom (WCAG 1.4.10). */
export function defaultNavMode(width: number): NavMode {
  return width >= 1280 ? "full" : "rail";
}
export function parseNavMode(v: string | null): NavMode | null {
  return v === "full" || v === "rail" ? v : null;
}
/** EDS local navigation: people can show or hide it; the choice is kept per browser. */
export function useNavMode() {
  const [mode, setMode] = useState<NavMode>("full");
  useEffect(() => {
    setMode(parseNavMode(localStorage.getItem(KEY)) ?? defaultNavMode(window.innerWidth));
  }, []);
  const toggle = useCallback(() => {
    setMode((m) => {
      const next: NavMode = m === "full" ? "rail" : "full";
      localStorage.setItem(KEY, next);
      return next;
    });
  }, []);
  return { mode, toggle };
}
