/**
 * Optional homepage embed: set `STILLPOINT_HOMEPAGE_YOUTUBE_VIDEO_ID` to an
 * 11-character YouTube video id. Unset, empty, or invalid id → renders nothing
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
    <div
      style={{
        width: "100%",
        maxWidth: "min(100%, 720px)",
        margin: "0 auto",
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
  );
}
