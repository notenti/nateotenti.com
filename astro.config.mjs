import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [tailwind(), mdx()],
  site: 'https://www.nateotenti.com',
  // Fetch a page when its link is hovered or tapped, so the click lands instantly.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  image: {
    domains: ['images.nateotenti.com'],
  },
});
