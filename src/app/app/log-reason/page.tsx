"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppSubpageShell } from "@/components/AppSubpageShell";
import { BuddyCalendarAuthGate } from "@/components/BuddyCalendarAuthGate";
import { addDaysToIsoDate, isValidSessionCalendarDate, todayLocalIsoDate } from "@/lib/sessionCalendar";

const MAX_REASON_LENGTH = 1000;

export default function LogReasonPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-4)" }}>
          Loading…
        </div>
      }
    >
      <LogReasonContent />
    </Suspense>
  );
}

function LogReasonContent() {
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");
  const targetDate = dateParam && isValidSessionCalendarDate(dateParam) ? dateParam : todayLocalIsoDate();

  const today = todayLocalIsoDate();
  const yesterday = addDaysToIsoDate(today, -1);
  const isYesterday = targetDate === yesterday;
  const dayLabel = isYesterday ? "yesterday" : targetDate === today ? "today" : "that day";

  return (
    <BuddyCalendarAuthGate>
      {() => (
        <AppSubpageShell title="A gentle check-in" backHref="/app" backLabel="Back to app">
          <LogReasonForm
            targetDate={targetDate}
            dayLabel={dayLabel}
            isYesterday={isYesterday}
            today={today}
          />
        </AppSubpageShell>
      )}
    </BuddyCalendarAuthGate>
  );
}

function LogReasonForm({
  targetDate,
  dayLabel,
  isYesterday,
  today,
}: {
  targetDate: string;
  dayLabel: string;
  isYesterday: boolean;
  today: string;
}) {
  const [text, setText] = useState("");
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [hadExisting, setHadExisting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Reset per-date state so navigating between dates (e.g. two different deep links
    // in one session) never carries a prior day's note or success screen forward.
    setSaved(false);
    setError(null);
    setText("");
    setHadExisting(false);
    setLoadingExisting(true);
    (async () => {
      try {
        const res = await fetch(`/api/failure-reasons?date=${encodeURIComponent(targetDate)}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const existingText = typeof data?.failureReason?.text === "string"
            ? data.failureReason.text
            : null;
          setText(existingText ?? "");
          setHadExisting(existingText !== null);
        }
      } catch {
        // Non-fatal: fall back to an empty textarea.
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetDate]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    // Guard on a ref, not the async `submitting` state, so rapid double-clicks in the
    // same tick can't fire two POSTs before the disabled state has re-rendered.
    if (trimmed.length === 0 || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/failure-reasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonDate: targetDate, text: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Could not save your note. Please try again.");
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your note. Please try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [text, targetDate]);

  if (saved) {
    return (
      <div style={confirmWrapStyle}>
        <p style={confirmLeadStyle}>Thanks for logging. Every day is a fresh start.</p>
        {isYesterday ? (
          <>
            {/* They just logged yesterday — guide them to today next, per #441. */}
            <Link href={`/app/log-reason?date=${today}`} style={primaryCtaStyle}>
              Now: why not today?
            </Link>
            <Link href="/app?session=quick" style={secondaryLinkStyle}>
              Or start a quick 60-second session
            </Link>
          </>
        ) : (
          <>
            <Link href="/app?session=quick" style={primaryCtaStyle}>
              Start a quick 60-second session
            </Link>
            <Link href="/app" style={secondaryLinkStyle}>
              Back to home
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={formWrapStyle}>
      <label htmlFor="failure-reason-text" style={promptStyle}>
        Why couldn&apos;t you meditate {dayLabel}?
      </label>
      <p style={hintStyle}>
        No judgment — even a sentence helps you notice the patterns that get in the way.
      </p>
      <textarea
        id="failure-reason-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={MAX_REASON_LENGTH}
        disabled={loadingExisting || submitting}
        placeholder="A few honest words about what made it hard today…"
        style={textareaStyle}
      />
      <div style={counterRowStyle}>
        {hadExisting && <span>Updating your earlier note for this day.</span>}
        <span style={{ marginLeft: "auto" }}>
          {text.length}/{MAX_REASON_LENGTH}
        </span>
      </div>
      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={text.trim().length === 0 || submitting || loadingExisting}
        style={{
          ...primaryCtaStyle,
          opacity: text.trim().length === 0 || submitting || loadingExisting ? 0.5 : 1,
          cursor: text.trim().length === 0 || submitting || loadingExisting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Saving…" : "Save note"}
      </button>
    </div>
  );
}

const formWrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--s3)",
  width: "100%",
};

const confirmWrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--s3)",
  width: "100%",
  alignItems: "center",
  textAlign: "center",
};

const promptStyle: CSSProperties = {
  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
  fontSize: "20px",
  fontStyle: "italic",
  color: "var(--fg)",
  margin: 0,
  textAlign: "center",
};

const confirmLeadStyle: CSSProperties = {
  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
  fontSize: "20px",
  fontStyle: "italic",
  color: "var(--fg)",
  margin: 0,
  lineHeight: 1.5,
};

const hintStyle: CSSProperties = {
  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
  fontSize: "14px",
  fontStyle: "italic",
  color: "var(--fg-3)",
  margin: 0,
  textAlign: "center",
  lineHeight: 1.5,
};

const textareaStyle: CSSProperties = {
  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
  fontSize: "16px",
  color: "var(--fg)",
  background: "var(--surface-2)",
  border: "1px solid var(--border-3)",
  borderRadius: "10px",
  padding: "12px 14px",
  resize: "vertical",
  minHeight: "110px",
  lineHeight: 1.5,
  width: "100%",
  boxSizing: "border-box",
};

const counterRowStyle: CSSProperties = {
  display: "flex",
  gap: "var(--s2)",
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "11px",
  color: "var(--fg-4)",
  letterSpacing: "0.06em",
};

const primaryCtaStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--border-2)",
  background: "var(--accent-green-bg)",
  color: "var(--fg)",
  borderRadius: "999px",
  padding: "12px 18px",
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "12px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textDecoration: "none",
  cursor: "pointer",
};

const secondaryLinkStyle: CSSProperties = {
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "11px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--fg-3)",
  textDecoration: "none",
};

const errorStyle: CSSProperties = {
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "11px",
  color: "var(--accent-danger-muted)",
  letterSpacing: "0.04em",
};
