"use client";

import { AppSubpageShell } from "@/components/AppSubpageShell";
import { BuddyCalendarAuthGate } from "@/components/BuddyCalendarAuthGate";
import { BuddyCalendarView } from "@/components/BuddyCalendarView";

export default function BuddyUnifiedCalendarPage() {
  return (
    <BuddyCalendarAuthGate>
      {(user) => (
        <AppSubpageShell title="Buddy calendar" backHref="/app" backLabel="Back to app">
          <BuddyCalendarView mode="unified" viewerUserId={user.id} />
        </AppSubpageShell>
      )}
    </BuddyCalendarAuthGate>
  );
}
