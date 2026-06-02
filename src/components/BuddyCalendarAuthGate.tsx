"use client";

import type { ReactNode } from "react";
import { AuthScreen } from "@/components/AuthScreen";
import { useBuddyCalendarAuth } from "@/lib/useBuddyCalendarAuth";
import type { User } from "@/lib/api";

type BuddyCalendarAuthGateProps = {
  children: (user: User) => ReactNode;
};

export function BuddyCalendarAuthGate({ children }: BuddyCalendarAuthGateProps) {
  const { user, setUser, authChecked, authError, retryAuth } = useBuddyCalendarAuth();

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

  if (authError) {
    return (
      <div
        style={{
          minHeight: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--s3)",
          padding: "40px 20px",
          textAlign: "center",
        }}
      >
        <p style={{ maxWidth: "44ch", color: "var(--fg-2)", lineHeight: 1.5 }}>{authError}</p>
        <button
          type="button"
          onClick={retryAuth}
          style={{
            border: "1px solid var(--border-2)",
            background: "transparent",
            color: "var(--fg)",
            borderRadius: "999px",
            padding: "10px 16px",
            cursor: "pointer",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "12px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Retry
        </button>
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

  return <>{children(user)}</>;
}
