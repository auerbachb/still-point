import type { Metadata } from "next";
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
  title: "Still Point",
  description: "Attention training",
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
          </footer>
        </div>
      </body>
    </html>
  );
}
