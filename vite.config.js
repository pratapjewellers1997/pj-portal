import { defineConfig } from 'vite';

// The site lives in /web and builds to /dist.
// base './' keeps paths relative, so it works on
// https://pratapjewellers1997.github.io/pj-portal/ and on a custom domain later.
export default defineConfig({
  root: 'web',
  base: './',
  envDir: '..',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },  // firebase chunk loads only for chat
});
