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
        // Monochrome: the accent is ink. Links and hovers darken rather than turn a color.
        accent: {
          DEFAULT: '#171717',
          light: '#525252',
        },
        nvidia: {
          DEFAULT: '#171717',
          light: '#525252',
        },
      },
      backgroundColor: {
        surface: '#fafafa',
      },
    },
  },
  plugins: [],
};
