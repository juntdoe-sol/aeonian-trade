/**
 * Generates api-spec.json from the routeSpec array in routes/index.ts.
 * The platform reads this file after deploy to display available API routes.
 *
 * Run: bun run generate-spec
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { routeSpec } from '../src/routes/index.js';

const spec = {
  info: {
    title: 'API',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
  },
  routes: routeSpec.map((r) => ({
    method: r.method,
    path: r.path,
    description: r.description,
    authentication: { required: r.auth },
  })),
};

if (!existsSync('generated')) {
  mkdirSync('generated', { recursive: true });
}

writeFileSync('generated/api-spec.json', JSON.stringify(spec, null, 2));
console.log(`Generated api-spec.json with ${spec.routes.length} routes`);
