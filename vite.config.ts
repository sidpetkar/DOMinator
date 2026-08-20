import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/**
 * Build 1 of 2 — the background service worker, which may be an ES module and
 * so gets the normal Vite pipeline.
 *
 * The content script cannot be an ES module (MV3 restriction) and is built
 * separately by vite.content.config.ts.
 */
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    modulePreload: false,
    rollupOptions: {
      input: {
        background: fileURLToPath(new URL('./src/background/index.ts', import.meta.url)),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
