"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Status = "idle" | "submitting" | "success" | "error";

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
};

const buttonStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border-2)",
  color: "var(--fg)",
  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
  fontSize: "16px",
  fontStyle: "italic",
  padding: "14px",
  borderRadius: "30px",
  cursor: "pointer",
  transition: "all 0.3s",
};

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = useMemo(() => params.get("token")?.trim() ?? "", [params]);
  const initialEmail = useMemo(() => params.get("email")?.trim().toLowerCase() ?? "", [params]);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const requestReset = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setStatus("error");
      setMessage("Enter your email first.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Unable to request a reset link. Please try again.");
        return;
      }

      setStatus("success");
      setMessage(data.message || "If an account exists for that email, a reset link will arrive shortly.");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  const submit = async () => {
    if (!token) {
      setStatus("error");
      setMessage("This reset link is missing a token. Request a new link and try again.");
      return;
    }
    if (password.length < 8) {
      setStatus("error");
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Unable to reset password. Request a new link and try again.");
        return;
      }

      setStatus("success");
      setPassword("");
      setConfirmPassword("");
      setMessage("Your password has been updated. You can now log in with the new password.");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "min(380px, calc(100vw - 40px))",
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        textAlign: "center",
        animation: "fadeIn 0.6s ease",
      }}
    >
      <div>
        <h1
          style={{
            fontSize: "42px",
            fontWeight: 300,
            margin: 0,
            letterSpacing: "-0.02em",
            fontStyle: "italic",
            color: "var(--fg)",
          }}
        >
          Reset password
        </h1>
        <p
          style={{
            fontSize: "14px",
            color: "var(--fg-2)",
            lineHeight: 1.5,
            marginTop: "var(--s2)",
          }}
        >
          {token ? "Choose a new password for Still Point." : "Enter your email and we will send a reset link if an account exists."}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {token ? (
          <>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="new password"
              autoComplete="new-password"
              style={inputStyle}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="confirm new password"
              autoComplete="new-password"
              style={inputStyle}
            />
          </>
        ) : (
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="email"
            autoComplete="email"
            style={inputStyle}
          />
        )}
        {message ? (
          <div
            role={status === "error" ? "alert" : "status"}
            style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px",
              color: status === "error" ? "var(--accent-danger)" : "var(--accent-green-text)",
              lineHeight: 1.5,
            }}
          >
            {message}
          </div>
        ) : null}
        <button
          type="button"
          onClick={token ? submit : requestReset}
          disabled={status === "submitting"}
          style={{
            ...buttonStyle,
            opacity: status === "submitting" ? 0.5 : 1,
            cursor: status === "submitting" ? "wait" : "pointer",
          }}
        >
          {status === "submitting" ? "..." : token ? "Set new password" : "Send reset link"}
        </button>
      </div>

      <Link
        href="/app"
        style={{
          color: "var(--fg-3)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "11px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          textDecoration: "underline",
          textUnderlineOffset: "3px",
        }}
      >
        Return to login
      </Link>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main
      style={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
      }}
    >
      <Suspense fallback={<div style={{ color: "var(--fg-3)" }}>Loading reset link...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
