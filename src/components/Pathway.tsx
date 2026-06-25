"use client";

import { buildPathway, type NodeState, type PathwayNode } from "@/lib/pathway";

type PathwayProps = {
  currentDay: number;
};

const mono = "var(--font-jetbrains), 'JetBrains Mono', monospace";

function levelLabelColor(state: NodeState): string {
  if (state === "completed") return "var(--accent-green-text)";
  if (state === "current") return "var(--accent-amber-text)";
  return "var(--fg-3)";
}

function Node({ node }: { node: PathwayNode }) {
  const base = {
    width: "30px",
    height: "30px",
    flex: "0 0 auto",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: mono,
    fontSize: "11px",
    lineHeight: 1,
    boxSizing: "border-box" as const,
  };

  if (node.state === "completed") {
    return (
      <div
        title={`Day ${node.day} · completed`}
        aria-label={`Day ${node.day}, completed`}
        style={{
          ...base,
          border: "1px solid var(--accent-green-border)",
          background: "var(--accent-green-bg-subtle)",
          color: "var(--accent-green)",
          fontSize: "13px",
        }}
      >
        &#10003;
      </div>
    );
  }

  if (node.state === "current") {
    return (
      <div
        title={`Day ${node.day} · current lesson`}
        aria-label={`Day ${node.day}, current lesson`}
        aria-current="step"
        style={{
          ...base,
          border: "2px solid var(--accent-amber)",
          background: "var(--accent-amber-bg)",
          color: "var(--accent-amber)",
          fontWeight: 600,
          animation: "pathwayPulse 2.4s ease-in-out infinite",
        }}
      >
        {node.day}
      </div>
    );
  }

  return (
    <div
      title={`Day ${node.day} · locked`}
      aria-label={`Day ${node.day}, locked`}
      style={{
        ...base,
        border: "1px solid var(--border-1)",
        background: "var(--surface-1)",
        color: "var(--fg-4)",
      }}
    >
      {node.day}
    </div>
  );
}

export function Pathway({ currentDay }: PathwayProps) {
  const levels = buildPathway(currentDay);

  return (
    <section
      aria-label="Lesson pathway"
      style={{
        width: "100%",
        maxWidth: "min(420px, calc(100vw - 40px))",
        display: "flex",
        flexDirection: "column",
        gap: "var(--s4)",
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

      {levels.map((level) => (
        <div
          key={level.level}
          style={{ display: "flex", flexDirection: "column", gap: "var(--s2)" }}
        >
          {/* Level header */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              fontFamily: mono,
              fontSize: "11px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: levelLabelColor(level.state),
              opacity: level.state === "locked" ? 0.7 : 1,
            }}
          >
            <span>
              L{level.level} &middot; {level.name}
            </span>
            <span style={{ color: "var(--fg-3)" }}>
              {level.completedCount}/{level.nodes.length}
            </span>
          </div>

          {/* Node track */}
          <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
            {level.nodes.map((node, i) => (
              <div
                key={node.day}
                style={{ display: "contents" }}
              >
                {i > 0 && (
                  <div
                    aria-hidden="true"
                    style={{
                      flex: 1,
                      height: "1px",
                      minWidth: "4px",
                      background:
                        node.state === "completed"
                          ? "var(--accent-green-border)"
                          : "var(--border-1)",
                    }}
                  />
                )}
                <Node node={node} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
