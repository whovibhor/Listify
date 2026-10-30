/// <reference types="vitest/config" />
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    build: {
      rolldownOptions: {
        output: {
          // Long-lived vendor chunks cache well across deploys; app code changes most often.
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'router', test: /node_modules[\\/](react-router|@remix-run)[\\/]/ },
              { name: 'ui', test: /node_modules[\\/](radix-ui|@radix-ui|@floating-ui)[\\/]/ },
              { name: 'motion', test: /node_modules[\\/](motion|framer-motion|motion-dom)[\\/]/ },
              { name: 'data', test: /node_modules[\\/](@tanstack|zod)[\\/]/ },
            ],
          },
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin API in development so session cookies and CSRF behave like production (ADR-006).
      proxy: { '/api': { target: apiProxyTarget, changeOrigin: false } },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      testTimeout: 15_000,
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      restoreMocks: true,
    },
  }
})
