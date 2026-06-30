"use client";

import { useState, useEffect } from "react";

function getIsMobile() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 600px)").matches;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(getIsMobile);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 600px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isMobile;
}
