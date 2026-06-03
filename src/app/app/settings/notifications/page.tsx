"use client";

import Link from "next/link";
import { WebNotificationSettings } from "@/components/WebNotificationSettings";
import { BuddyCalendarAuthGate } from "@/components/BuddyCalendarAuthGate";

export default function NotificationSettingsPage() {
  return (
    <BuddyCalendarAuthGate>
      {() => (
        <div
          style={{
            minHeight: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            padding: "var(--s4) var(--s3) calc(var(--s4) + env(safe-area-inset-bottom, 0px))",
            width: "100%",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "min(520px, calc(100vw - 32px))",
              display: "flex",
              flexDirection: "column",
              gap: "var(--s4)",
            }}
          >
            <Link
              href="/app?view=settings"
              style={{
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "11px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--fg-3)",
                textDecoration: "none",
              }}
            >
              ← Back to settings
            </Link>
            <h1
              style={{
                fontSize: "28px",
                fontWeight: 300,
                fontStyle: "italic",
                margin: 0,
                color: "var(--fg)",
              }}
            >
              Notifications
            </h1>
            <WebNotificationSettings pageMode />
          </div>
        </div>
      )}
    </BuddyCalendarAuthGate>
  );
}
