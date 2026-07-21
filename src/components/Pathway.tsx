"use client";

import { useCallback, useState } from "react";
import {
  PATHWAY_COMING_SOON_MESSAGE,
  buildPathway,
  type PathwayNode,
} from "@/lib/pathway";

const mono = "var(--font-mono)";

function Node({ node, onTap }: { node: PathwayNode; onTap: () => void }) {
  const base = {
    flex: "0 1 30px",
    maxWidth: "30px",
    minWidth: 0,
    aspectRatio: "1 / 1",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: mono,
    fontSize: "11px",
    lineHeight: 1,
    boxSizing: "border-box" as const,
    border: "1px solid var(--border-1)",
    background: "var(--surface-1)",
    color: "var(--fg-4)",
    cursor: "pointer",
    padding: 0,
  };

  return (
    <button
      type="button"
      title={`Day ${node.day} · ${PATHWAY_COMING_SOON_MESSAGE.toLowerCase()}`}
      aria-label={`Day ${node.day}, ${PATHWAY_COMING_SOON_MESSAGE.toLowerCase()}`}
      onClick={onTap}
      style={base}
    >
      {node.day}
    </button>
  );
}

export function Pathway() {
  const levels = buildPathway();
  const [notice, setNotice] = useState<string | null>(null);

  const showComingSoon = useCallback(() => {
    setNotice(PATHWAY_COMING_SOON_MESSAGE);
    window.setTimeout(() => setNotice(null), 2400);
  }, []);

  return (
    <section
      aria-label="Lesson pathway"
      tabIndex={0}
      style={{
        width: "100%",
        maxWidth: "min(420px, calc(100vw - 40px))",
        maxHeight: "clamp(160px, 30vh, 240px)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "var(--s4)",
        position: "relative",
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: "12px",
          color: "var(--fg-3)",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        Pathway
      </div>

      {notice && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            alignSelf: "center",
            fontFamily: mono,
            fontSize: "11px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--fg-2)",
            background: "var(--surface-2)",
            border: "1px solid var(--border-2)",
            borderRadius: "999px",
            padding: "6px 12px",
          }}
        >
          {notice}
        </div>
      )}

      {levels.map((level) => (
        <div
          key={level.level}
          style={{ display: "flex", flexDirection: "column", gap: "var(--s2)" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              fontFamily: mono,
              fontSize: "11px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--fg-3)",
            }}
          >
            <span>
              L{level.level} &middot; {level.name}
            </span>
            <span style={{ color: "var(--fg-4)" }}>Coming soon</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
            {level.nodes.map((node, i) => (
              <div key={node.day} style={{ display: "contents" }}>
                {i > 0 && (
                  <div
                    aria-hidden="true"
                    style={{
                      flex: 1,
                      height: "1px",
                      minWidth: "4px",
                      background: "var(--border-1)",
                    }}
                  />
                )}
                <Node node={node} onTap={showComingSoon} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
