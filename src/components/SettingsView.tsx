"use client";

import { useState } from "react";
import { DeleteAccountSection } from "@/components/DeleteAccountSection";
import { api } from "@/lib/api";

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
  onUsernameChange: (username: string) => void;
  onLogout: () => void;
};

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const USERNAME_FORMAT_ERROR =
  "Username must be 3-30 characters (letters, numbers, underscores)";

export function SettingsView({
  user,
  onTogglePublic,
  onUsernameChange,
  onLogout,
}: SettingsViewProps) {
  const [toggling, setToggling] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState(user.username);
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);

  const beginEditUsername = () => {
    setUsernameInput(user.username);
    setUsernameError(null);
    setUsernameSuccess(null);
    setEditingUsername(true);
  };

  const cancelEditUsername = () => {
    setEditingUsername(false);
    setUsernameError(null);
    setUsernameInput(user.username);
  };

  const handleSaveUsername = async () => {
    const trimmed = usernameInput.trim();
    setUsernameError(null);
    setUsernameSuccess(null);

    if (trimmed === user.username) {
      setEditingUsername(false);
      return;
    }
    if (
      trimmed.length < 3 ||
      trimmed.length > 30 ||
      !USERNAME_REGEX.test(trimmed)
    ) {
      setUsernameError(USERNAME_FORMAT_ERROR);
      return;
    }

    setSavingUsername(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUsernameError(data?.error ?? "Could not update username");
        return;
      }
      const updated = data?.user?.username ?? trimmed;
      onUsernameChange(updated);
      setUsernameInput(updated);
      setEditingUsername(false);
      setUsernameSuccess("Username updated");
    } catch {
      setUsernameError("Could not update username");
    } finally {
      setSavingUsername(false);
    }
  };

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
      width: "100%", maxWidth: "min(400px, calc(100vw - 40px))",
    }}>
      <h2 style={{
        fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
        fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
        color: "var(--fg)",
      }}>
        Settings
      </h2>

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* User info */}
        <div style={{
          padding: "16px 20px",
          background: "var(--surface-1)",
          borderRadius: "10px",
          display: "flex", flexDirection: "column", gap: "8px",
        }}>
          <div style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px", color: "var(--fg-4)",
            letterSpacing: "0.12em", textTransform: "uppercase",
          }}>
            ACCOUNT
          </div>
          {editingUsername ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                disabled={savingUsername}
                autoFocus
                aria-label="Username"
                aria-invalid={usernameError !== null}
                maxLength={30}
                style={{
                  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
                  fontSize: "16px", color: "var(--fg)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-3)",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={handleSaveUsername}
                  disabled={savingUsername}
                  style={{
                    background: "none",
                    border: "1px solid var(--border-3)",
                    color: "var(--fg)",
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px", letterSpacing: "0.12em",
                    textTransform: "uppercase", padding: "6px 12px",
                    borderRadius: "6px",
                    cursor: savingUsername ? "not-allowed" : "pointer",
                  }}
                >
                  {savingUsername ? "saving…" : "save"}
                </button>
                <button
                  type="button"
                  onClick={cancelEditUsername}
                  disabled={savingUsername}
                  style={{
                    background: "none",
                    border: "1px solid var(--border-3)",
                    color: "var(--fg-3)",
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px", letterSpacing: "0.12em",
                    textTransform: "uppercase", padding: "6px 12px",
                    borderRadius: "6px",
                    cursor: savingUsername ? "not-allowed" : "pointer",
                  }}
                >
                  cancel
                </button>
              </div>
              {usernameError && (
                <div
                  role="alert"
                  style={{
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px",
                    color: "var(--accent-danger-muted)",
                  }}
                >
                  {usernameError}
                </div>
              )}
            </div>
          ) : (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: "12px",
            }}>
              <div style={{
                fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
                fontSize: "16px", color: "var(--fg)",
              }}>
                {user.username}
              </div>
              <button
                type="button"
                onClick={beginEditUsername}
                aria-label="Edit username"
                style={{
                  background: "none",
                  border: "1px solid var(--border-3)",
                  color: "var(--fg-3)",
                  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                  fontSize: "10px", letterSpacing: "0.12em",
                  textTransform: "uppercase", padding: "4px 10px",
                  borderRadius: "6px", cursor: "pointer",
                }}
              >
                edit
              </button>
            </div>
          )}
          {usernameSuccess && !editingUsername && (
            <div
              role="status"
              style={{
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "11px",
                color: "var(--accent-green)",
              }}
            >
              {usernameSuccess}
            </div>
          )}
          <div style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "12px", color: "var(--fg-3)",
          }}>
            {user.email}
          </div>
        </div>

        {/* Public board toggle */}
        <div style={{
          padding: "16px 20px",
          background: "var(--surface-1)",
          borderRadius: "10px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "12px", color: "var(--fg)", marginBottom: "4px",
            }}>
              Public Board
            </div>
            <div style={{
              fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
              fontSize: "13px", fontStyle: "italic",
              color: "var(--fg-3)",
            }}>
              Show your stats alongside other practitioners
            </div>
          </div>
          <button
            type="button"
            aria-label={user.isPublic ? "Disable public board" : "Enable public board"}
            aria-pressed={user.isPublic}
            onClick={handleToggle}
            disabled={toggling}
            style={{
              width: "48px", height: "26px",
              borderRadius: "13px", border: "none",
              background: user.isPublic
                ? "var(--accent-green-bg)"
                : "var(--surface-3)",
              position: "relative", cursor: "pointer",
              transition: "background 0.3s",
              flexShrink: 0, marginLeft: "16px",
            }}
          >
            <div style={{
              width: "20px", height: "20px",
              borderRadius: "10px",
              background: user.isPublic ? "var(--accent-green)" : "var(--border-3)",
              position: "absolute", top: "3px",
              left: user.isPublic ? "25px" : "3px",
              transition: "all 0.3s",
            }} />
          </button>
        </div>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          style={{
            background: "none",
            border: "1px solid var(--accent-danger-border-subtle)",
            color: "var(--accent-danger-muted)",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px", letterSpacing: "0.12em",
            textTransform: "uppercase", padding: "12px",
            borderRadius: "8px", cursor: "pointer",
            transition: "all 0.3s", marginTop: "8px",
          }}
        >
          log out
        </button>

        <DeleteAccountSection
          onDeleted={async () => {
            try {
              await api.logout();
            } catch {
              // Best effort; account deletion already invalidates auth server-side.
            }
            onLogout();
          }}
        />
      </div>
    </div>
  );
}
