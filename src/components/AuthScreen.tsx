"use client";

import { useEffect, useState } from "react";

type AuthScreenProps = {
  onLogin: (user: { id: string; email: string; username: string; isPublic: boolean; currentDay: number }) => void;
};

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_session_missing: "Sign-in didn't complete. Please try again.",
  oauth_user_missing: "We couldn't find your account. Please try again.",
  oauth_internal_error: "Something went wrong on our end. Please try again.",
  OAuthSignin: "Couldn't start Google sign-in. Please try again.",
  OAuthCallback: "Google sign-in was cancelled or failed.",
  OAuthCreateAccount: "Couldn't create your account. Please try again.",
  AccessDenied: "Access denied. Please try again.",
  Verification: "We couldn't verify your Google account.",
  Configuration: "Sign-in is temporarily unavailable.",
};

export function AuthScreen({ onLogin }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
            window.location.href = "/api/auth/signin/google";
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
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "var(--border-3)";
            e.currentTarget.style.background = "var(--surface-2)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "var(--border-2)";
            e.currentTarget.style.background = "var(--surface-1)";
          }}
          aria-label="Continue with Google"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/>
          </svg>
          Continue with Google
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
