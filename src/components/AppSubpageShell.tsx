"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useIsMobile } from "@/lib/useIsMobile";

type AppSubpageShellProps = {
  title: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
};

export function AppSubpageShell({
  title,
  backHref = "/app",
  backLabel = "Back to app",
  children,
}: AppSubpageShellProps) {
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "var(--font-serif)",
        padding: isMobile
          ? "var(--s4) var(--s3) calc(var(--s4) + env(safe-area-inset-bottom, 0px))"
          : "var(--s4) var(--s4)",
        width: "100%",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "min(520px, calc(100vw - 32px))",
          display: "flex",
          flexDirection: "column",
          gap: "var(--s4)",
        }}
      >
        <Link
          href={backHref}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--fg-3)",
            textDecoration: "none",
            alignSelf: "flex-start",
          }}
        >
          ← {backLabel}
        </Link>
        <h1
          style={{
            fontSize: isMobile ? "26px" : "32px",
            fontWeight: 300,
            fontStyle: "italic",
            margin: 0,
            color: "var(--fg)",
            textAlign: "center",
          }}
        >
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
