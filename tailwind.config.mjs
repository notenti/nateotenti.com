const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        // One family for everything; hierarchy comes from size and weight.
        sans: ['Allo', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // The grey scale, paper and ink come from CSS variables (src/styles/global.css)
        // so the whole palette flips in dark mode without dark: variants.
        neutral: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, v(`--neutral-${n}`)]),
        ),
        white: v('--paper'),
        black: v('--ink'),
        // Monochrome: the accent is ink. Links and hovers darken rather than turn a color.
        accent: {
          DEFAULT: v('--neutral-900'),
          light: v('--neutral-600'),
        },
        nvidia: {
          DEFAULT: v('--neutral-900'),
          light: v('--neutral-600'),
        },
      },
      backgroundColor: {
        surface: v('--neutral-50'),
      },
    },
  },
  plugins: [],
};
