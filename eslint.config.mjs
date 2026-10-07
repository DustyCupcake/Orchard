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
];

export default eslintConfig;
