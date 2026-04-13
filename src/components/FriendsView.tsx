"use client";

import { useState, useEffect, useCallback } from "react";
import { api, ApiError, type FriendPublicUser, type FriendRequestRow } from "@/lib/api";

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "11px",
  color: "var(--fg-4)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const cardStyle: React.CSSProperties = {
  padding: "16px 20px",
  background: "var(--surface-1)",
  borderRadius: "10px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  width: "100%",
};

const btnOutline: React.CSSProperties = {
  border: "1px solid var(--border-2)",
  background: "transparent",
  color: "var(--fg)",
  borderRadius: "999px",
  padding: "8px 14px",
  cursor: "pointer",
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export function FriendsView() {
  const [q, setQ] = useState("");
  const [searchResults, setSearchResults] = useState<FriendPublicUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [friends, setFriends] = useState<FriendPublicUser[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestRow[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      const [fr, req] = await Promise.all([api.getFriends(), api.getFriendRequests()]);
      setFriends(fr.friends);
      setIncoming(req.incoming);
      setOutgoing(req.outgoing);
    } catch (e) {
      if (e instanceof ApiError) {
        setBanner(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const runSearch = async () => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    setBanner(null);
    try {
      const data = await api.searchFriends(trimmed);
      setSearchResults(data.users);
    } catch (e) {
      if (e instanceof ApiError) {
        setBanner(e.message);
      }
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const sendRequest = async (toUserId: string) => {
    setActionId(toUserId);
    setBanner(null);
    try {
      await api.sendFriendRequest(toUserId);
      setBanner("Request sent.");
      await loadLists();
    } catch (e) {
      if (e instanceof ApiError) {
        setBanner(e.message);
      }
    } finally {
      setActionId(null);
    }
  };

  const patchRequest = async (id: string, action: "accept" | "reject" | "cancel") => {
    setActionId(id);
    setBanner(null);
    try {
      await api.updateFriendRequest(id, action);
      await loadLists();
    } catch (e) {
      if (e instanceof ApiError) {
        setBanner(e.message);
      }
    } finally {
      setActionId(null);
    }
  };

  const unfriend = async (friendUserId: string) => {
    setActionId(friendUserId);
    setBanner(null);
    try {
      await api.removeFriend(friendUserId);
      await loadLists();
    } catch (e) {
      if (e instanceof ApiError) {
        setBanner(e.message);
      }
    } finally {
      setActionId(null);
    }
  };

  const friendIds = new Set(friends.map((f) => f.id));
  const pendingWith = new Set([
    ...incoming.map((r) => r.user.id),
    ...outgoing.map((r) => r.user.id),
  ]);

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "28px",
    animation: "fadeIn 0.6s ease",
    width: "100%",
    maxWidth: "min(440px, calc(100vw - 40px))",
  };

  return (
    <div style={containerStyle}>
      <h2
        style={{
          fontSize: "28px",
          fontWeight: 300,
          fontStyle: "italic",
          margin: 0,
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          color: "var(--fg)",
        }}
      >
        Friends
      </h2>

      <p
        style={{
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "11px",
          color: "var(--fg-3)",
          textAlign: "center",
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        Search finds public profiles only. Usernames never expose email.
      </p>

      {banner && (
        <div
          style={{
            ...cardStyle,
            border: "1px solid var(--border-2)",
            color: "var(--fg-2)",
            fontSize: "14px",
          }}
        >
          {banner}
        </div>
      )}

      <div style={cardStyle}>
        <div style={labelStyle}>Find people</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Username (min 2 chars)"
            aria-label="Search for users by username"
            style={{
              flex: "1 1 160px",
              minWidth: 0,
              padding: "10px 14px",
              borderRadius: "8px",
              border: "1px solid var(--border-2)",
              background: "var(--bg)",
              color: "var(--fg)",
              fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
              fontSize: "16px",
            }}
          />
          <button type="button" onClick={runSearch} style={btnOutline} disabled={searchLoading}>
            {searchLoading ? "…" : "Search"}
          </button>
        </div>
        {searchResults.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
            {searchResults.map((u) => {
              const isFriend = friendIds.has(u.id);
              const pending = pendingWith.has(u.id);
              const busy = actionId === u.id;
              return (
                <li
                  key={u.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border-1)",
                  }}
                >
                  <span style={{ color: "var(--fg)", fontSize: "16px" }}>{u.username}</span>
                  {isFriend ? (
                    <span style={{ ...labelStyle, textTransform: "none", letterSpacing: "0.06em" }}>Friends</span>
                  ) : pending ? (
                    <span style={{ ...labelStyle, textTransform: "none", letterSpacing: "0.06em" }}>Pending</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => sendRequest(u.id)}
                      style={btnOutline}
                    >
                      {busy ? "…" : "Add"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div style={{ ...cardStyle, gap: "16px" }}>
        <div style={labelStyle}>Requests to you</div>
        {loading ? (
          <span style={{ color: "var(--fg-3)", fontSize: "14px" }}>Loading…</span>
        ) : incoming.length === 0 ? (
          <span style={{ color: "var(--fg-3)", fontSize: "14px" }}>No pending requests.</span>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
            {incoming.map((r) => (
              <li key={r.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
                <span style={{ flex: "1 1 120px", color: "var(--fg)" }}>{r.user.username}</span>
                <button
                  type="button"
                  disabled={actionId === r.id}
                  onClick={() => patchRequest(r.id, "accept")}
                  style={btnOutline}
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={actionId === r.id}
                  onClick={() => patchRequest(r.id, "reject")}
                  style={{ ...btnOutline, opacity: 0.85 }}
                >
                  Reject
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ ...cardStyle, gap: "16px" }}>
        <div style={labelStyle}>Your outgoing requests</div>
        {loading ? (
          <span style={{ color: "var(--fg-3)", fontSize: "14px" }}>Loading…</span>
        ) : outgoing.length === 0 ? (
          <span style={{ color: "var(--fg-3)", fontSize: "14px" }}>None.</span>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
            {outgoing.map((r) => (
              <li key={r.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
                <span style={{ flex: "1 1 120px", color: "var(--fg)" }}>{r.user.username}</span>
                <button
                  type="button"
                  disabled={actionId === r.id}
                  onClick={() => patchRequest(r.id, "cancel")}
                  style={btnOutline}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ ...cardStyle, gap: "16px" }}>
        <div style={labelStyle}>Your friends</div>
        {loading ? (
          <span style={{ color: "var(--fg-3)", fontSize: "14px" }}>Loading…</span>
        ) : friends.length === 0 ? (
          <span style={{ color: "var(--fg-3)", fontSize: "14px" }}>No friends yet.</span>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
            {friends.map((f) => (
              <li key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <span style={{ color: "var(--fg)" }}>{f.username}</span>
                <button
                  type="button"
                  disabled={actionId === f.id}
                  onClick={() => unfriend(f.id)}
                  style={{ ...btnOutline, fontSize: "10px" }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
