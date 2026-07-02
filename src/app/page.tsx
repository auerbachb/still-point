import Link from "next/link";
import { HomepageDemoVideo } from "@/components/HomepageDemoVideo";

export default function LandingPage() {
  const appStoreUrl = process.env.NEXT_PUBLIC_APP_STORE_URL;

  return (
    <main
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-serif)",
        padding: "var(--s4)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--s6)",
        }}
      >
        <div
          style={{
            fontSize: "22px",
            fontStyle: "italic",
            color: "var(--fg)",
          }}
        >
          Still Point
        </div>
        <Link
          href="/app"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontSize: "12px",
            color: "var(--fg)",
            border: "1px solid var(--border-2)",
            padding: "10px 14px",
            borderRadius: "999px",
            transition: "border-color 0.2s ease",
          }}
        >
          Login
        </Link>
      </header>

      <section
        style={{
          maxWidth: "780px",
          margin: "0 auto",
          width: "100%",
          display: "grid",
          gap: "var(--s4)",
        }}
      >
        <h1
          style={{
            fontSize: "clamp(36px, 8vw, 72px)",
            fontWeight: 300,
            lineHeight: 1.05,
            color: "var(--fg)",
          }}
        >
          Train attention.
          <br />
          Return to stillness.
        </h1>
        <p
          style={{
            maxWidth: "62ch",
            fontSize: "clamp(17px, 2.5vw, 22px)",
            color: "var(--fg-2)",
            lineHeight: 1.55,
          }}
        >
          Still Point is a meditation timer for people struggling to get started and stay consistent: it begins at one minute, adds ten seconds per day, and shows time as boxes that fill up as you go to make sitting still easier.
        </p>
        <div
          style={{
            display: "flex",
            gap: "var(--s3)",
            flexWrap: "wrap",
            marginTop: "var(--s2)",
          }}
        >
          <Link
            href="/app"
            style={{
              background: "linear-gradient(180deg, var(--accent-green), var(--accent-green-end))",
              color: "rgb(var(--bg-rgb))",
              border: "none",
              borderRadius: "999px",
              padding: "12px 20px",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontSize: "12px",
              fontWeight: 500,
            }}
          >
            Open App
          </Link>
          {appStoreUrl ? (
            <a
              href={appStoreUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Download on the App Store"
              style={{
                display: "inline-flex",
                alignItems: "center",
                transition: "opacity 0.2s ease",
              }}
            >
              <img
                src="/app-store-badge.svg"
                alt="Download on the App Store"
                style={{ height: "40px", width: "auto", display: "block" }}
              />
            </a>
          ) : null}
        </div>
      </section>

      <HomepageDemoVideo />
    </main>
  );
}
