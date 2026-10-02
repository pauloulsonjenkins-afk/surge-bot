import type { Config } from "tailwindcss";

/**
 * A theme colour that also works with Tailwind's opacity modifier (bg-hit/15), which plain var() colours
 * silently ignore.
 */
const token =
  (name: string) =>
  ({ opacityValue }: { opacityValue?: string }) =>
    // Without a /NN modifier Tailwind passes its own var(--tw-*-opacity), which is always 1 here.
    opacityValue === undefined || opacityValue === "1" || opacityValue.startsWith("var(--tw-")
      ? `var(--${name})`
      : `color-mix(in srgb, var(--${name}) calc(${opacityValue} * 100%), transparent)`;

const TOKENS = [
  "app",
  "surface",
  "surface-2",
  "line",
  "ink",
  "ink-muted",
  "accent",
  "accent-hover",
  "accent-ink",
  "hit",
  "loss",
  "warn",
  "warn-ink",
  "destructive",
  "danger-ink",
  "chart",
] as const;

export default {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // Tailwind accepts colour functions at runtime, but its types only describe strings.
      colors: Object.fromEntries(TOKENS.map((t) => [t, token(t)])) as unknown as Record<string, string>,
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        // Archivo, used wide (font-stretch 112-115%) for page titles and key numbers.
        display: ["var(--font-display)", "Helvetica Neue", "Arial", "sans-serif"],
      },
      // Buttons, inputs and list rows: the brand's radius-md (8px). Chips and cards keep their own.
      borderRadius: {
        md: "0.5rem",
      },
      /*
       * The type scale. Nothing goes below text-xs (12px).
       *   page title     text-2xl font-semibold (24px) on phones; from lg, text-title font-display font-bold, 115% wide (28px)
       *   section title  text-base font-semibold (16px)
       *   body           text-sm                 (14px)
       *   meta           text-xs                 (12px)
       *   key numbers    text-stat font-display font-bold, 112% wide (28px), money and hit rate alike
       */
      fontSize: {
        title: ["1.75rem", { lineHeight: "2rem", letterSpacing: "-0.01em" }],
        stat: ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.01em" }],
      },
    },
  },
  plugins: [],
} satisfies Config;
