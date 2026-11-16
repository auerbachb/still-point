"use client";

import { useEffect } from "react";
import { subscribeThemeSync } from "@/lib/themeSync";

/** Keeps <html data-theme> in step with the saved choice on every screen (#29). */
export function ThemeSync() {
  useEffect(() => subscribeThemeSync(window, document.documentElement), []);
  return null;
}
