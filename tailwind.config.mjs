/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        accent: {
          DEFAULT: '#76b900',
          light: '#a4d65e',
        },
        nvidia: {
          DEFAULT: '#76b900',
          light: '#a4d65e',
        },
      },
      backgroundColor: {
        surface: '#fafaf8',
      },
    },
  },
  plugins: [],
};
