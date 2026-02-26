"use client";

import { useState } from "react";

type AuthScreenProps = {
  onLogin: (user: { id: string; email: string; username: string; isPublic: boolean; currentDay: number }) => void;
};

export function AuthScreen({ onLogin }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email || !username || !password) {
      setError("All fields required");
      return;
    }
    setError("");
    setLoading(true);

    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password }),
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
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(232,228,222,0.12)",
    borderRadius: "8px",
    padding: "12px 16px",
    color: "#e8e4de",
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
      gap: "40px", animation: "fadeIn 0.6s ease", width: "100%", maxWidth: "340px",
    }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{
          fontSize: "42px", fontWeight: 300, margin: 0,
          letterSpacing: "-1px", fontStyle: "italic",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
        }}>
          Still Point
        </h1>
        <p style={{
          fontSize: "13px", color: "rgba(232,228,222,0.35)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          letterSpacing: "3px", textTransform: "uppercase", marginTop: "12px",
        }}>
          attention training
        </p>
      </div>

      <div style={{
        display: "flex", gap: "0",
        background: "rgba(232,228,222,0.04)",
        borderRadius: "20px",
        padding: "3px",
      }}>
        {(["login", "signup"] as const).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(""); }}
            style={{
              background: mode === m ? "rgba(232,228,222,0.1)" : "none",
              border: "none",
              color: mode === m ? "#e8e4de" : "rgba(232,228,222,0.3)",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px", letterSpacing: "2px",
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
          onFocus={e => e.currentTarget.style.borderColor = "rgba(232,228,222,0.3)"}
          onBlur={e => e.currentTarget.style.borderColor = "rgba(232,228,222,0.12)"}
        />
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="username"
          style={inputStyle}
          onFocus={e => e.currentTarget.style.borderColor = "rgba(232,228,222,0.3)"}
          onBlur={e => e.currentTarget.style.borderColor = "rgba(232,228,222,0.12)"}
        />
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="password"
          style={inputStyle}
          onFocus={e => e.currentTarget.style.borderColor = "rgba(232,228,222,0.3)"}
          onBlur={e => e.currentTarget.style.borderColor = "rgba(232,228,222,0.12)"}
        />
        {error && (
          <div style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px", color: "rgba(239,68,68,0.7)",
            textAlign: "center",
          }}>
            {error}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            background: "none",
            border: "1px solid rgba(232,228,222,0.2)",
            color: "#e8e4de",
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            fontSize: "16px", fontStyle: "italic",
            padding: "14px", borderRadius: "30px",
            cursor: loading ? "wait" : "pointer",
            transition: "all 0.3s",
            marginTop: "8px",
            opacity: loading ? 0.5 : 1,
          }}
          onMouseEnter={e => {
            if (!loading) {
              e.currentTarget.style.borderColor = "rgba(232,228,222,0.4)";
              e.currentTarget.style.background = "rgba(232,228,222,0.05)";
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "rgba(232,228,222,0.2)";
            e.currentTarget.style.background = "none";
          }}
        >
          {loading ? "..." : mode === "login" ? "Enter" : "Begin the journey"}
        </button>
      </div>
    </div>
  );
}
