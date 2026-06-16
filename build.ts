// Bun Build Script
// JS bundling with Bun, CSS with Tailwind CLI

import { $ } from "bun";

const VITE_ENV = process.env.VITE_ENV || "PREVIEW";
const BUILD_PROFILE = process.env.BUILD_PROFILE;
const isProduction = BUILD_PROFILE === "production";

// Deployment tier controls build optimization level:
// - 'preview' (draft): unminified, with source maps — easiest to debug
// - 'mainnet-preview': unminified, with source maps — debuggable on real chain
// - 'production' (live): minified, no source maps — optimized for end users
const DEPLOYMENT_TIER = process.env.VITE_DEPLOYMENT_TIER || "preview";
const isProductionTier = DEPLOYMENT_TIER === "production";

// Production config (passed via environment variables during mainnet deploy)
const PROD_TITLE = process.env.VITE_PROD_TITLE || "";
const PROD_FAVICON = process.env.VITE_PROD_FAVICON || "";
const PROD_THEME_COLOR = process.env.VITE_PROD_THEME_COLOR || ""; // Persisted from mobile publish

// Theme color for meta tag and manifest — uses default unless explicitly set via mobile publish
const themeColorHex = PROD_THEME_COLOR || '#0a0a0a';

// Build profiling — logs memory/timing per phase when POOF_BUILD_PROFILE=1
const BUILD_PROFILE_ENABLED = process.env.POOF_BUILD_PROFILE === '1';
function logBuildPhase(phase: string) {
  if (!BUILD_PROFILE_ENABLED) return;
  const mem = process.memoryUsage();
  console.log(`[build-profile] ${phase} | rss=${Math.round(mem.rss / 1024 / 1024)}MB heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB ext=${Math.round(mem.external / 1024 / 1024)}MB | ${new Date().toISOString()}`);
}

logBuildPhase('start');
console.log(`Building for ${VITE_ENV} (production: ${isProduction}, tier: ${DEPLOYMENT_TIER}), theme-color: ${themeColorHex}`);

// Step 1: Clean
await $`rm -rf ./dist && mkdir -p ./dist`.quiet();
logBuildPhase('after-clean');

// Step 2: Copy static assets first (so generated files take precedence)
// Preserve source mtimes so unchanged static files are not re-uploaded by sync.
await $`cp -pR ./public/* ./dist/ 2>/dev/null || true`.quiet();
await $`cp -p ./component-inspector.js ./dist/`.quiet();
await $`cp -p ./console-shim.js ./dist/`.quiet();
logBuildPhase('after-copy-assets');

// Step 3: Build CSS with Tailwind CLI (only minify for production tier)
console.log("Building CSS...");
const cssGlobals = isProductionTier
  ? $`bunx tailwindcss -i ./src/globals.css -o ./dist/globals.css --minify`.quiet()
  : $`bunx tailwindcss -i ./src/globals.css -o ./dist/globals.css`.quiet();
const cssBase = isProductionTier
  ? $`bunx tailwindcss -i ./src/styles/base.css -o ./dist/base.css --minify`.quiet()
  : $`bunx tailwindcss -i ./src/styles/base.css -o ./dist/base.css`.quiet();
await Promise.all([cssGlobals, cssBase]);
logBuildPhase('after-tailwind');

// Step 4: Bundle JS with Bun
console.log("Bundling JS...");
const result = await Bun.build({
  entrypoints: ["./src/main.tsx"],
  outdir: "./dist",
  target: "browser",
  conditions: ["browser", "import"],  // Force ESM resolution to avoid CJS conversion bugs
  minify: isProductionTier,
  splitting: false,
  sourcemap: isProductionTier ? "none" : "linked",
  // Ignore CSS imports - CSS is handled separately by Tailwind CLI
  plugins: [{
    name: "ignore-css",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, () => ({
        contents: "",
        loader: "js",
      }));
    },
  }],
  define: {
    "import.meta.env": JSON.stringify({
      VITE_ENV: VITE_ENV,
      MODE: isProduction ? "production" : "development",
      DEV: !isProduction,
      PROD: isProduction,
      VITE_TAROBASE_APP_ID: process.env.VITE_TAROBASE_APP_ID || "",
      VITE_PARTYSERVER_URL: process.env.VITE_PARTYSERVER_URL || "",
      VITE_CHAIN: process.env.VITE_CHAIN || "",
      VITE_RPC_URL: process.env.VITE_RPC_URL || "",
      VITE_AUTH_METHOD: process.env.VITE_AUTH_METHOD || "",
      VITE_WS_API_URL: process.env.VITE_WS_API_URL || "",
      VITE_API_URL: process.env.VITE_API_URL || "",
      VITE_AUTH_API_URL: process.env.VITE_AUTH_API_URL || "",
      // Deployment tier: 'preview', 'mainnet-preview', or 'production'
      // Used to distinguish mainnet preview from production (both have VITE_ENV='LIVE')
      VITE_DEPLOYMENT_TIER: process.env.VITE_DEPLOYMENT_TIER || "preview",
    }),
    "process.env.NODE_ENV": JSON.stringify(isProduction ? "production" : "development"),
  },
  naming: {
    entry: "[name]-[hash].js",
    chunk: "chunk-[hash].js",
    asset: "assets/[name]-[hash].[ext]",
  },
  loader: {
    ".png": "file",
    ".jpg": "file",
    ".svg": "file",
    ".gif": "file",
    ".webp": "file",
    ".woff": "file",
    ".woff2": "file",
  },
});

logBuildPhase('after-bun-build');

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    // Properly extract error message from BuildMessage object
    const message = log.text || log.message || JSON.stringify(log);
    console.error(`  ${message}`);
    if (log.location) {
      console.error(`    at ${log.location.file}:${log.location.line}:${log.location.column}`);
    }
  }
  process.exit(1);
}

// Step 4.5: Fix asset paths - convert relative to absolute
// This ensures images load correctly on nested routes (e.g., /profile/xyz)
// Without this fix, "./assets/..." resolves to "/profile/xyz/assets/..." which 404s
console.log("Fixing asset paths...");
const jsFiles = result.outputs.filter((o: { kind: string }) => o.kind === "entry-point" || o.kind === "chunk");
for (const jsOutput of jsFiles) {
  const jsPath = jsOutput.path;
  let content = await Bun.file(jsPath).text();
  // Replace relative asset paths with absolute paths
  // Matches: "./assets/filename.ext" or './assets/filename.ext'
  content = content.replace(/(['"])\.\/assets\//g, '$1/assets/');
  await Bun.write(jsPath, content);
}

// Step 5: Generate index.html
const entryFile = result.outputs.find((o: { kind: string }) => o.kind === "entry-point")?.path.split("/").pop();

// Use production config if provided, otherwise use defaults
const faviconUrl = PROD_FAVICON || "https://assets.poof.new/preview.ico";
const pageTitle = PROD_TITLE || "Poof Preview App";

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="${themeColorHex}" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="${pageTitle}" />
  <link rel="icon" href="${faviconUrl}" />
  <link rel="manifest" href="/manifest.json" />
  <title>${pageTitle}</title>
  <link rel="stylesheet" href="/globals.css" />
  <link rel="stylesheet" href="/base.css" />
  <script>window.__VITE_ENV__ = '${VITE_ENV}';</script>
  <script src="/console-shim.js"></script>
  <script src="/component-inspector.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/${entryFile}"></script>
</body>
</html>`;
await Bun.write("./dist/index.html", html);

// Step 5.5: Generate manifest.json with production values
const manifest = {
  name: pageTitle,
  short_name: pageTitle.length > 12 ? pageTitle.substring(0, 12) : pageTitle,
  start_url: "/",
  display: "standalone",
  background_color: themeColorHex,
  theme_color: themeColorHex,
  icons: [
    ...(faviconUrl ? [{
      src: faviconUrl,
      sizes: "any",
      type: faviconUrl.endsWith(".svg") ? "image/svg+xml"
        : faviconUrl.endsWith(".png") ? "image/png"
        : "image/x-icon",
    }] : []),
  ],
};
await Bun.write("./dist/manifest.json", JSON.stringify(manifest, null, 2));

logBuildPhase('after-html-manifest');
console.log("Build succeeded!");
for (const o of result.outputs) console.log(`  - ${(o as { path: string }).path.split("/").pop()}`);
logBuildPhase('done');
