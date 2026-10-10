import { defineConfig } from 'vite';

// Endereço público do site (ex.: SITE_URL=https://trainview.com.br npm run build). Usado na imagem de
// prévia ao compartilhar o link, que o WhatsApp e as redes só aceitam com endereço completo.
const SITE_URL = (process.env.SITE_URL ?? '').replace(/\/+$/, '');

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'og-image-url',
      transformIndexHtml: (html) => html.replaceAll('__OG_IMAGE__', SITE_URL ? `${SITE_URL}/og-image.png` : 'og-image.png'),
    },
  ],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
