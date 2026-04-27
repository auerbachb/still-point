import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Externalize Neon's WS driver and `ws` so Next does not bundle them.
  // Bundling tree-shakes `ws`'s mask path on Vercel and crashes every
  // `poolDb.transaction()` with `b.mask is not a function`. See #246.
  serverExternalPackages: ["@neondatabase/serverless", "ws"],
};

export default nextConfig;
