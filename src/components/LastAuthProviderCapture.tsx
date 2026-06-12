"use client";

import { useEffect } from "react";
import { isOAuthProvider, saveLastAuthProvider } from "@/lib/lastAuthProvider";

/** The oauth-complete bridge appends ?auth_provider=... only after a
 *  successful OAuth login (#337). Its `return` target can be any
 *  same-origin path (deep links, subroutes), so this capture lives in
 *  the root layout rather than the /app page: wherever the redirect
 *  lands, persist the provider as the "last used" method and strip the
 *  param so reloads/shared links don't carry it. */
export function LastAuthProviderCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("auth_provider");
    if (provider === null) return;
    if (isOAuthProvider(provider)) {
      saveLastAuthProvider(provider);
    }
    params.delete("auth_provider");
    const next = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
  }, []);

  return null;
}
