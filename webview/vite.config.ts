import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      'zlib': path.resolve(__dirname, 'src/lib/stubs/zlib.ts'),
      'iconv-lite': path.resolve(__dirname, 'src/lib/stubs/iconv-lite.ts'),
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4000,
  },
});
