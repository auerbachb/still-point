"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  detectedTimezone,
  fetchNotificationPreferences,
  fetchVapidPublicKey,
  isWebPushSupported,
  needsPwaInstallForWebPush,
  patchNotificationPreferences,
  registerWebPushSubscription,
  subscribeBrowserPush,
  type NotificationPreferencesDto,
  unsubscribeBrowserPush,
  unregisterWebPushEndpoint,
} from "@/lib/web-push-client";

const frequencyOptions = [
  { value: "daily", label: "Daily" },
  { value: "every_other", label: "Every other day" },
  { value: "weekly", label: "Weekly (Mondays)" },
] as const;

export function WebNotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPreferencesDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushEndpoint, setPushEndpoint] = useState<string | null>(null);

  const supported = isWebPushSupported();
  const pwaRequired = needsPwaInstallForWebPush();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchNotificationPreferences();
      setPrefs(next);
      if (supported && next.pushEnabled) {
        const registration = await navigator.serviceWorker.ready.catch(() => null);
        const sub = registration ? await registration.pushManager.getSubscription() : null;
        setPushEndpoint(sub?.endpoint ?? null);
      } else {
        setPushEndpoint(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications");
    } finally {
      setLoading(false);
    }
  }, [supported]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (patch: Partial<NotificationPreferencesDto>) => {
    const updated = await patchNotificationPreferences(patch);
    setPrefs(updated);
    return updated;
  };

  const enablePush = async () => {
    if (pwaRequired) {
      setError("On iPhone and iPad, add Still Point to your Home Screen first, then enable notifications from that app.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setError("Notification permission was not granted.");
      return;
    }
    const publicKey = await fetchVapidPublicKey();
    const subscription = await subscribeBrowserPush(publicKey);
    await registerWebPushSubscription(subscription);
    setPushEndpoint(subscription.endpoint);
    await persist({
      pushEnabled: true,
      tz: detectedTimezone(),
    });
  };

  const disablePush = async () => {
    const subscription = await unsubscribeBrowserPush();
    if (subscription?.endpoint) {
      await unregisterWebPushEndpoint(subscription.endpoint);
    } else if (pushEndpoint) {
      await unregisterWebPushEndpoint(pushEndpoint);
    }
    setPushEndpoint(null);
    await persist({ pushEnabled: false, dailyReminderEnabled: false });
  };

  const handlePushToggle = async () => {
    if (!prefs || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (prefs.pushEnabled) {
        await disablePush();
      } else {
        await enablePush();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update push notifications");
    } finally {
      setBusy(false);
    }
  };

  const handleDailyReminderToggle = async () => {
    if (!prefs || busy || !prefs.pushEnabled) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await persist({ dailyReminderEnabled: !prefs.dailyReminderEnabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update daily reminder");
    } finally {
      setBusy(false);
    }
  };

  const handleTimeChange = async (value: string) => {
    if (!prefs || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await persist({ dailyReminderTime: value });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update reminder time");
    } finally {
      setBusy(false);
    }
  };

  const handleFrequencyChange = async (value: NotificationPreferencesDto["dailyReminderFrequency"]) => {
    if (!prefs || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await persist({ dailyReminderFrequency: value });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update reminder frequency");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={labelStyle}>NOTIFICATIONS</div>
        <div style={hintStyle}>Loading…</div>
      </div>
    );
  }

  if (!supported) {
    return (
      <div style={cardStyle}>
        <div style={labelStyle}>NOTIFICATIONS</div>
        <div style={hintStyle}>
          This browser does not support web push. Use Chrome, Firefox, or Safari on desktop, Chrome on Android,
          or add Still Point to your iPhone Home Screen (iOS 16.4+).
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={labelStyle}>NOTIFICATIONS</div>

      {pwaRequired && (
        <div style={hintStyle} role="note">
          On iPhone and iPad, web push only works when you open Still Point from your Home Screen (Share → Add to Home Screen), not from Safari tabs.
        </div>
      )}

      <ToggleRow
        title="Push notifications"
        description="Reminders and updates in this browser"
        pressed={Boolean(prefs?.pushEnabled)}
        disabled={busy}
        onToggle={() => { void handlePushToggle(); }}
      />

      {prefs?.pushEnabled && (
        <>
          <ToggleRow
            title="Daily reminder"
            description="Nudge to sit at your chosen local time"
            pressed={prefs.dailyReminderEnabled}
            disabled={busy}
            onToggle={() => { void handleDailyReminderToggle(); }}
          />

          {prefs.dailyReminderEnabled && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <label style={fieldLabelStyle}>
                Reminder time
                <input
                  type="time"
                  value={prefs.dailyReminderTime}
                  disabled={busy}
                  onChange={(e) => { void handleTimeChange(e.target.value); }}
                  style={timeInputStyle}
                />
              </label>
              <label style={fieldLabelStyle}>
                Frequency
                <select
                  value={prefs.dailyReminderFrequency}
                  disabled={busy}
                  onChange={(e) => {
                    void handleFrequencyChange(
                      e.target.value as NotificationPreferencesDto["dailyReminderFrequency"],
                    );
                  }}
                  style={selectStyle}
                >
                  {frequencyOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              <div style={hintStyle}>
                Timezone: {prefs.tz}
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <div role="alert" style={errorStyle}>{error}</div>
      )}
    </div>
  );
}

function ToggleRow(props: {
  title: string;
  description: string;
  pressed: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
      <div>
        <div style={{ fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace", fontSize: "12px", color: "var(--fg)" }}>
          {props.title}
        </div>
        <div style={{
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          fontSize: "13px",
          fontStyle: "italic",
          color: "var(--fg-3)",
        }}
        >
          {props.description}
        </div>
      </div>
      <button
        type="button"
        aria-label={props.pressed ? `Disable ${props.title}` : `Enable ${props.title}`}
        aria-pressed={props.pressed}
        onClick={props.onToggle}
        disabled={props.disabled}
        style={{
          width: "48px",
          height: "26px",
          borderRadius: "13px",
          border: "none",
          background: props.pressed ? "var(--accent-green-bg)" : "var(--surface-3)",
          position: "relative",
          cursor: props.disabled ? "not-allowed" : "pointer",
          transition: "background 0.3s",
          flexShrink: 0,
        }}
      >
        <div style={{
          width: "20px",
          height: "20px",
          borderRadius: "10px",
          background: props.pressed ? "var(--accent-green)" : "var(--border-3)",
          position: "absolute",
          top: "3px",
          left: props.pressed ? "25px" : "3px",
          transition: "all 0.3s",
        }}
        />
      </button>
    </div>
  );
}

const cardStyle: CSSProperties = {
  padding: "16px 20px",
  background: "var(--surface-1)",
  borderRadius: "10px",
};

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "11px",
  color: "var(--fg-4)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const hintStyle: CSSProperties = {
  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
  fontSize: "13px",
  fontStyle: "italic",
  color: "var(--fg-3)",
  lineHeight: 1.5,
};

const errorStyle: CSSProperties = {
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "11px",
  color: "var(--accent-danger-muted)",
};

const fieldLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "11px",
  color: "var(--fg-3)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const timeInputStyle: CSSProperties = {
  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
  fontSize: "16px",
  color: "var(--fg)",
  background: "var(--surface-2)",
  border: "1px solid var(--border-3)",
  borderRadius: "6px",
  padding: "6px 10px",
};

const selectStyle: CSSProperties = {
  ...timeInputStyle,
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "13px",
};
