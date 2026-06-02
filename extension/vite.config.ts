import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: 'es2022',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: 'src/offscreen.html',
        widget: 'src/widget/index.html',
      },
    },
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});
