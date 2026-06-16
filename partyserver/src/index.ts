import { init } from '@pooflabs/server';
import { Hono } from 'hono';
import { ApiErrors, requestIdMiddleware } from './lib/api-response.js';
import { getTarobaseServerConfig } from './lib/config.js';
import { corsMiddleware } from './lib/cors-helpers.js';
import { createRequestLogger, globalErrorHandler } from './lib/request-logger.js';
import { x402Middleware } from './lib/x402-middleware.js';
import { registerHeartbeatRoutes } from './heartbeat/index.js';
import { processQueueBatch, registerQueueRoutes } from './queues/index.js';
import { registerRoutes } from './routes/index.js';
import { registerMcpFanoutRoutes } from './lib/poof-mcp-fanout.js';
export { QueueJobTracker } from './lib/poof-queue-job-tracker.js';

const app = new Hono();

// Tarobase initialization - uses this worker's fixed TAROBASE_APP_ID
app.use('*', async (c, next) => {
  if (process.env.PROJECT_VAULT_PRIVATE_KEY) {
    process.env.TAROBASE_SOLANA_KEYPAIR = process.env.PROJECT_VAULT_PRIVATE_KEY;
  }

  const config = getTarobaseServerConfig();
  await init(config);
  await next();
});

// Global middleware
// CORS is initialized lazily on first request to ensure process.env is populated
app.use('*', corsMiddleware());
app.use('*', x402Middleware);
app.use('*', requestIdMiddleware());
app.use('*', createRequestLogger());

// Global error handler
app.onError(globalErrorHandler());

// 404 handler for unregistered routes
app.notFound((c) => ApiErrors.notFound(c, 'Route not found'));

// Register heartbeat routes FIRST so user routes cannot shadow them.
// /__heartbeat/:taskName (manual, admin auth) and /__internal/heartbeat/:taskName (dispatcher, no auth)
registerHeartbeatRoutes(app);

// Register queue routes before user routes so user code cannot shadow them.
// /__internal/queues/:queueName is called by the platform queue dispatcher.
registerQueueRoutes(app);

// Required if this app uses Poof AI agents — /__poof/mcp/* re-issues to
// the platform MCP proxy so DO-originated MCP calls get sealed attribution.
registerMcpFanoutRoutes(app);

// Register all user API routes
registerRoutes(app);

export default {
  fetch: app.fetch,
  queue: processQueueBatch,
};
