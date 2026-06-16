// Platform-owned fanout routes for AI agent traffic.
//
// REQUIRED FOR AI AGENTS — if your app uses Poof's AI agents, you MUST
// call `registerMcpFanoutRoutes(app)` in `partyserver/src/index.ts`
// BEFORE `registerRoutes(app)`. Without it:
//   - Agent MCP tool calls (web_search / web_fetch / browse_*) fail
//     with CF error 1016.
//   - Agent LLM prompts (Anthropic / OpenAI / OpenRouter / ...) fail
//     with the same 1016 error.
// See the building-agents skill for the one-line wiring.
//
// Why this exists:
//   The agent framework runs inside a Durable Object. Subrequests
//   originating in a DO bypass the dispatch namespace's outbound
//   worker, so a direct fetch to `poof-mcp.internal` or
//   `poof-ai.internal` from inside the agent escapes to the public
//   network and 1016s. Those sentinel hosts only work from the user
//   worker's *top-level* fetch handler.
//
//   So Poof's agent runtime POSTs to
//     `<self>-api.<env>.poof.new/__poof/mcp` (for MCP tool calls)
//     `<self>-api.<env>.poof.new/__poof/ai/*` (for LLM prompts)
//   which both land in this Hono route family on the same worker.
//   The routes re-issue to the corresponding sentinel host — those
//   re-issues *do* go through outbound and get dispatcher-sealed
//   script attribution.
//
// Threat model:
//   - The URLs are publicly reachable. Anyone hammering them bills the
//     URL-mapped script (same risk profile as a tenant `/api/chat`
//     route that calls aiRun). Tenant overuse cap is the backstop.
//   - Cross-tenant forgery is impossible: URL prefix determines which
//     dispatched script handles the request, and that script's own
//     outbound stamps its own identity. Tenant A cannot bill tenant B.
//   - Caller-supplied `x-poof-*` headers are stripped before re-issue
//     so tenants cannot influence the upstream proxy's identity.

import type { Hono } from 'hono';

const MCP_SENTINEL_BASE = 'https://poof-mcp.internal';
const AI_SENTINEL_BASE = 'https://poof-ai.internal';
const WALLET_SENTINEL_BASE = 'https://poof-wallet.internal';
const MCP_ROUTE_PREFIX = '/__poof/mcp';
const AI_ROUTE_PREFIX = '/__poof/ai';
const WALLET_ROUTE_PREFIX = '/__poof/wallet';

const STRIPPED_PREFIXES = ['x-poof-', 'cf-'];
const STRIPPED_HEADERS = new Set([
  'host',
  'authorization',
  'cookie',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
]);

async function fanoutTo(req: Request, routePrefix: string, sentinelBase: string, sentinelRoot: string): Promise<Response> {
  const url = new URL(req.url);
  // /__poof/mcp        -> /mcp
  // /__poof/mcp/foo    -> /mcp/foo
  // /__poof/ai/v1/x    -> /v1/x  (sentinelRoot = '')
  const suffix = url.pathname === routePrefix ? '' : url.pathname.slice(routePrefix.length);

  // Path-traversal guard. `new URL` normalizes `..` segments at parse
  // time, so a caller hitting `/__poof/ai/..%2F..%2Fadmin` would re-
  // target a sub-route the proxy didn't expect. Reject any decoded
  // segment that resolves to `..` (or `.`) before we ever construct
  // the upstream URL. Note: hosts can't be escaped (`sentinelBase`
  // hard-codes them), but pathname can.
  const decoded = (() => {
    try { return decodeURIComponent(suffix); } catch { return null; }
  })();
  if (decoded === null) return new Response('Bad Request', { status: 400 });
  for (const seg of decoded.split('/')) {
    if (seg === '..' || seg === '.') return new Response('Bad Request', { status: 400 });
  }

  const upstream = new URL(`${sentinelBase}${sentinelRoot}${suffix}${url.search}`);

  // Belt-to-the-braces: even after the segment check, assert the
  // resolved upstream pathname still starts with the intended sentinel
  // root. For MCP this enforces `/mcp`; for AI (where sentinelRoot is
  // empty) the segment check above is the authoritative guard.
  if (sentinelRoot && !upstream.pathname.startsWith(sentinelRoot)) {
    return new Response('Bad Request', { status: 400 });
  }

  const headers = new Headers();
  for (const [k, v] of req.headers) {
    const key = k.toLowerCase();
    if (STRIPPED_HEADERS.has(key)) continue;
    if (STRIPPED_PREFIXES.some((p) => key.startsWith(p))) continue;
    headers.set(k, v);
  }

  if (!headers.has('content-type') && (req.method === 'POST' || req.method === 'PUT')) {
    headers.set('content-type', 'application/json');
  }

  const upstreamReq = new Request(upstream.toString(), {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    redirect: 'manual',
  });

  // Top-level worker fetch → outbound intercepts → upstream proxy with
  // sealed script attribution. Pass-through body so SSE streams work
  // without buffering.
  return fetch(upstreamReq);
}

/**
 * Token gate for fanout routes. The token is a per-script secret set
 * by the platform (or by the tenant) as `POOF_FANOUT_TOKEN`. Only the
 * tenant's own worker code (which can read `process.env`) can satisfy
 * the gate.
 *
 * Fail-closed: if the secret is missing, every fanout request gets
 * 401. Pre-flue projects don't have agents and never hit these
 * routes, so the closed gate is invisible to them. New agent
 * projects normally get the secret provisioned on first deploy via
 * setupPartyServerSecrets — if that provisioning fails (CF API
 * hiccup, etc.), the worker still ships safely: agents fail with a
 * loud 401 the operator can see, vs. silently shipping anonymously
 * callable billable routes.
 */
function checkFanoutToken(req: Request): Response | null {
  const expected = (process.env as Record<string, string | undefined>).POOF_FANOUT_TOKEN;
  if (!expected) {
    // No token in env — refuse. Log loudly so an operator hitting this
    // immediately after a deploy can correlate to the secret-provisioning
    // failure path.
    console.warn('[poof-fanout] POOF_FANOUT_TOKEN not set on this worker — rejecting fanout request');
    return new Response('Unauthorized: fanout token not provisioned on this worker', { status: 401 });
  }
  // Accept the token via any of three channels, all serving the same role —
  // proving the caller can read POOF_FANOUT_TOKEN from this worker's env:
  //   - `x-poof-fanout-token`: explicit, used by the MCP connect.
  //   - `Authorization: Bearer <token>`: used by pi-ai for OpenAI-shaped providers
  //     (the configureProvider apiKey gets sent as Bearer there).
  //   - `x-api-key: <token>`: used by pi-ai for Anthropic via the official
  //     `@anthropic-ai/sdk`, which by convention sends the apiKey as `x-api-key`
  //     and ignores any Bearer setting. Without this channel, every Anthropic
  //     agent call 401s here even though configureProvider set the apiKey
  //     correctly.
  const headerToken = req.headers.get('x-poof-fanout-token');
  if (headerToken === expected) return null;
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ') && auth.slice(7) === expected) return null;
  const xApiKey = req.headers.get('x-api-key');
  if (xApiKey === expected) return null;
  return new Response('Unauthorized', { status: 401 });
}

async function gatedFanout(
  req: Request,
  routePrefix: string,
  sentinelBase: string,
  sentinelRoot: string,
): Promise<Response> {
  const gate = checkFanoutToken(req);
  if (gate) return gate;
  return fanoutTo(req, routePrefix, sentinelBase, sentinelRoot);
}

/**
 * Register the agent fanout routes on the Hono app. Call this from
 * `partyserver/src/index.ts` BEFORE `registerRoutes(app)` if your app
 * uses Poof's AI agents. Registers:
 *   - /__poof/mcp[/*]    → re-issued to poof-mcp.internal/mcp[*]
 *   - /__poof/ai/*       → re-issued to poof-ai.internal/*
 *   - /__poof/wallet[/*] → re-issued to poof-wallet.internal/exec[*]
 *
 * The wallet route exists for all projects so the template stays uniform;
 * actual wallet exec is gated server-side by POOF_WALLET_ENABLED on the
 * sandbox service plus the per-script DENY_KV. The route itself only
 * fires when the agent's `onchainos` shim issues a request (which only
 * happens when POOF_WALLET_ENABLED is set on this worker).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerMcpFanoutRoutes(app: Hono<any>): void {
  // MCP fanout. The MCP proxy's endpoint is at /mcp.
  app.all(`${MCP_ROUTE_PREFIX}/*`, (c) => gatedFanout(c.req.raw, MCP_ROUTE_PREFIX, MCP_SENTINEL_BASE, '/mcp'));
  app.all(MCP_ROUTE_PREFIX, (c) => gatedFanout(c.req.raw, MCP_ROUTE_PREFIX, MCP_SENTINEL_BASE, '/mcp'));

  // AI fanout. The AI proxy lives at the root of poof-ai.internal, so
  // the suffix is appended directly (sentinelRoot = '').
  app.all(`${AI_ROUTE_PREFIX}/*`, (c) => gatedFanout(c.req.raw, AI_ROUTE_PREFIX, AI_SENTINEL_BASE, ''));
  app.all(AI_ROUTE_PREFIX, (c) => gatedFanout(c.req.raw, AI_ROUTE_PREFIX, AI_SENTINEL_BASE, ''));

  // Wallet fanout. The wallet sandbox's endpoint is at /exec.
  app.all(`${WALLET_ROUTE_PREFIX}/*`, (c) => gatedFanout(c.req.raw, WALLET_ROUTE_PREFIX, WALLET_SENTINEL_BASE, '/exec'));
  app.all(WALLET_ROUTE_PREFIX, (c) => gatedFanout(c.req.raw, WALLET_ROUTE_PREFIX, WALLET_SENTINEL_BASE, '/exec'));
}
