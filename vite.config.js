import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// The site lives in /web and builds to /dist.
// base './' keeps paths relative, so it works on
// https://pratapjewellers1997.github.io/pj-portal/ and on a custom domain later.

/** Stamp sw.js with a build hash so the cache auto-invalidates on every deploy. */
function swVersionPlugin() {
  return {
    name: 'sw-version',
    writeBundle() {
      const hash = Date.now().toString(36);
      const swPath = resolve(__dirname, 'dist', 'sw.js');
      try {
        let sw = readFileSync(swPath, 'utf8');
        sw = sw.replace(/pj-shell-v\w+/, `pj-shell-${hash}`);
        writeFileSync(swPath, sw);
      } catch { /* sw.js not in dist — skip */ }
    },
  };
}

export default defineConfig({
  root: 'web',
  base: './',
  envDir: '..',
  plugins: [swVersionPlugin()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },  // firebase chunk loads only for chat
});
