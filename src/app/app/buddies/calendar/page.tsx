"use client";

import { useEffect, useState } from "react";
import { AppSubpageShell } from "@/components/AppSubpageShell";
import { BuddyCalendarView } from "@/components/BuddyCalendarView";
import { AuthScreen } from "@/components/AuthScreen";
import { api, type User } from "@/lib/api";

export default function BuddyUnifiedCalendarPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) {
          setUser(data?.user ?? null);
          setAuthChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fg-4)",
        }}
      >
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div
        style={{
          minHeight: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 20px",
        }}
      >
        <AuthScreen onLogin={setUser} />
      </div>
    );
  }

  return (
    <AppSubpageShell title="Buddy calendar" backHref="/app" backLabel="Back to app">
      <BuddyCalendarView mode="unified" viewerUserId={user.id} />
    </AppSubpageShell>
  );
}
