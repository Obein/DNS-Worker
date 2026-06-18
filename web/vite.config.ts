import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Vite plugin that shims the static icon path imports inside
 * @blueprintjs/icons/lib/esm/allPaths.js.
 *
 * allPaths.js statically imports the full 16px and 20px icon path barrels,
 * pulling ~636 kB of SVG data into the initial bundle. We intercept only
 * those two static imports and replace them with empty-object shims.
 *
 * Critically, splitPathsBySizeLoader.js also dynamically imports the same
 * barrels at runtime to serve Icons.load() calls. We must NOT intercept
 * those — they must resolve to the real data so dynamic loading works.
 * The importer check below ensures only allPaths.js is shimmed.
 */
function blueprintIconShimPlugin() {
  const { normalize } = require('path') as typeof import('path');

  // Canonical absolute path of the only file we want to shim imports FROM.
  const ALL_PATHS_FILE = normalize(
    require('path').resolve(__dirname, 'node_modules/@blueprintjs/icons/lib/esm/allPaths.js'),
  );

  // A minimal ES module whose namespace object (`import * as X`) is an empty
  // object — satisfies `import * as IconSvgPaths16 from '...'` without data.
  const EMPTY_NAMESPACE_SHIM = 'export {};\n';

  return {
    name: 'blueprint-icon-shim',
    enforce: 'pre' as const,
    resolveId(id: string, importer?: string) {
      if (!importer) return;
      // Only intercept imports that originate from allPaths.js.
      // splitPathsBySizeLoader.js (the dynamic loader) imports the same paths
      // but must receive the real barrel so Icons.load() works correctly.
      if (normalize(importer) !== ALL_PATHS_FILE) return;
      if (id.includes('16px') && id.includes('paths')) return '\0blueprint-icon-paths-16-shim';
      if (id.includes('20px') && id.includes('paths')) return '\0blueprint-icon-paths-20-shim';
    },
    load(id: string) {
      if (id === '\0blueprint-icon-paths-16-shim' || id === '\0blueprint-icon-paths-20-shim') {
        return EMPTY_NAMESPACE_SHIM;
      }
    },
  };
}


// https://vite.dev/config/
export default defineConfig({
  envDir: '../',
  envPrefix: ['VITE_', 'IP_REGION_'],
  plugins: [
    react(),
    blueprintIconShimPlugin(),
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
