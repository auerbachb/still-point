"use client";

import { useState, useEffect, useRef } from "react";

type ThoughtCaptureProps = {
  onSave: (text: string) => void;
  onCancel: () => void;
};

export function ThoughtCapture({ onSave, onCancel }: ThoughtCaptureProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSave = () => {
    if (text.trim()) {
      onSave(text.trim());
      setText("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") onCancel();
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "10px",
      padding: "16px 20px", background: "var(--accent-amber-bg-faint)",
      border: "1px solid var(--accent-amber-bg)", borderRadius: "12px",
      width: "100%", maxWidth: "min(380px, calc(100vw - 40px))", animation: "fadeIn 0.2s ease",
    }}>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="thought I need to not forget"
        style={{
          background: "var(--overlay-bg)",
          border: "1px solid var(--accent-amber-border-subtle)",
          borderRadius: "8px", padding: "10px 14px", color: "var(--fg)",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          fontSize: "15px", fontStyle: "italic", outline: "none",
          width: "100%", boxSizing: "border-box" as const,
        }}
      />
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={{
          background: "none", border: "none",
          color: "var(--fg-4)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase",
          cursor: "pointer", padding: "6px 12px",
        }}>
          skip
        </button>
        <button type="button" onClick={handleSave} style={{
          background: "var(--accent-amber-bg)",
          border: "1px solid var(--accent-amber-muted)",
          color: "var(--accent-amber)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase",
          cursor: "pointer", padding: "6px 16px", borderRadius: "12px",
        }}>
          save &amp; clear
        </button>
      </div>
    </div>
  );
}
