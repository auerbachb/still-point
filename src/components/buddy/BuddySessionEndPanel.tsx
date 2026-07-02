import { btnPrimary } from "./buddySessionRoomStyles";

type BuddySessionEndPanelProps = {
  title: string;
  body: string;
  primary: { label: string; onClick: () => void };
};

export function BuddySessionEndPanel({ title, body, primary }: BuddySessionEndPanelProps) {
  return (
    <div
      style={{
        textAlign: "center",
        display: "grid",
        gap: "var(--s3)",
        padding: "var(--s4) 0",
      }}
    >
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: "20px", color: "var(--fg)" }}>{title}</h3>
      <p style={{ margin: 0, color: "var(--fg-2)", lineHeight: 1.5, fontSize: "14px" }}>{body}</p>
      <button type="button" onClick={primary.onClick} style={btnPrimary}>
        {primary.label}
      </button>
    </div>
  );
}
