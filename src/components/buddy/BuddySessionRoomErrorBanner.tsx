export function BuddySessionRoomErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      style={{
        margin: "0 0 var(--s3)",
        fontSize: "12px",
        color: "var(--fg-2)",
        textAlign: "center",
        lineHeight: 1.45,
      }}
    >
      {message}
    </p>
  );
}
