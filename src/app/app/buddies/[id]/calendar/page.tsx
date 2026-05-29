"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppSubpageShell } from "@/components/AppSubpageShell";
import { BuddyCalendarAuthGate } from "@/components/BuddyCalendarAuthGate";
import { BuddyCalendarView } from "@/components/BuddyCalendarView";
import { api, ApiError } from "@/lib/api";

function PerBuddyCalendarContent({
  buddyId,
  userId,
}: {
  buddyId: string;
  userId: string;
}) {
  const [buddyUsername, setBuddyUsername] = useState<string | null>(null);
  const [buddyLookupError, setBuddyLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (!buddyId) return;
    let cancelled = false;
    setBuddyLookupError(null);

    api
      .getFriends()
      .then(({ friends }) => {
        if (cancelled) return;
        const friend = friends.find((f) => f.id === buddyId);
        setBuddyUsername(friend?.username ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setBuddyUsername(null);
        setBuddyLookupError(
          e instanceof ApiError ? e.message : "Could not load buddy name.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [buddyId, userId]);

  const title = buddyUsername
    ? `Calendar with ${buddyUsername}`
    : "Buddy calendar";

  return (
    <AppSubpageShell
      title={title}
      backHref="/app/buddies/calendar"
      backLabel="All buddy sits"
    >
      {buddyLookupError && (
        <p
          role="status"
          style={{
            margin: "0 0 12px",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--fg-3)",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          }}
        >
          {buddyLookupError}
        </p>
      )}
      <BuddyCalendarView
        mode="perBuddy"
        buddyId={buddyId}
        buddyUsername={buddyUsername ?? undefined}
        viewerUserId={userId}
      />
    </AppSubpageShell>
  );
}

export default function BuddyPerBuddyCalendarPage() {
  const params = useParams();
  const buddyId = typeof params.id === "string" ? params.id : "";

  return (
    <BuddyCalendarAuthGate>
      {(user) => <PerBuddyCalendarContent buddyId={buddyId} userId={user.id} />}
    </BuddyCalendarAuthGate>
  );
}
