#!/usr/bin/env node

const blockedHosts = [
  "still-point.me",
  "www.still-point.me",
];

const blockedPatterns = [];
if (process.env.E2E_ALLOW_VERCEL_PREVIEW !== "true") {
  blockedPatterns.push(/\.vercel\.app$/i);
}

function parseHost(rawUrl) {
  if (!rawUrl) {
    return null;
  }
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    console.warn(`E2E environment guard warning: could not parse URL '${rawUrl}'.`);
    return null;
  }
}

const candidateUrls = [
  process.env.E2E_BASE_URL,
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
].filter(Boolean);

const hosts = candidateUrls
  .map((value) => parseHost(value))
  .filter((value) => Boolean(value));

if (hosts.length === 0) {
  console.error(
    "E2E environment guard failed: set E2E_BASE_URL (preferred) or NEXT_PUBLIC_APP_URL to an explicit non-production host.",
  );
  process.exit(1);
}

for (const host of hosts) {
  if (blockedHosts.includes(host) || blockedPatterns.some((pattern) => pattern.test(host))) {
    console.error(`E2E environment guard failed: refusing to run against protected host '${host}'.`);
    process.exit(1);
  }
}

console.log(`E2E environment guard passed for host(s): ${hosts.join(", ")}`);
