import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next 16 builds and serves with Turbopack by default, and refuses to
  // build when a `webpack` function is present with no `turbopack` key — so
  // this empty object is a decision, not a placeholder: it states that this
  // app builds on Turbopack.
  //
  // This file used to carry two webpack-only things, both gone:
  //  - a `webpack` function that externalised Node builtins for the *edge*
  //    compile of src/instrumentation.ts. `next dev` compiled that hook under
  //    the edge config regardless of whether the app had edge routes, and
  //    webpack resolved every dynamic import() at parse time, so every page
  //    500'd ("Node builtins"). Turbopack doesn't hit it: checked, `next dev`
  //    serves pages and the scheduler's jobs register.
  //  - `experimental.webpackMemoryOptimizations`, for the small-VPS build.
  //    Measured on this app, Turbopack builds in ~9s at ~1.7GB peak against
  //    ~37s at ~2.5GB for webpack with that flag, so the saving it was after
  //    comes free.
  // If webpack is ever needed again, `next build --webpack` still works, and
  // the removed workaround is in git history (4314321).
  turbopack: {},
  // The Dockerfile's own `checks` stage already runs lint and tsc (as a fast
  // pre-check ahead of the real build, via scripts/rebuild.sh), so doing it
  // again inside `next build` is duplicated memory and time on a box already
  // tight on both. (Next no longer lints during a build at all as of 16, so
  // there is no `eslint` option to set any more.)
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
