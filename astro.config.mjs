import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://kronibola.com',
  output: 'static',
  integrations: [sitemap({
    filter: (page) => !page.includes('/admin'),
  })],
  devToolbar: { enabled: false },
});
