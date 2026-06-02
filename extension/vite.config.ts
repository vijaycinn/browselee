import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: './src/background.ts',
      name: 'browselee-ext',
      formats: ['es'],
      fileName: () => '[name].js',
    },
    outDir: './dist',
    minify: false,
  },
});
