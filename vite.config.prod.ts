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
      const viteEnv = process.env.VITE_ENV || 'production';

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

// https://vite.dev/config/
export default defineConfig(
  ({ command, mode, ssrBuild }: { command: string; mode: string; ssrBuild: boolean }) => {
    // Get port from CLI args if provided
    const cliPort = process.env.PORT ? parseInt(process.env.PORT) : undefined;

    return {
      // SOLUTION PART 1: Force Vite to pre-bundle the problematic dependencies
      optimizeDeps: {
        include: [
          // The main library that uses `require`
          '@tarobase/js-sdk',
          // Its internal dependencies that it tries to `require`
          '@privy-io/react-auth',
          '@privy-io/react-auth/solana',
        ],
      },
      build: {
        minify: true,
        chunkSizeWarningLimit: 1500,
        commonjsOptions: {
          transformMixedEsModules: true,
        },
        rollupOptions: {
          onwarn(warning, warn) {
            if (warning?.code === 'EVAL' && warning?.loc?.file?.includes('vm-browserify')) {
              return;
            }
            if (warning?.message?.includes('annotation that Rollup cannot interpret')) {
              return;
            }
            warn(warning);
          },
          output: {
            manualChunks: {
              vendor: ['react', 'react-dom'],
              tarobase: ['@tarobase/js-sdk'],
            },
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
          perf_hooks: false,
          v8: false,
        },
      },
      server: {
        port: cliPort || fallbackPort,
        allowedHosts: true,
        historyApiFallback: true,
      },
    };
  },
);
