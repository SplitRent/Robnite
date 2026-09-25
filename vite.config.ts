import { defineConfig } from 'vite';

// Relative base so the production build works from any GitHub Pages sub-path
// (https://<user>.github.io/<repo>/) as well as from a local static server.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/scratch/**', 'node_modules/**'],
  },
} as import('vite').UserConfig);
