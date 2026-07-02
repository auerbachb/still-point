const DEMO_VIDEO = {
  poster: "/video/still-point-demo-poster.jpg",
  webm: "/video/still-point-demo.webm",
  mp4: "/video/still-point-demo.mp4",
  captions: "/video/still-point-demo.vtt",
} as const;

export function HomepageDemoVideo() {
  return (
    <section
      aria-labelledby="homepage-demo-heading"
      style={{
        maxWidth: "780px",
        margin: "0 auto",
        width: "100%",
        paddingTop: "var(--s6)",
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
            fontFamily: "var(--font-mono)",
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
          background: "var(--surface-1)",
        }}
      >
        <video
          controls
          preload="none"
          poster={DEMO_VIDEO.poster}
          playsInline
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            verticalAlign: "middle",
          }}
        >
          <source src={DEMO_VIDEO.webm} type="video/webm" />
          <source src={DEMO_VIDEO.mp4} type="video/mp4" />
          <track
            kind="captions"
            src={DEMO_VIDEO.captions}
            srcLang="en"
            label="English"
            default
          />
          Your browser does not support embedded video.
        </video>
      </div>
    </section>
  );
}
