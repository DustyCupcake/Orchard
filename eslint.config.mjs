import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  // `next build`'s own internal lint step ignores its generated
  // next-env.d.ts automatically; running plain `eslint .` (as the
  // Dockerfile's checks stage now does) doesn't get that for free.
  { ignores: ["next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
