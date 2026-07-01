"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { loadLastAuthProvider, type OAuthProvider } from "@/lib/lastAuthProvider";

type AuthScreenProps = {
  onLogin: (user: {
    id: string;
    email: string;
    username: string;
    isPublic: boolean;
    currentDay: number;
    aphorismsEnabled: boolean;
  }) => void;
};

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_session_missing: "Sign-in didn't complete. Please try again.",
  oauth_user_missing: "We couldn't find your account. Please try again.",
  oauth_internal_error: "Something went wrong on our end. Please try again.",
  OAuthSignin: "Couldn't start sign-in. Please try again.",
  OAuthCallback: "Sign-in was cancelled or failed.",
  OAuthCreateAccount: "Couldn't create your account. Please try again.",
  AccessDenied: "Access denied. Please try again.",
  Verification: "We couldn't verify your account.",
  Configuration: "Sign-in is temporarily unavailable.",
};

function LastUsedTag({ onDark }: { onDark: boolean }) {
  return (
    <span
      style={{
        position: "absolute",
        top: "50%",
        right: "12px",
        transform: "translateY(-50%)",
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
        fontSize: "8px",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        lineHeight: 1,
        padding: "4px 7px",
        borderRadius: "10px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        color: onDark ? "rgba(255, 255, 255, 0.65)" : "var(--fg-3)",
        border: onDark ? "1px solid rgba(255, 255, 255, 0.25)" : "1px solid var(--border-2)",
        background: onDark ? "rgba(255, 255, 255, 0.08)" : "var(--overlay-bg)",
      }}
    >
      last used
    </span>
  );
}

export function AuthScreen({ onLogin }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Read in an effect (not the initializer) so server and first client
  // render agree — localStorage is only available after hydration.
  const [lastProvider, setLastProvider] = useState<OAuthProvider | null>(null);

  useEffect(() => {
    setLastProvider(loadLastAuthProvider());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    if (!oauthError) return;
    setError(OAUTH_ERROR_MESSAGES[oauthError] ?? "Sign-in failed. Please try again.");
    // Strip the query param so a refresh doesn't re-show the error.
    params.delete("error");
    const next = params.toString();
    const url = `${window.location.pathname}${next ? `?${next}` : ""}`;
    window.history.replaceState({}, "", url);
  }, []);

  const handleSubmit = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username.trim();
    if (!trimmedEmail || !password || (mode === "signup" && !trimmedUsername)) {
      setError(mode === "signup" ? "All fields required" : "Email and password required");
      return;
    }
    setError("");
    setLoading(true);

    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "signup" ? { email: trimmedEmail, username: trimmedUsername, password } : { email: trimmedEmail, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      onLogin(data.user);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--overlay-bg)",
    border: "1px solid var(--border-1)",
    borderRadius: "8px",
    padding: "12px 16px",
    color: "var(--fg)",
    fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
    fontSize: "15px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
    transition: "border-color 0.3s",
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: "40px", animation: "fadeIn 0.6s ease", width: "100%", maxWidth: "min(340px, calc(100vw - 40px))",
    }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{
          fontSize: "42px", fontWeight: 300, margin: 0,
          letterSpacing: "-0.02em", fontStyle: "italic",
          color: "var(--fg)",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
        }}>
          Still Point
        </h1>
        <p style={{
          fontSize: "13px", color: "var(--fg-2)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          letterSpacing: "0.15em", textTransform: "uppercase", marginTop: "var(--s1)",
        }}>
          attention training
        </p>
      </div>

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "12px" }}>
        <button
          type="button"
          onClick={() => {
            // Carry the current page (path + query) as callbackUrl so any
            // deep-link state (invite links, ?buddy=..., etc.) survives the
            // OAuth round-trip. Strip `error` first — forwarding it back
            // would land the user on /app?error=... after sign-in, which
            // the redirect callback in auth-config treats as a failure
            // target and bypasses the sp_token bridge.
            const params = new URLSearchParams(window.location.search);
            params.delete("error");
            const search = params.toString();
            const callbackUrl = `${window.location.pathname}${search ? `?${search}` : ""}`;
            // Auth.js v5: sign-in must use POST + CSRF via signIn() — a bare
            // GET to /api/auth/signin?provider=google is rejected.
            void signIn("google", { callbackUrl });
          }}
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border-2)",
            color: "var(--fg)",
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            fontSize: "15px",
            padding: "12px 16px",
            borderRadius: "30px",
            cursor: "pointer",
            transition: "all 0.3s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            position: "relative",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "var(--border-3)";
            e.currentTarget.style.background = "var(--surface-2)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "var(--border-2)";
            e.currentTarget.style.background = "var(--surface-1)";
          }}
          aria-label={lastProvider === "google" ? "Continue with Google (last used)" : "Continue with Google"}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/>
          </svg>
          Continue with Google
          {lastProvider === "google" && <LastUsedTag onDark={false} />}
        </button>

        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams(window.location.search);
            params.delete("error");
            const search = params.toString();
            const callbackUrl = `${window.location.pathname}${search ? `?${search}` : ""}`;
            void signIn("apple", { callbackUrl });
          }}
          style={{
            background: "#000000",
            border: "1px solid #000000",
            color: "#ffffff",
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            fontSize: "15px",
            padding: "12px 16px",
            borderRadius: "30px",
            cursor: "pointer",
            transition: "all 0.3s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            position: "relative",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "#1a1a1a";
            e.currentTarget.style.borderColor = "#1a1a1a";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "#000000";
            e.currentTarget.style.borderColor = "#000000";
          }}
          aria-label={lastProvider === "apple" ? "Continue with Apple (last used)" : "Continue with Apple"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
          </svg>
          Continue with Apple
          {lastProvider === "apple" && <LastUsedTag onDark />}
        </button>

        <p style={{
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "10px",
          color: "var(--fg-4)",
          textAlign: "center",
          letterSpacing: "0.05em",
          lineHeight: 1.5,
          margin: 0,
        }}>
          By continuing you agree to our{" "}
          <a href="/privacy" style={{ color: "var(--fg-3)", textDecoration: "underline", textUnderlineOffset: "2px" }}>
            privacy policy
          </a>
          .
        </p>
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        width: "100%",
        color: "var(--fg-4)",
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
        fontSize: "10px",
        letterSpacing: "0.15em",
        textTransform: "uppercase",
      }}>
        <div style={{ flex: 1, height: "1px", background: "var(--border-1)" }} />
        or
        <div style={{ flex: 1, height: "1px", background: "var(--border-1)" }} />
      </div>

      <div style={{
        display: "flex", gap: "0",
        background: "var(--surface-1)",
        borderRadius: "20px",
        padding: "3px",
      }}>
        {(["login", "signup"] as const).map(m => (
          <button
            type="button"
            key={m}
            onClick={() => { setMode(m); setError(""); }}
            style={{
              background: mode === m ? "var(--surface-3)" : "none",
              border: "none",
              color: mode === m ? "var(--fg)" : "var(--fg-4)",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px", letterSpacing: "0.15em",
              textTransform: "uppercase", cursor: "pointer",
              padding: "8px 20px", borderRadius: "17px",
              transition: "all 0.3s",
            }}
          >
            {m === "login" ? "log in" : "sign up"}
          </button>
        ))}
      </div>

      <div style={{
        display: "flex", flexDirection: "column", gap: "12px", width: "100%",
      }}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="email"
          style={inputStyle}
          onFocus={e => e.currentTarget.style.borderColor = "var(--border-3)"}
          onBlur={e => e.currentTarget.style.borderColor = "var(--border-1)"}
        />
        {mode === "signup" && (
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="username"
            style={inputStyle}
            onFocus={e => e.currentTarget.style.borderColor = "var(--border-3)"}
            onBlur={e => e.currentTarget.style.borderColor = "var(--border-1)"}
          />
        )}
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="password"
          style={inputStyle}
          onFocus={e => e.currentTarget.style.borderColor = "var(--border-3)"}
          onBlur={e => e.currentTarget.style.borderColor = "var(--border-1)"}
        />
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px", color: "var(--accent-danger)",
              textAlign: "center",
              lineHeight: 1.5,
              overflowWrap: "break-word",
              width: "100%",
              maxWidth: "28ch",
              margin: "0 auto",
            }}
          >
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border-2)",
            color: "var(--fg)",
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            fontSize: "16px", fontStyle: "italic",
            padding: "14px", borderRadius: "30px",
            cursor: loading ? "wait" : "pointer",
            transition: "all 0.3s",
            marginTop: "var(--s1)",
            opacity: loading ? 0.5 : 1,
          }}
          onMouseEnter={e => {
            if (!loading) {
              e.currentTarget.style.borderColor = "var(--border-3)";
              e.currentTarget.style.background = "var(--surface-2)";
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "var(--border-2)";
            e.currentTarget.style.background = "var(--surface-1)";
          }}
        >
          {loading ? "..." : mode === "login" ? "Enter" : "Begin the journey"}
        </button>
        {mode === "login" && (
          <a
            href="/reset-password"
            style={{
              alignSelf: "center",
              color: "var(--fg-3)",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px",
              letterSpacing: "0.08em",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
              textTransform: "uppercase",
            }}
          >
            Forgot password?
          </a>
        )}
      </div>
    </div>
  );
}
