import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Lowers next build's peak memory during webpack compilation (at some
  // cost to compile time) — worth it on the small-VPS deploy target this
  // app builds on, where the default already needs a raised Node heap cap
  // (see BUILD_MAX_OLD_SPACE_MB) just to avoid OOMing.
  experimental: {
    webpackMemoryOptimizations: true,
  },
  // The Dockerfile's own `typecheck` stage already runs both of these
  // (as a fast pre-check ahead of the real build, via scripts/rebuild.sh)
  // — redoing them here inside `next build` itself is pure duplicated
  // memory/time on a box already tight on both.
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
