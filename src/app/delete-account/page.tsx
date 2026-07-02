"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DeleteAccountSection } from "@/components/DeleteAccountSection";
import { ApiError, api, type User } from "@/lib/api";

export default function DeleteAccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadUser = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await api.me();
        if (cancelled) return;
        setUser(data.user);
      } catch (err) {
        if (cancelled) return;

        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setUser(null);
        } else {
          setError("Unable to verify your sign-in right now. Please retry.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadUser();

    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-serif)",
          color: "var(--fg-3)",
          fontSize: "22px",
          fontStyle: "italic",
        }}
      >
        Still Point
      </main>
    );
  }

  if (error) {
    return (
      <main
        style={{
          minHeight: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "14px",
          padding: "24px",
          textAlign: "center",
          fontFamily: "var(--font-serif)",
        }}
      >
        <p style={{ margin: 0, color: "var(--fg-2)", maxWidth: "40ch", lineHeight: 1.5 }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => setRetryKey((value) => value + 1)}
          style={{
            border: "1px solid var(--border-2)",
            background: "transparent",
            color: "var(--fg)",
            borderRadius: "999px",
            padding: "10px 14px",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Retry
        </button>
      </main>
    );
  }

  if (!user) {
    return (
      <main
        style={{
          minHeight: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "24px",
          textAlign: "center",
          fontFamily: "var(--font-serif)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "32px", fontStyle: "italic", fontWeight: 300 }}>
          Delete account
        </h1>
        <p style={{ margin: 0, color: "var(--fg-2)", maxWidth: "44ch", lineHeight: 1.5 }}>
          Sign in to continue with permanent account deletion.
        </p>
        <Link
          href="/app"
          style={{
            border: "1px solid var(--border-2)",
            borderRadius: "999px",
            padding: "10px 16px",
            color: "var(--fg)",
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontSize: "11px",
          }}
        >
          Go to sign in
        </Link>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "24px",
        padding: "24px",
        fontFamily: "var(--font-serif)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "min(520px, calc(100vw - 24px))",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "36px", fontWeight: 300, fontStyle: "italic" }}>
          Delete your account
        </h1>
        <p style={{ margin: 0, color: "var(--fg-2)", lineHeight: 1.5 }}>
          This page provides direct web access to Still Point account deletion.
        </p>
        <DeleteAccountSection
          onDeleted={async () => {
            try {
              await api.logout();
            } catch {
              // Best effort only; account deletion already invalidates auth.
            }
            window.location.assign("/app");
          }}
        />
      </div>
    </main>
  );
}
