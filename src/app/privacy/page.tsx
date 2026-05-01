import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Still Point",
  description:
    "How Still Point collects, uses, stores, and protects your information when you use our website and apps.",
  alternates: {
    canonical: "https://www.still-point.me/privacy",
  },
};

const sectionTitle: CSSProperties = {
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "12px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--accent-green-text)",
  marginBottom: "var(--s2)",
  marginTop: "var(--s5)",
};

const body: CSSProperties = {
  fontSize: "clamp(16px, 2vw, 18px)",
  lineHeight: 1.65,
  color: "var(--fg-2)",
};

const list: CSSProperties = {
  ...body,
  paddingLeft: "1.25em",
  display: "grid",
  gap: "var(--s2)",
  marginTop: "var(--s3)",
};

export default function PrivacyPolicyPage() {
  return (
    <div
      style={{
        minHeight: "100%",
        fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
        padding: "var(--s4)",
        paddingBottom: "var(--s6)",
      }}
    >
      <header
        style={{
          maxWidth: "720px",
          margin: "0 auto var(--s5)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--s3)",
        }}
      >
        <Link
          href="/"
          style={{
            fontSize: "22px",
            fontStyle: "italic",
            color: "var(--fg)",
          }}
        >
          Still Point
        </Link>
        <Link
          href="/app"
          style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontSize: "12px",
            color: "var(--fg)",
            border: "1px solid var(--border-2)",
            padding: "10px 14px",
            borderRadius: "999px",
          }}
        >
          Open App
        </Link>
      </header>

      <article
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        <h1
          style={{
            fontSize: "clamp(32px, 6vw, 44px)",
            fontWeight: 300,
            lineHeight: 1.15,
            color: "var(--fg)",
            marginBottom: "var(--s2)",
          }}
        >
          Privacy Policy
        </h1>
        <p style={{ ...body, color: "var(--fg-3)", fontSize: "15px", marginBottom: "var(--s5)" }}>
          Effective date: April 10, 2026. This policy describes how Still Point (“we,” “us”) handles
          information when you use the website and services available at{" "}
          <a href="https://www.still-point.me" style={{ color: "var(--accent-green-text)", textDecoration: "underline" }}>
            https://www.still-point.me
          </a>{" "}
          (the “Service”).
        </p>

        <h2 style={sectionTitle}>Information we collect</h2>
        <p style={body}>
          We collect information you provide and limited technical data needed to run the Service.
        </p>
        <ul style={list}>
          <li>
            <strong style={{ color: "var(--fg)" }}>Account and profile.</strong> Email address,
            username, and any combination of a password hash (we do not store your password in plain
            text) and links to single sign-on providers you have used to sign in.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Session and practice data.</strong> Meditation
            session records such as day number, duration, completion status, timing details, and
            optional “mind state” notes you log during a session.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Thoughts and journal entries.</strong> Text you
            choose to save as thoughts or notes associated with your sessions.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Sign-in session.</strong> When you are logged in,
            we use an HTTP-only cookie to keep your session active and associate requests with your
            account.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Technical data.</strong> Standard server and
            hosting logs (for example IP address, browser type, and request timestamps) that our
            infrastructure providers process when you use the Service.
          </li>
        </ul>

        <h2 style={sectionTitle}>How we use your information</h2>
        <p style={body}>We use the information above to:</p>
        <ul style={list}>
          <li>Create and maintain your account and authenticate you.</li>
          <li>Provide the Still Point meditation experience, including history, progress, and related features you enable.</li>
          <li>Operate, secure, troubleshoot, and improve the Service.</li>
          <li>Comply with law and respond to valid legal requests when required.</li>
        </ul>

        <h2 style={sectionTitle}>Storage and security</h2>
        <p style={body}>
          Your account and application data are stored in a PostgreSQL database hosted with{" "}
          <a
            href="https://neon.tech"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent-green-text)", textDecoration: "underline" }}
          >
            Neon
          </a>
          . The web application is hosted on{" "}
          <a
            href="https://vercel.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent-green-text)", textDecoration: "underline" }}
          >
            Vercel
          </a>
          . We use industry-standard practices we reasonably can, including encrypted connections
          (HTTPS), hashed passwords, and access controls on our systems. No method of transmission or
          storage is completely secure; we work to protect your information but cannot guarantee
          absolute security.
        </p>

        <h2 style={sectionTitle}>Sharing and sale of data</h2>
        <p style={body}>
          We do not sell your personal information. We do not share it for cross-context behavioral
          advertising. We share information only as needed to operate the Service with trusted
          service providers who process it on our behalf (for example cloud hosting and database
          infrastructure), under agreements that require them to protect your information and use it
          only for the services they provide to us. We may also disclose information if required by
          law, legal process, or to protect the rights, safety, or integrity of our users or the
          Service.
        </p>

        <h2 style={sectionTitle}>Third-party sign-in</h2>
        <p style={body}>
          You can sign in to Still Point with a third-party identity provider in addition to (or
          instead of) creating a password. When you choose a provider, we receive an email address
          (which the provider verifies where supported), your name when available, and a stable
          provider account identifier so we can link the provider to your Still Point account on
          subsequent sign-ins. We do not store your provider password and we do not request access
          to your contacts, calendar, files, or other provider data through sign-in. The provider's
          own privacy practices apply to anything you do on their site.
        </p>
        <ul style={list}>
          <li>
            <strong style={{ color: "var(--fg)" }}>Google:</strong>{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent-green-text)", textDecoration: "underline" }}
            >
              Google Privacy Policy
            </a>
            .
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Apple:</strong>{" "}
            <a
              href="https://www.apple.com/legal/privacy/data/en/sign-in-with-apple/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent-green-text)", textDecoration: "underline" }}
            >
              Sign in with Apple: how we handle your data
            </a>
            .
          </li>
        </ul>

        <h2 style={sectionTitle}>Retention and your choices</h2>
        <p style={body}>
          We retain your information for as long as your account is active and as needed to provide
          the Service, comply with legal obligations, resolve disputes, and enforce our agreements.
          You may request access to, correction of, or deletion of your personal information, or ask
          questions about this policy, using the contact information below. We will respond in line
          with applicable law. If you opt into features that make certain information visible to
          others (for example a public profile), you can change those settings in the app where
          available; some data may remain visible until you update settings or we process a deletion
          request.
        </p>

        <h2 style={sectionTitle}>Children</h2>
        <p style={body}>
          The Service is not directed at children under 13, and we do not knowingly collect personal
          information from children under 13. If you believe we have collected such information,
          please contact us and we will take appropriate steps to delete it.
        </p>

        <h2 style={sectionTitle}>Changes to this policy</h2>
        <p style={body}>
          We may update this Privacy Policy from time to time. We will post the updated version on
          this page and revise the effective date above. If changes are material, we will provide
          additional notice as appropriate.
        </p>

        <h2 style={sectionTitle}>Contact</h2>
        <p style={body}>
          For privacy-related requests or questions about this policy, contact Bretton Auerbach via{" "}
          <a
            href="https://brettonauerbach.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent-green-text)", textDecoration: "underline" }}
          >
            brettonauerbach.com
          </a>
          . Please include “Still Point privacy” in your message so we can help you promptly.
        </p>
      </article>
    </div>
  );
}
