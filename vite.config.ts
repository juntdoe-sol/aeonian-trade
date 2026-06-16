// @ts-nocheck
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import stdLibBrowser from 'vite-plugin-node-stdlib-browser';

// NOTE: We don't need the `vite-plugin-commonjs` import anymore.
// Vite has a built-in, configurable CommonJS plugin.

// Get port number from directory name as fallback
const dirName = __dirname.split(path.sep).pop() || '';
const portMatch = dirName.match(/server-(\d+)/);
const fallbackPort = portMatch ? parseInt(portMatch[1]) : 3001;

// https://vite.dev/config/
export default defineConfig(() => {
  // Get port from CLI args if provided
  const cliPort = process.env.PORT ? parseInt(process.env.PORT) : undefined;

  // Cache and output directory optimization (use environment variables if set)
  const cacheDir = process.env.VITE_POOF_CACHEDIR || path.resolve(__dirname, 'node_modules/.vite');
  const outDir = process.env.VITE_POOF_OUTDIR || path.resolve(__dirname, 'dist');

  // Plugin to inject console shim and component inspector
  const poofShimsPlugin = (): Plugin => {
    return {
      name: 'inject-poof-shims',
      transformIndexHtml(html) {
        const consoleShimPath = path.resolve(__dirname, 'console-shim.js');
        const componentInspectorPath = path.resolve(__dirname, 'component-inspector.js');
        let consoleShimCode = '';
        let componentInspectorCode = '';

        try {
          consoleShimCode = fs.readFileSync(consoleShimPath, 'utf-8');
        } catch (e) {
          console.warn('Console shim file not found, skipping injection');
        }

        try {
          componentInspectorCode = fs.readFileSync(componentInspectorPath, 'utf-8');
        } catch (e) {
          console.warn('Component inspector file not found, skipping injection');
        }

        // Get VITE_ENV from environment
        const viteEnv = process.env.VITE_ENV || 'development';

        // Inject the shims as inline scripts in the head
        // This ensures they run before any other scripts
        // Also inject VITE_ENV as a global variable
        let scripts = `<head>\n    <script>\n      window.__VITE_ENV__ = '${viteEnv}';\n`;
        if (consoleShimCode) scripts += consoleShimCode + '\n';
        if (componentInspectorCode) scripts += componentInspectorCode + '\n';
        scripts += '    </script>';

        return html.replace('<head>', scripts);
      },
    };
  };

  return {
    cacheDir,
    // SOLUTION PART 1: Force Vite to pre-bundle the problematic dependencies
    optimizeDeps: {
      include: [
        // The main library that uses `require`
        '@pooflabs/web',
        // Its internal dependencies that it tries to `require`
        '@privy-io/react-auth',
        '@privy-io/react-auth/solana',
        // Solana optional peer dependencies - must be explicitly included
        // to prevent Vite from creating stubs for optional peer deps
        '@solana-program/system',
        '@solana-program/memo',
        '@solana-program/token',
        '@solana/kit',
      ],
    },
    build: {
      outDir,
      minify: process.env.BUILD_PROFILE === 'production',
      sourcemap: false,
      // Skip gzip size calculation for faster builds
      reportCompressedSize: false,
      // Single CSS file for faster bundling
      cssCodeSplit: false,
      chunkSizeWarningLimit: 1500,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
      rollupOptions: {
        // Mark optional Solana dependencies as external - they're not needed and
        // using `false` as an alias causes Rollup to try to open a file called "false"
        external: [
          'perf_hooks',
          'v8',
        ],
        treeshake: process.env.BUILD_PROFILE === 'production',
        onwarn(warning: any, warn: any) {
          if (warning?.code === 'EVAL' && warning?.loc?.file?.includes('vm-browserify')) {
            return;
          }
          if (warning?.message?.includes('annotation that Rollup cannot interpret')) {
            return;
          }
          warn(warning);
        },
        output: {
          // Only split chunks in production builds
          ...(process.env.BUILD_PROFILE === 'production' && {
            manualChunks: {
              vendor: ['react', 'react-dom'],
              poof: ['@pooflabs/web'],
            },
          }),
        },
      },
    },
    plugins: [
      poofShimsPlugin(),
      react(),
      stdLibBrowser(),
      // We removed the separate commonjs() plugin call. We use the built-in `build.commonjsOptions` instead.
    ],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@tarobase/js-sdk': '@pooflabs/web',
        '@tarobase/server': '@pooflabs/server',
        '@tarobase/core': '@pooflabs/core',
        // Force resolve Solana optional peer dependencies to actual packages
        // Prevents Vite from creating __vite-optional-peer-dep stubs during production builds
        '@solana-program/system': path.resolve(__dirname, 'node_modules/@solana-program/system'),
        '@solana-program/memo': path.resolve(__dirname, 'node_modules/@solana-program/memo'),
        '@solana-program/token': path.resolve(__dirname, 'node_modules/@solana-program/token'),
        '@solana/kit': path.resolve(__dirname, 'node_modules/@solana/kit'),
        // Force all React imports to use the same instance
        // Prevents ESM/CJS module format mismatches that cause createElement errors
        'react': path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
        'react-dom/client': path.resolve(__dirname, 'node_modules/react-dom/client'),
      },
    },
    define: {
      global: 'globalThis',
      // Provide process.env for packages like styled-components that need it
      'process.env': {},
    },
    server: {
      port: cliPort || fallbackPort,
      allowedHosts: true,
      historyApiFallback: true,
    },
  };
});
