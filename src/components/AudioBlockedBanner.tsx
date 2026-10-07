import type { CSSProperties } from "react";

const inlineLinkButton: CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--accent-amber)",
  cursor: "pointer",
  font: "inherit",
  padding: 0,
  textDecoration: "underline",
};

type AudioBlockedBannerProps = {
  onEnableLocalAudio: () => void;
};

/** Same "Enable local audio" alert buddy and solo sessions show when playback is blocked. */
export function AudioBlockedBanner({ onEnableLocalAudio }: AudioBlockedBannerProps) {
  return (
    <p
      role="alert"
      style={{
        margin: 0,
        maxWidth: "340px",
        fontSize: "11px",
        color: "var(--accent-amber)",
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        textAlign: "center",
        lineHeight: 1.45,
      }}
    >
      Browser audio is paused.{" "}
      <button type="button" data-no-space-distraction onClick={onEnableLocalAudio} style={inlineLinkButton}>
        Enable local audio
      </button>{" "}
      on this device.
    </p>
  );
}
