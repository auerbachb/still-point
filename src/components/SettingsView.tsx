"use client";

import { useState } from "react";

type User = {
  id: string;
  email: string;
  username: string;
  isPublic: boolean;
  currentDay: number;
};

type SettingsViewProps = {
  user: User;
  onTogglePublic: (isPublic: boolean) => void;
  onLogout: () => void;
};

export function SettingsView({ user, onTogglePublic, onLogout }: SettingsViewProps) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !user.isPublic }),
      });
      if (res.ok) {
        onTogglePublic(!user.isPublic);
      }
    } catch {
      // silent fail
    } finally {
      setToggling(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: "32px", animation: "fadeIn 0.6s ease",
      width: "100%", maxWidth: "400px",
    }}>
      <h2 style={{
        fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
        fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
      }}>
        Settings
      </h2>

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* User info */}
        <div style={{
          padding: "16px 20px",
          background: "rgba(232,228,222,0.03)",
          borderRadius: "10px",
          display: "flex", flexDirection: "column", gap: "8px",
        }}>
          <div style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "10px", color: "rgba(232,228,222,0.25)",
            letterSpacing: "2px", textTransform: "uppercase",
          }}>
            ACCOUNT
          </div>
          <div style={{
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            fontSize: "16px", color: "#e8e4de",
          }}>
            {user.username}
          </div>
          <div style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "12px", color: "rgba(232,228,222,0.3)",
          }}>
            {user.email}
          </div>
        </div>

        {/* Public board toggle */}
        <div style={{
          padding: "16px 20px",
          background: "rgba(232,228,222,0.03)",
          borderRadius: "10px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "12px", color: "#e8e4de", marginBottom: "4px",
            }}>
              Public Board
            </div>
            <div style={{
              fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
              fontSize: "13px", fontStyle: "italic",
              color: "rgba(232,228,222,0.35)",
            }}>
              Show your stats alongside other practitioners
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            style={{
              width: "48px", height: "26px",
              borderRadius: "13px", border: "none",
              background: user.isPublic
                ? "rgba(74,222,128,0.4)"
                : "rgba(232,228,222,0.1)",
              position: "relative", cursor: "pointer",
              transition: "background 0.3s",
              flexShrink: 0, marginLeft: "16px",
            }}
          >
            <div style={{
              width: "20px", height: "20px",
              borderRadius: "10px",
              background: user.isPublic ? "#4ade80" : "rgba(232,228,222,0.3)",
              position: "absolute", top: "3px",
              left: user.isPublic ? "25px" : "3px",
              transition: "all 0.3s",
            }} />
          </button>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          style={{
            background: "none",
            border: "1px solid rgba(239,68,68,0.15)",
            color: "rgba(239,68,68,0.5)",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px", letterSpacing: "2px",
            textTransform: "uppercase", padding: "12px",
            borderRadius: "8px", cursor: "pointer",
            transition: "all 0.3s", marginTop: "8px",
          }}
        >
          log out
        </button>
      </div>
    </div>
  );
}
