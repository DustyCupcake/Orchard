import { builtinModules } from "node:module";
import type { NextConfig } from "next";

// Next.js compiles `src/instrumentation.ts` twice: once for the nodejs
// runtime, once for edge. It only needs the edge copy when the app
// actually has edge routes — `next build` gates on that
// (`edgeRuntimeAppCount || edgeRuntimePagesCount`, in
// next/dist/build/index.js), and this app has none, so production never
// builds it and `next build` is clean.
//
// `next dev` does not apply that gate. It compiles the instrumentation
// hook under the edge config, which externalizes no Node builtins, and
// `register()`'s `process.env.NEXT_RUNTIME !== "nodejs"` guard does not
// help: webpack resolves every `import()` target at parse time, whether
// or not the branch is reachable. So the hook's dynamic imports — which
// reach node-cron, Postgres, and nodemailer — fail to resolve, and
// because instrumentation is compiled at server start and Next then
// serves that failure as the response, *every* page returns 500 with an
// error about Node builtins. `/login` included.
//
// So the edge compile is given the Node builtins as externals. The code
// it pulls in is node-only and never executes on edge — the runtime
// guard is what guarantees that, and it's the same guard production
// relies on — so this only needs the compile to succeed, not to be
// correct. `builtinModules` is read from Node rather than hardcoded, so
// it can't drift out of sync with the runtime.
//
// Reached by: instrumentation.ts → @/lib/tasks → tasks/nominations.ts →
// mailer.ts → nodemailer, whose base64/mime helpers do
// `require('stream')` at module scope. `serverExternalPackages` does
// NOT fix this — verified by adding an invalid key beside it and
// confirming Next validates and reads this file, so the option really is
// applied; Next's optOutBundlingPackages just isn't wired into the
// instrumentation compilation. Nor is it a 15.5.x regression: 15.5.26
// fails identically.
//
// Both spellings are needed: `builtinModules` yields bare names
// ("crypto"), but the request webpack actually has to match is the
// prefixed form ("node:crypto"), and externals match on the request
// string exactly. Subpath builtins ("fs/promises") are already in the
// list Node returns.
const NODE_BUILTIN_EXTERNALS = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

const nextConfig: NextConfig = {
  output: "standalone",
  webpack: (config, { isServer, nextRuntime }) => {
    if (isServer && nextRuntime === "edge") {
      const externals = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [...externals, ...NODE_BUILTIN_EXTERNALS];
    }
    return config;
  },
  // Lowers next build's peak memory during webpack compilation (at some
  // cost to compile time) — worth it on the small-VPS deploy target this
  // app builds on, where the default already needs a raised Node heap cap
  // (see BUILD_MAX_OLD_SPACE_MB) to just avoid OOMing.
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
