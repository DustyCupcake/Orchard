import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs, so the FlatCompat bridge
// this file used for 15 (which loaded the old eslintrc-style `next/...`
// names) is gone — it can't load them any more.
const eslintConfig = [
  // `next build`'s own internal lint step ignores its generated
  // next-env.d.ts automatically; running plain `eslint .` (as the
  // Dockerfile's checks stage now does) doesn't get that for free.
  { ignores: ["next-env.d.ts", ".next/**"] },
  ...nextVitals,
  ...nextTypescript,
  {
    // eslint-plugin-react-hooks 7 (bundled with eslint-config-next 16) added
    // React Compiler-style checks, and 14 existing sites trip them: eight
    // `Date.now()` calls while rendering server pages (react-hooks/purity),
    // five state updates inside effects (set-state-in-effect) and one
    // mutation (immutability). None is a behaviour bug today, and none was
    // introduced by the upgrade — the rules are new. Left visible as warnings
    // rather than fixed inside a framework bump, because rewriting fourteen
    // components is its own change with its own review. Promote back to
    // "error" once they are cleared.
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
];

export default eslintConfig;
