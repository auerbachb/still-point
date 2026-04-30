import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : "";
  } catch {
    return "";
  }
}

function nonBlankEnv(v: string | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
}

function shortGitSha(full: string | undefined): string {
  if (!full) return "";
  const t = full.trim();
  if (!t) return "";
  return t.length > 7 ? t.slice(0, 7) : t;
}

function tryGitHead(): string {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const buildShaFull =
  nonBlankEnv(process.env.VERCEL_GIT_COMMIT_SHA) ??
  nonBlankEnv(process.env.NEXT_PUBLIC_BUILD_SHA) ??
  nonBlankEnv(process.env.SOURCE_VERSION) ??
  nonBlankEnv(tryGitHead()) ??
  "";

const nextConfig: NextConfig = {
  // Externalize Neon's WS driver and `ws` so Next does not bundle them.
  // Bundling tree-shakes `ws`'s mask path on Vercel and crashes every
  // `poolDb.transaction()` with `b.mask is not a function`. See #246.
  serverExternalPackages: ["@neondatabase/serverless", "ws"],
  env: {
    NEXT_PUBLIC_APP_VERSION: readPackageVersion(),
    NEXT_PUBLIC_BUILD_SHA: shortGitSha(buildShaFull),
  },
};

export default nextConfig;
