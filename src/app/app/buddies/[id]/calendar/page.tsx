"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppSubpageShell } from "@/components/AppSubpageShell";
import { BuddyCalendarView } from "@/components/BuddyCalendarView";
import { AuthScreen } from "@/components/AuthScreen";
import { api, type User } from "@/lib/api";

export default function BuddyPerBuddyCalendarPage() {
  const params = useParams();
  const buddyId = typeof params.id === "string" ? params.id : "";
  const [user, setUser] = useState<User | null>(null);
  const [buddyUsername, setBuddyUsername] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) {
          if (!cancelled) {
            setUser(null);
            setAuthChecked(true);
          }
          return;
        }
        const meData = await meRes.json();
        if (cancelled) return;
        setUser(meData.user ?? null);

        if (buddyId && meData.user) {
          const { friends } = await api.getFriends();
          const friend = friends.find((f) => f.id === buddyId);
          if (!cancelled) setBuddyUsername(friend?.username ?? null);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [buddyId]);

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

  const title = buddyUsername
    ? `Calendar with ${buddyUsername}`
    : "Buddy calendar";

  return (
    <AppSubpageShell
      title={title}
      backHref="/app/buddies/calendar"
      backLabel="All buddy sits"
    >
      <BuddyCalendarView
        mode="perBuddy"
        buddyId={buddyId}
        buddyUsername={buddyUsername ?? undefined}
        viewerUserId={user.id}
      />
    </AppSubpageShell>
  );
}
