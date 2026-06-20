import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  envDir: '../',
  envPrefix: ['VITE_', 'IP_REGION_'],
  resolve: {
    alias: {
      '@blueprintjs/icons/lib/esm/allPaths.js': path.resolve(__dirname, 'src/shims/blueprint-allPaths.ts'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/worker',
      filename: 'sw.ts',
      injectRegister: 'auto',
      registerType: 'autoUpdate',
      manifest: {
        name: 'ObexDNS',
        short_name: 'ObexDNS',
        theme_color: '#1a1b26',
        icons: []
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    }),
    visualizer({ open: false, filename: './stats.html' })
  ],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/world-110m.json': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '^/[a-zA-Z0-9]{6}$': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: '../static',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // 分割图标包，并继续分割 20px 和 16px 图标，减少编译后主包体积
            if (/[\\/]node_modules[\\/]@blueprintjs[\\/]icons/.test(id)) {
              if (id.includes('20px')) return 'vendor-icons-20';
              if (id.includes('16px')) return 'vendor-icons-16';
              return 'vendor-icons-other';
            }
            if (id.includes('@blueprintjs/core')) {
              return 'vendor-ui-core';
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            // Exclude recharts from the catch-all so it follows its lazy
            // dynamic-import chain (TrendChart chunk) and is not preloaded.
            if (id.includes('recharts') || id.includes('victory-vendor')) {
              return undefined;
            }
            if (id.includes('i18next')) {
              return 'vendor-i18next';
            }
            return 'vendor-utils';
          }
        },
      },
    },
  },
})
