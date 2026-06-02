"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@/lib/api";

/** Auth bootstrap for buddy calendar subpages (matches `/app` 5xx vs 401 handling). */
export function useBuddyCalendarAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRetryKey, setAuthRetryKey] = useState(0);

  const retryAuth = useCallback(() => {
    setAuthChecked(false);
    setAuthError(null);
    setAuthRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          setUser(data?.user ?? null);
          setAuthError(null);
          setAuthChecked(true);
          return;
        }

        if (res.status === 401 || res.status === 403) {
          setUser(null);
          setAuthError(null);
          setAuthChecked(true);
          return;
        }

        if (res.status >= 500) {
          setAuthError("Unable to verify your sign-in due to a server issue. Please retry.");
          setAuthChecked(true);
          return;
        }

        setUser(null);
        setAuthError(null);
        setAuthChecked(true);
      } catch {
        if (!cancelled) {
          setAuthError("Unable to verify your sign-in due to a network issue. Please retry.");
          setAuthChecked(true);
        }
      }
    }

    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, [authRetryKey]);

  return { user, setUser, authChecked, authError, retryAuth };
}
