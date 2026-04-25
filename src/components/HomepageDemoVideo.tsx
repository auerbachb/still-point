/**
 * Optional homepage embed: set `STILLPOINT_HOMEPAGE_YOUTUBE_VIDEO_ID` to an
 * 11-character YouTube video id. Unset, empty, or invalid id renders nothing
 * (scaffolding only until the asset exists).
 */
const YOUTUBE_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

export function HomepageDemoVideo() {
  const raw = process.env.STILLPOINT_HOMEPAGE_YOUTUBE_VIDEO_ID?.trim();
  if (!raw || !YOUTUBE_VIDEO_ID.test(raw)) {
    return null;
  }

  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(raw)}?rel=0`;

  return (
    <section
      aria-labelledby="homepage-demo-heading"
      style={{
        width: "100%",
        minWidth: 0,
        marginTop: "var(--s3)",
        display: "grid",
        gap: "var(--s3)",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: "var(--s2)",
          maxWidth: "62ch",
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontSize: "12px",
            color: "var(--fg-3)",
          }}
        >
          How it works
        </p>
        <h2
          id="homepage-demo-heading"
          style={{
            margin: 0,
            fontSize: "clamp(26px, 5vw, 40px)",
            fontWeight: 300,
            lineHeight: 1.1,
            color: "var(--fg)",
          }}
        >
          Watch a one-minute sit turn into a daily rhythm.
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: "clamp(16px, 2.2vw, 19px)",
            color: "var(--fg-2)",
            lineHeight: 1.55,
          }}
        >
          See how Still Point starts small, fills each session block by block, and gradually extends your practice without making meditation feel like another task.
        </p>
      </div>

      <div
        style={{
          width: "100%",
          minWidth: 0,
          maxWidth: "720px",
          boxSizing: "border-box",
          borderRadius: "12px",
          overflow: "hidden",
          border: "1px solid var(--border-2)",
          position: "relative",
          aspectRatio: "16 / 9",
          background: "var(--surface-1)",
        }}
      >
        <iframe
          title="How Still Point works"
          src={src}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: "none",
          }}
        />
      </div>
    </section>
  );
}
