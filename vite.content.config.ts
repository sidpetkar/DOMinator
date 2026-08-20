import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/**
 * Build 2 of 2 — the content script.
 *
 * MV3 content scripts are classic scripts, so this is a single-entry IIFE with
 * no code splitting. Our Tailwind bundle is pulled in as a *string* (see
 * src/content/overlay.css?inline) and adopted by the Shadow DOM at runtime, so
 * nothing is injected into the host page's document.
 */
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/content/index.tsx', import.meta.url)),
      formats: ['iife'],
      name: 'DOMinator',
      fileName: () => 'content.js',
    },
  },
})
