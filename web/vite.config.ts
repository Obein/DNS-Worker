import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'

/**
 * Compiles/emits SQLite WASM OPFS async proxy worker directly into the build output
 * without placing any raw .js files into the source tree or public directory.
 */
function sqliteWasmPlugin(): Plugin {
  return {
    name: 'sqlite-wasm-assets',
    generateBundle(this: any) {
      const src = path.resolve(__dirname, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3-opfs-async-proxy.js')
      if (fs.existsSync(src)) {
        const source = fs.readFileSync(src, 'utf-8')
        this.emitFile({
          type: 'asset',
          fileName: 'assets/sqlite3-opfs-async-proxy.js',
          source,
        })
        this.emitFile({
          type: 'asset',
          fileName: 'sqlite3-opfs-async-proxy.js',
          source,
        })
      }
    },
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === '/assets/sqlite3-opfs-async-proxy.js' || req.url === '/sqlite3-opfs-async-proxy.js') {
          const src = path.resolve(__dirname, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3-opfs-async-proxy.js')
          if (fs.existsSync(src)) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
            res.end(fs.readFileSync(src))
            return
          }
        }
        next()
      })
    }
  }
}

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
    sqliteWasmPlugin(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/worker',
      filename: 'sw.ts',
      injectRegister: 'auto',
      registerType: 'autoUpdate',
      manifest: {
        name: 'DNS Worker',
        short_name: 'DNS Worker',
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
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
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
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: {
    format: 'es',
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
            if (id.includes('@sqlite.org/sqlite-wasm')) {
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
