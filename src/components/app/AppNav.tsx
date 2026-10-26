import type { ReactNode } from "react";
import { NAV_TABS, TAB_LABELS, type Tab } from "@/lib/appTabs";

// Minimal line icons for the mobile bottom tab bar. Pairing each short label
// with an icon lets the six tabs sit with clear spacing at 320px instead of
// colliding as text-only labels did (#473 P1).
const TAB_ICONS: Record<Tab, ReactNode> = {
  progress: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  journal: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  board: (
    <>
      <path d="M6 20v-7M12 20V5M18 20v-9" />
    </>
  ),
  friends: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5c0-3 2.6-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6" />
      <path d="M16.5 14.6c2.3.4 4 2.3 4 4.9" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h8M16 7h4M4 17h4M12 17h8" />
      <circle cx="14" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </>
  ),
  // Reached from the Progress screen, not the nav row; defined to satisfy the
  // Record<Tab> type.
  buddy: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="16" cy="9" r="2.4" />
      <path d="M3.5 19.5c0-3 2.6-5 5.5-5s5.5 2 5.5 5" />
    </>
  ),
};

function TabIcon({ tab }: { tab: Tab }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TAB_ICONS[tab]}
    </svg>
  );
}

type AppNavProps = {
  /** The tab to mark as the current page, or null while an overlay covers the tabs. */
  activeTab: Tab | null;
  isMobile: boolean;
  onSelectTab: (tab: Tab) => void;
};

/** The persistent tab nav: a fixed bottom bar on mobile, links at the top right on desktop. */
export function AppNav({ activeTab, isMobile, onSelectTab }: AppNavProps) {
  return (
    <div style={isMobile ? {
      position: "fixed", bottom: 0, left: 0, right: 0,
      display: "flex", justifyContent: "space-around",
      background: "rgba(var(--bg-rgb), 0.92)", backdropFilter: "blur(10px)",
      borderTop: "1px solid var(--border-1)",
      padding: "10px 6px env(safe-area-inset-bottom, 8px)",
      zIndex: 100,
    } : {
      position: "fixed", top: "var(--s4)", right: "var(--s4)",
      display: "flex", gap: "var(--s3)",
      zIndex: 100,
    }}>
      {NAV_TABS.map(t => {
        const active = activeTab === t;
        return (
          <button
            type="button"
            key={t}
            aria-label={TAB_LABELS[t]}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelectTab(t)}
            style={{
              background: "none", border: "none",
              color: active ? "var(--fg)" : "var(--fg-2)",
              fontFamily: "var(--font-mono)",
              fontSize: isMobile ? "9px" : "11px",
              letterSpacing: isMobile ? "0.02em" : "0.1em",
              textTransform: "uppercase",
              cursor: "pointer",
              padding: isMobile ? "6px 2px 8px" : "8px",
              minWidth: isMobile ? "44px" : undefined,
              minHeight: isMobile ? "44px" : undefined,
              lineHeight: 1.2,
              display: "inline-flex",
              flexDirection: isMobile ? "column" : "row",
              alignItems: "center", justifyContent: "center",
              gap: isMobile ? "3px" : undefined,
              transition: "color 0.3s",
              position: "relative",
            }}
          >
            {isMobile && <TabIcon tab={t} />}
            <span>{TAB_LABELS[t]}</span>
            {active && isMobile && (
              <span style={{
                position: "absolute", bottom: "2px", left: "50%", transform: "translateX(-50%)",
                width: "16px", height: "2px", borderRadius: "1px",
                background: "var(--fg)",
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
