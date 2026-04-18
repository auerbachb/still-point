import type { Metadata } from "next";
import Link from "next/link";
import { Newsreader, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["300", "400", "500"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://still-point.me"),
  title: "Still Point",
  description:
    "Build steadier focus with a guided one-minute meditation practice designed for real, distractible days.",
  openGraph: {
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 724,
        height: 724,
      },
    ],
  },
  twitter: {
    card: "summary",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${newsreader.variable} ${jetbrainsMono.variable}`}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
          <main style={{ flex: 1 }}>{children}</main>
          <footer
            style={{
              padding: "14px 20px",
              borderTop: "1px solid var(--border-1)",
              color: "var(--fg-3)",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px",
              letterSpacing: "0.03em",
              textAlign: "center",
            }}
          >
            © Bretton Auerbach 2026 |{" "}
            <a href="https://brettonauerbach.com" style={{ color: "inherit" }}>
              brettonauerbach.com
            </a>
            {" | "}
            <Link
              href="/privacy"
              prefetch={false}
              style={{
                color: "inherit",
                textDecoration: "underline",
                textUnderlineOffset: "2px",
              }}
            >
              Privacy Policy
            </Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
