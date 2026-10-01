import nextVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextVitals,
  {
    // New React Compiler rules in Next 16's config. They flag patterns the app
    // already used safely under Next 14, so report them without failing the build.
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];
