// Hand-rolled equivalent of `flue build --target cloudflare`. We keep this
// hand-written so the partyserver entry stays `{ fetch, queue }` — running
// `flue build` would replace it with `{ fetch }` only and drop queue delivery.
//
// Imports `@flue/sdk/internal` and `@flue/sdk/cloudflare` (both unstable).
// Treat any `@flue/sdk` version bump as a coordinated change with this file.

import { Bash, InMemoryFs } from 'just-bash';
import { Agent, routeAgentRequest } from 'agents';
import { WALLET_SKILL_INSTRUCTIONS } from './wallet-skill-content.js';
import {
  type AgentHandler,
  type FlueContextInternal,
  type RunStore,
  type RunSubscriberRegistry,
  bashFactoryToSessionEnv,
  configureFlueRuntime,
  createDurableRunStore,
  createFlueContext,
  createRunSubscriberRegistry,
  handleAgentRequest,
  handleRunRouteRequest,
  resolveModel,
} from '@flue/sdk/internal';
import { runWithCloudflareContext } from '@flue/sdk/cloudflare';
import { configureProvider } from '@flue/sdk/app';
import { connectMcpServer, type AgentInit, type FlueHarness } from '@flue/sdk/client';

// The agent runs inside a Durable Object, and DO subrequests bypass
// the dispatch namespace's outbound worker — so a direct fetch to the
// `poof-mcp.internal` or `poof-ai.internal` sentinels escapes to
// public DNS and 1016s. Instead we route through the user worker's
// own `/__poof/mcp/*` and `/__poof/ai/*` routes (see
// poof-mcp-fanout.ts), which run at top-level fetch context where
// outbound DOES intercept and stamps sealed script attribution.
//
// The base URL `https://<script>-api.<env>.poof.new/__poof` is
// resolved at agent connection time from process.env so the same code
// works in both staging (proxy-staging.poof.new) and prod (poof.new).
function resolvePoofFanoutBase(): string {
  const explicit = (process.env as Record<string, string | undefined>).POOF_FANOUT_BASE_URL;
  if (explicit) return explicit;
  const appId = (process.env as Record<string, string | undefined>).TAROBASE_APP_ID;
  if (!appId) {
    throw new Error(
      '[poof-flue] Cannot resolve Poof fanout base URL: neither POOF_FANOUT_BASE_URL nor TAROBASE_APP_ID is set.',
    );
  }
  const envName = (process.env as Record<string, string | undefined>).ENV;
  const suffix = envName === 'LIVE' ? 'poof.new' : 'proxy-staging.poof.new';
  return `https://${appId}-api.${suffix}/__poof`;
}

function resolveMcpFanoutUrl(): string {
  return `${resolvePoofFanoutBase()}/mcp`;
}

function resolveAiFanoutBase(): string {
  return `${resolvePoofFanoutBase()}/ai`;
}

function resolveWalletFanoutUrl(): string {
  return `${resolvePoofFanoutBase()}/wallet`;
}

function isWalletEnabled(): boolean {
  return (process.env as Record<string, string | undefined>).POOF_WALLET_ENABLED === 'true';
}

function resolveWalletScopeId(): string {
  // V1: a single per-project wallet by default. Tenants who want
  // per-user custody set this from their agent init path (the platform
  // forwards POOF_WALLET_SCOPE_ID through to process.env).
  return (process.env as Record<string, string | undefined>).POOF_WALLET_SCOPE_ID || 'default';
}

// The fanout routes are token-gated by POOF_FANOUT_TOKEN. The gate is
// fail-closed: if the secret isn't on env (first-deploy failure, tenant
// cleared it manually), every fanout request returns 401 and the agent
// fails loudly — preferable to silently shipping anonymously billable
// public routes.
//
// The token rides on `Authorization: Bearer <token>` (so it can piggyback
// on `configureProvider`'s `apiKey` option, which has no separate header
// channel) AND on `x-poof-fanout-token` (for explicit callers like the MCP
// connect, which DOES support custom headers).
//
// SECURITY: POOF_FANOUT_TOKEN is a platform-managed per-script secret.
// Anyone who obtains it can call your /__poof/* fanout routes and bill
// MCP / AI usage to YOUR project (no cross-tenant impact — each tenant
// has a unique token). Never log `process.env`, never include it in
// API responses or error messages, never bundle it into client code.
// Tenant code should not read this directly — the platform helpers
// (runAgent, configurePoofAIProviders, etc.) handle it.
function resolveFanoutToken(): string | undefined {
  return (process.env as Record<string, string | undefined>).POOF_FANOUT_TOKEN;
}

// Only one sandbox shape is supported: the in-memory just-bash with full
// network access (egress goes through the dispatch outbound worker).
// Passing `init({ sandbox: ... })` is not supported on Poof — no R2 virtual
// sandbox, no Daytona/E2B connector. If/when we add support, we add a
// resolveSandbox hook here.
//
// When the wallet feature is enabled on this project
// (POOF_WALLET_ENABLED=true), we additionally register an `onchainos`
// just-bash command that proxies argv to the platform wallet sandbox
// service. The handler:
//   - Reads POOF_FANOUT_TOKEN from closed-over env (never reaches the
//     agent's bash environment or transcript).
//   - Reads POOF_WALLET_SCOPE_ID from env (per-session if the tenant
//     sets it, else 'default').
//   - POSTs to the user worker's own /__poof/wallet route. That route
//     re-issues to poof-wallet.internal at top-level fetch context
//     where outbound intercepts and stamps sealed appid attribution.
//   - The CLI argv is passed as a JSON array (NOT shell-concatenated),
//     so no injection surface from the agent's command output.
//
// When the feature is OFF, no `onchainos` command exists in the agent's
// bash — running it errors with "command not found", and the skill
// instructions also aren't injected, so the LLM has no surface to call
// it from.
async function createDefaultEnv() {
  const walletEnabled = isWalletEnabled();
  // Seed the InMemoryFs with `AGENTS.md` at the bash sandbox's default cwd
  // (`/home/user`) when wallet is enabled. Flue's harness `init()` doesn't
  // honor the `systemPrompt` passed to `createFlueContext` — it rebuilds the
  // prompt by reading AGENTS.md/CLAUDE.md and `.agents/skills/*` from the
  // session env's cwd (see @flue/sdk client.mjs `discoverSessionContext`).
  // Writing the OKX skill content to AGENTS.md is the only way to get it
  // into the LLM's actual system prompt; passing it via agentConfig is a
  // no-op against the current Flue runtime.
  const initialFiles: Record<string, string> = {};
  if (walletEnabled) {
    initialFiles['/home/user/AGENTS.md'] = WALLET_SKILL_INSTRUCTIONS;
  }
  const fs = new InMemoryFs(initialFiles);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customCommands: Array<Record<string, unknown>> = [];
  if (walletEnabled) {
    const fanoutUrl = resolveWalletFanoutUrl();
    const fanoutToken = resolveFanoutToken();
    const walletScopeId = resolveWalletScopeId();
    customCommands.push(createOnchainosShim(fanoutUrl, fanoutToken, walletScopeId));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return bashFactoryToSessionEnv(
    () =>
      new Bash({
        fs,
        // The just-bash `customCommands` constructor option is the
        // documented surface for registering extra CLI shims. When the
        // wallet feature is OFF this is an empty array, so the bash
        // sandbox behaves exactly like the pre-wallet version.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(customCommands.length > 0 ? ({ customCommands } as any) : {}),
        network: { dangerouslyAllowFullInternetAccess: true },
      }),
  );
}

interface ShimCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// just-bash's `Command` shape (see just-bash dist/types.d.ts):
//   { name: string; trusted?: boolean; execute(args, ctx): Promise<ExecResult> }
// We construct the object inline rather than importing the type so the
// runtime stays decoupled from a specific just-bash version pin. The
// previous version of this code used `handler(args)` which caused the
// dispatcher to throw `<ref>.execute is not a function` — just-bash
// expects `.execute`. Don't rename it.
function createOnchainosShim(
  fanoutUrl: string,
  fanoutToken: string | undefined,
  walletScopeId: string,
): {
  name: string;
  execute(args: string[], ctx: unknown): Promise<ShimCommandResult>;
} {
  return {
    name: 'onchainos',
    execute: async (args: string[]): Promise<ShimCommandResult> => {
      try {
        const res = await fetch(fanoutUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Both channels accepted by the fanout gate:
            ...(fanoutToken ? { authorization: `Bearer ${fanoutToken}` } : {}),
            ...(fanoutToken ? { 'x-poof-fanout-token': fanoutToken } : {}),
          },
          body: JSON.stringify({ argv: args, walletScopeId }),
        });
        if (!res.ok) {
          // Surface the HTTP status to the agent's bash environment but
          // do NOT log the response body — for transient platform errors
          // it's fine, but for app-level errors (auth failures, recipient
          // address rejections) the body can contain sensitive PII. The
          // status code + `argv[0]` is enough for ops to correlate, and
          // the user-facing text comes through `stderr` for the LLM.
          const text = await res.text().catch(() => '');
          console.warn(
            '[poof-wallet] fanout returned non-ok:',
            JSON.stringify({ status: res.status, subcommand: args[0] }),
          );
          return {
            stdout: '',
            stderr: `onchainos: wallet service error: ${res.status} ${text}\n`,
            exitCode: 1,
          };
        }
        const result = (await res.json()) as Partial<ShimCommandResult>;
        return {
          stdout: typeof result.stdout === 'string' ? result.stdout : '',
          stderr: typeof result.stderr === 'string' ? result.stderr : '',
          exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0,
        };
      } catch (err) {
        // Network-level error reaching the fanout. Log the message (no
        // sensitive payload involved) so operators can spot misconfigured
        // routes / DNS / token resolution.
        console.warn(
          '[poof-wallet] shim fetch threw:',
          err instanceof Error ? err.message : String(err),
        );
        return {
          stdout: '',
          stderr: `onchainos: ${err instanceof Error ? err.message : String(err)}\n`,
          exitCode: 1,
        };
      }
    },
  };
}

async function createLocalEnv(): Promise<never> {
  throw new Error("[poof-flue] 'local' sandbox is not supported on Cloudflare Workers.");
}

const runSubscribers: RunSubscriberRegistry = createRunSubscriberRegistry();

// Structural SQL type so this file compiles under `types: ["node"]` without
// pulling in @cloudflare/workers-types as a hard dep.
interface SqlExecResult {
  toArray(): Array<Record<string, unknown>>;
}
interface SqlLike {
  exec(query: string, ...bindings: unknown[]): SqlExecResult;
}

function createDOStore(sql: SqlLike) {
  sql.exec(
    'CREATE TABLE IF NOT EXISTS flue_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  );
  return {
    async save(id: string, data: unknown) {
      const json = JSON.stringify(data);
      sql.exec(
        'INSERT OR REPLACE INTO flue_sessions (id, data, updated_at) VALUES (?, ?, ?)',
        id,
        json,
        Date.now(),
      );
    },
    async load(id: string) {
      const rows = sql
        .exec('SELECT data FROM flue_sessions WHERE id = ?', id)
        .toArray() as Array<{ data: string }>;
      if (rows.length === 0) return null;
      return JSON.parse(rows[0]!.data);
    },
    async delete(id: string) {
      sql.exec('DELETE FROM flue_sessions WHERE id = ?', id);
    },
  };
}

interface DurabilityDOInstance {
  name: string;
  env: Record<string, unknown>;
  ctx: { storage: { sql: SqlLike } };
  runFiber: (name: string, fn: (fiber: FlueFiberHandle) => Promise<unknown>) => Promise<unknown>;
  keepAliveWhile: (fn: () => unknown) => unknown;
}

interface FlueFiberHandle {
  stash?: (data: Record<string, unknown>) => void;
}

function requireSql(doInstance: DurabilityDOInstance): SqlLike {
  const sql = doInstance.ctx.storage.sql;
  if (!sql) {
    // Reaching this means the DO migration didn't promote this class to the
    // SQLite-backed variant. Either wrangler.toml is missing
    // `new_sqlite_classes = ["<ClassName>"]` (the platform should emit it via
    // poof-agents.json) or the migration tag changed names. Surface a clear error
    // instead of falling back to in-memory storage that loses state on the
    // next request.
    throw new Error(
      '[poof-flue] DO storage.sql is unavailable. The agent\'s wrangler migration must include ' +
        '`new_sqlite_classes = ["<ClassName>"]`. The platform generates this from poof-agents.json — ' +
        'check that the agent is listed there and the project has redeployed.',
    );
  }
  return sql;
}

function createContextForRequest(
  id: string,
  runId: string,
  payload: unknown,
  doInstance: DurabilityDOInstance,
  req: Request,
): FlueContextInternal {
  const defaultStore = createDOStore(requireSql(doInstance));

  // When the wallet feature is on for this project, prepend the OKX
  // skill instructions to the agent's system prompt. The instructions
  // are bundled at template build time (see wallet-skill-content.ts) so
  // there's no runtime fetch — toggling the env var on a redeploy is the
  // unit of update. When OFF, the system prompt stays empty and the LLM
  // has no knowledge of the wallet surface (the `onchainos` bash command
  // is also not registered in that case).
  const walletEnabled = isWalletEnabled();
  const systemPrompt = walletEnabled ? WALLET_SKILL_INSTRUCTIONS : '';
  const skills = walletEnabled
    ? {
        'okx-agentic-wallet': {
          name: 'okx-agentic-wallet',
          description: 'Non-custodial wallet via the onchainos CLI (login, balance, send, sign, swap).',
        },
      }
    : {};

  const context = createFlueContext({
    id,
    runId,
    payload,
    env: doInstance.env,
    req,
    agentConfig: {
      systemPrompt,
      skills,
      roles: {},
      model: undefined,
      resolveModel,
    },
    createDefaultEnv,
    createLocalEnv,
    defaultStore,
  });

  // Auto-merge Poof's default MCP tools into every init() call. The agent
  // file writes `await init({ model, tools: [myTool] })` — we transparently
  // prepend web_search / web_fetch / browse_* / etc.
  //
  //   `init({ poofTools: false })` — skip the auto-injection entirely.
  //     Use when targeting models with tight tool-cap budgets (some
  //     OpenRouter/Groq routes top out at 16) or when an agent needs a
  //     minimal tool surface for safety.
  //
  //   Tool-name collisions: the platform tool names are reserved under
  //     a known prefix (`mcp__poof__*`). If a tenant-declared tool
  //     collides, we throw at init() — silent shadow-by-user could
  //     impersonate a platform tool; silent shadow-by-platform could
  //     bypass user validation. Fail loud at startup is the safe call.
  //
  //   MCP outage: if `connectMcpServer` rejects (transient proxy 5xx,
  //     fanout misconfigured, secret rotated mid-flight), continue
  //     with the user's own tools rather than killing every agent on
  //     the platform. Log a warning so the degraded state is visible
  //     in tail logs.
  const originalInit = context.init.bind(context) as (opts: AgentInit) => Promise<FlueHarness>;
  context.init = (async (opts: AgentInit & { poofTools?: boolean }) => {
    const userTools = ((opts as { tools?: Array<{ name?: unknown }> }).tools ?? []) as Array<{ name?: unknown }>;
    let poofTools: Array<{ name?: unknown }> = [];
    if (opts.poofTools !== false) {
      const fanoutToken = resolveFanoutToken();
      const mcpUrl = resolveMcpFanoutUrl();
      try {
        const conn = await connectMcpServer('poof', {
          url: mcpUrl,
          transport: 'streamable-http',
          headers: fanoutToken ? { 'x-poof-fanout-token': fanoutToken } : undefined,
        });
        poofTools = conn.tools as Array<{ name?: unknown }>;
      } catch (err) {
        console.warn(
          '[poof-flue] failed to connect to Poof MCP — continuing without default tools:',
          err instanceof Error ? err.message : String(err),
        );
      }
      const reserved = new Set(poofTools.map((t) => t.name).filter((n): n is string => typeof n === 'string'));
      for (const t of userTools) {
        if (typeof t.name === 'string' && reserved.has(t.name)) {
          throw new Error(
            `[poof-flue] User-declared tool '${t.name}' collides with a Poof platform tool. ` +
              `Rename your tool, or call init({ poofTools: false }) to opt out of platform tool injection.`,
          );
        }
      }
    }
    return originalInit({
      ...opts,
      tools: [...poofTools, ...userTools] as AgentInit['tools'],
    });
  }) as typeof context.init;

  return context;
}

function createRunStoreForRequest(doInstance: DurabilityDOInstance): RunStore {
  // SqlLike → CF SqlStorage at the seam; types match structurally.
  return createDurableRunStore(
    requireSql(doInstance) as unknown as Parameters<typeof createDurableRunStore>[0],
  );
}

// Pins Flue's AsyncLocalStorage so anything in the call graph (e.g. the
// Workers AI provider) reads the live DO env instead of a stale one.
function runWithInstanceContext<T>(doInstance: DurabilityDOInstance, fn: () => T): T {
  return runWithCloudflareContext(
    {
      env: doInstance.env,
      agentInstance: doInstance as unknown as {
        state: unknown;
        setState(state: unknown): void;
      },
      storage: doInstance.ctx.storage as unknown as { sql: unknown },
    },
    fn,
  );
}

function logFlueFiberInterrupt(
  ctx: { name?: string; snapshot?: unknown },
  agentName: string,
) {
  console.warn(
    '[poof-flue] Cloudflare fiber interrupted:',
    agentName,
    ctx.name,
    ctx.snapshot ?? null,
  );
}

// Positional segment parse so an instance id literally named "runs" is not
// mis-detected as the run-routes marker.
function parseRunRoute(request: Request) {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  if (segments.length < 4) return null;
  if (segments[0] !== 'agents') return null;
  if (segments[3] !== 'runs') return null;
  const runId = segments[4];
  const child = segments[5];
  if (!runId) return null;
  if (!child) return { action: 'get' as const, runId };
  if (child === 'events') return { action: 'events' as const, runId };
  if (child === 'stream') return { action: 'stream' as const, runId };
  return null;
}

// Mirror string-valued bindings (vars + secrets) from the DO's env into
// process.env. Cloudflare Workers + `nodejs_compat_populate_process_env`
// populates process.env for the OUTER worker's fetch handler at request time,
// but NOT for Durable Object contexts and NOT at module-load. The agent
// runtime here lives inside a DO and also relied on configureProvider being
// called at module load — both of which see a process.env that's missing
// secrets like POOF_FANOUT_TOKEN. Result: configureProvider captured
// 'sealed-by-platform' as the AI Bearer, and the agent's MCP init sent no
// x-poof-fanout-token header, so /__poof/{ai,mcp,wallet} all 401'd.
//
// Hydrating once at the top of every dispatchAgent call fixes both: the
// re-call of configurePoofAIProviders below picks up the now-populated
// token, and the MCP/wallet shim's later resolveFanoutToken() reads inside
// agent.init() also see the value. process.env is per-isolate so concurrent
// hits are last-write-wins on the same value — safe.
function hydrateProcessEnvFromDoEnv(env: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      (process.env as Record<string, string | undefined>)[key] = value;
    }
  }
}

async function dispatchAgent(
  request: Request,
  doInstance: DurabilityDOInstance,
  agentName: string,
  handler: AgentHandler,
): Promise<Response> {
  hydrateProcessEnvFromDoEnv(doInstance.env);
  // Refresh pi-ai providerOverrides now that process.env has the secrets.
  // configureProvider is last-write-wins per @flue/sdk docs, so this safely
  // overwrites the module-load capture (which fell back to 'sealed-by-platform'
  // because the secret wasn't in process.env yet).
  configurePoofAIProviders();
  const id = doInstance.name;
  const runRoute = parseRunRoute(request);
  if (runRoute) {
    return handleRunRouteRequest({
      request,
      agentName,
      id,
      runStore: createRunStoreForRequest(doInstance),
      runSubscribers,
      ...runRoute,
    });
  }

  return handleAgentRequest({
    request,
    agentName,
    id,
    handler,
    runStore: createRunStoreForRequest(doInstance),
    runSubscribers,
    createContext: (id_, runId, payload, req) =>
      createContextForRequest(id_, runId, payload, doInstance, req),
    startWebhook: (runId, run) => {
      const wrapped = (fiber: FlueFiberHandle | undefined) => {
        fiber?.stash?.({
          version: 1,
          kind: 'webhook',
          agentName,
          id,
          runId,
          phase: 'running',
          startedAt: Date.now(),
        });
        return runWithInstanceContext(doInstance, run);
      };
      return doInstance.runFiber('flue:webhook:' + runId, wrapped);
    },
    runHandler: (ctx, h) =>
      runWithInstanceContext(doInstance, () => doInstance.keepAliveWhile(() => h(ctx))),
  });
}

// Naming: `.flue/agents/<kebab>.ts` ←→ `definePoofAgent('<kebab>', ...)` ←→
// `export const <Pascal> = definePoofAgent(...)` ←→ wrangler `class_name = "<Pascal>"`.
// The Cloudflare Agents SDK URL→binding resolver depends on this exact chain.
//
// Return type is `typeof Agent` (cast through unknown) for two reasons:
//   - TS4094: an anonymous class extending Agent re-exposes all of Agent's
//     inherited private/protected members, which fails .d.ts emission.
//   - TS2419: Agent's constructor is generic; an anonymous concrete subclass
//     can't satisfy the generic signature.
// Wrangler binds DO classes by export name, so type identity at this seam
// doesn't affect runtime resolution. Do not "simplify" the cast.
export function definePoofAgent(
  name: string,
  handler: AgentHandler,
): typeof Agent {
  const cls = class extends Agent<Record<string, unknown>> {
    async onRequest(request: Request): Promise<Response> {
      return dispatchAgent(
        request,
        this as unknown as DurabilityDOInstance,
        name,
        handler,
      );
    }

    async onFiberRecovered(ctx: { name?: string; snapshot?: unknown }) {
      if (ctx.name?.startsWith('flue:')) {
        logFlueFiberInterrupt(ctx, name);
        return;
      }
      return (Agent.prototype as unknown as {
        onFiberRecovered: (ctx: unknown) => Promise<void>;
      }).onFiberRecovered.call(this, ctx);
    }
  };
  return cls as unknown as typeof Agent;
}

// Call once at module load in src/index.ts. `webhookAgents` lists kebab-case
// names of agents that should be webhook-reachable; any agent not in this list
// 404s at the `flue()` Hono sub-app before reaching the DO.
export function configurePoofAgentsRuntime(webhookAgents: readonly string[]) {
  configureFlueRuntime({
    target: 'cloudflare',
    webhookAgents,
    allowNonWebhook: false,
    routeAgentRequest: (request, env) =>
      routeAgentRequest(request, env as Record<string, unknown>) as Promise<
        Response | null
      >,
  });
}

// Call once at module load in src/index.ts, BEFORE any agent registration,
// so pi-ai's model resolver sees the provider overrides on first lookup.
//
// Provider baseUrls point at the user worker's `/__poof/ai/*` fanout
// route — NOT directly at `poof-ai.internal`. The agent runtime lives
// inside a Durable Object, and DO subrequests bypass the dispatch
// outbound worker, so a direct fetch to `poof-ai.internal` from the
// agent's LLM call escapes to public DNS and 1016s. Routing through
// the fanout puts the request back into the worker's top-level fetch
// where outbound does intercept and stamp sealed script attribution.
// See poof-mcp-fanout.ts.
//
// `apiKey: 'sealed-by-platform'` is intentional. The dispatch outbound worker
// strips it and seals project attribution; the value never reaches the wire.
// Do not replace with a real key.
export function configurePoofAIProviders() {
  const aiBase = resolveAiFanoutBase(); // https://<self>-api.<env>.poof.new/__poof/ai
  // The apiKey rides as `Authorization: Bearer <key>` on each LLM call.
  // When POOF_FANOUT_TOKEN is set, we use it here so the fanout handler
  // can validate it. The fanout strips Authorization before re-issuing to
  // poof-ai.internal — outbound then stamps its own internal-key. The
  // upstream AI proxy never sees the token. If the env var is missing
  // (older deploys / opt-out), we fall back to the legacy placeholder.
  const apiKey = resolveFanoutToken() ?? 'sealed-by-platform';

  // Anthropic native (POST /v1/messages).
  configureProvider('anthropic', { baseUrl: aiBase, apiKey });

  // OpenAI native (POST /chat/completions). `/v1` suffix matters — the OpenAI
  // Node SDK only appends `/chat/completions` to its baseURL.
  configureProvider('openai', { baseUrl: `${aiBase}/v1`, apiKey });

  // OpenAI-compatible third-party providers. AI Gateway dispatches by the
  // `provider/` prefix in the model string.
  for (const slug of [
    'openrouter',
    'groq',
    'deepseek',
    'xai',
    'cerebras',
    'moonshotai',
    'perplexity-ai',
    'mistral',
  ]) {
    configureProvider(slug, { baseUrl: `${aiBase}/v1`, apiKey });
  }
}

// ---------------------------------------------------------------------------
// Agent invocation helpers
//
// Agents are reachable only via Durable Object binding from inside the
// worker — the public `/agents/<name>/<sessionId>` HTTP route is blocked
// at poofproxy. Tenants invoke agents by calling these helpers from a
// route they own and gate themselves (Cognito JWT via `validatePoofAuth`,
// rate limiting, etc.). Same model as `aiRun` and queues — the platform
// provides the runtime, the tenant provides the API surface.
//
// All helpers route through the agent's DO binding (`env.<PascalName>`),
// which exists on every dispatched worker (the platform emits the binding
// from poof-agents.json at deploy time). Same `sessionId` across calls =
// same DO instance = session state persists. Different sessionId = fresh
// run from scratch.
// ---------------------------------------------------------------------------

interface DurableObjectId {
  toString(): string;
}
interface DurableObjectStub {
  fetch(req: Request): Promise<Response>;
}
interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

function pascalCase(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function resolveAgentBinding(env: unknown, name: string): DurableObjectNamespaceLike {
  const className = pascalCase(name);
  const binding = (env as Record<string, unknown>)[className] as DurableObjectNamespaceLike | undefined;
  if (!binding || typeof binding.idFromName !== 'function') {
    throw new Error(
      `[poof-flue] Agent binding ${className} not on env. Check that '${name}' is listed in ` +
        `poof-agents.json and the project has been redeployed.`,
    );
  }
  return binding;
}

function agentRequest(
  name: string,
  sessionId: string,
  payload: unknown,
  extraHeaders?: Record<string, string>,
): Request {
  return new Request(`http://agent.internal/agents/${name}/${sessionId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(extraHeaders ?? {}) },
    body: JSON.stringify(payload),
  });
}

/**
 * Run an agent synchronously. Blocks until the handler returns, then
 * returns the parsed result. Use when the run is short and the caller
 * wants the final value inline. For long-running work use
 * `enqueueAgentRun` or `streamAgent`.
 *
 * Continuing a session: pass the same `sessionId` across calls. The DO
 * preserves state.
 */
export async function runAgent<T = unknown>(
  env: unknown,
  name: string,
  opts: { sessionId: string; payload: unknown },
): Promise<T> {
  const binding = resolveAgentBinding(env, name);
  const stub = binding.get(binding.idFromName(opts.sessionId));
  const res = await stub.fetch(agentRequest(name, opts.sessionId, opts.payload));
  if (!res.ok) {
    throw new Error(
      `[poof-flue] runAgent ${name}/${opts.sessionId} → ${res.status}: ${await res.text().catch(() => '')}`,
    );
  }
  const body = (await res.json()) as unknown;
  if (body && typeof body === 'object' && 'result' in body && '_meta' in body) {
    return (body as { result: T }).result;
  }
  return body as T;
}

/**
 * Start an agent run in the background. Returns the `runId` immediately
 * (HTTP 202 from the framework). The handler keeps running after this
 * function resolves. Use for fire-and-forget triggers (queue consumers,
 * heartbeat tasks, alarms) or for runs that exceed the calling worker's
 * CPU budget. Poll the result with `getAgentRun` or stream events with
 * `streamAgentRunEvents`.
 */
export async function enqueueAgentRun(
  env: unknown,
  name: string,
  opts: { sessionId: string; payload: unknown },
): Promise<{ runId: string }> {
  const binding = resolveAgentBinding(env, name);
  const stub = binding.get(binding.idFromName(opts.sessionId));
  const res = await stub.fetch(
    agentRequest(name, opts.sessionId, opts.payload, { 'x-webhook': 'true' }),
  );
  if (!res.ok) {
    throw new Error(
      `[poof-flue] enqueueAgentRun ${name}/${opts.sessionId} → ${res.status}: ${await res.text().catch(() => '')}`,
    );
  }
  const body = (await res.json()) as { runId?: string };
  if (!body.runId) {
    throw new Error(`[poof-flue] enqueueAgentRun ${name}: framework did not return a runId`);
  }
  return { runId: body.runId };
}

/**
 * Start an agent run and stream events as Server-Sent Events. Returns
 * the raw SSE Response — typically returned directly from your route
 * handler so the browser receives the live event stream. The stream
 * emits step-by-step events (tool calls, model responses, ...) and
 * closes when the run completes.
 */
export async function streamAgent(
  env: unknown,
  name: string,
  opts: { sessionId: string; payload: unknown },
): Promise<Response> {
  const binding = resolveAgentBinding(env, name);
  const stub = binding.get(binding.idFromName(opts.sessionId));
  return stub.fetch(
    agentRequest(name, opts.sessionId, opts.payload, { accept: 'text/event-stream' }),
  );
}

/**
 * Fetch the status and final result of a run started earlier (typically
 * via `enqueueAgentRun`). Works regardless of which mode kicked off the
 * run — the framework persists every run record.
 */
export async function getAgentRun<T = unknown>(
  env: unknown,
  name: string,
  sessionId: string,
  runId: string,
): Promise<{ status: string; result?: T; error?: string }> {
  const binding = resolveAgentBinding(env, name);
  const stub = binding.get(binding.idFromName(sessionId));
  const res = await stub.fetch(
    new Request(`http://agent.internal/agents/${name}/${sessionId}/runs/${runId}`, { method: 'GET' }),
  );
  if (!res.ok) {
    throw new Error(
      `[poof-flue] getAgentRun ${name}/${sessionId}/${runId} → ${res.status}: ${await res.text().catch(() => '')}`,
    );
  }
  return (await res.json()) as { status: string; result?: T; error?: string };
}

/**
 * Stream events for a specific run as Server-Sent Events. Works for
 * live runs (started via `enqueueAgentRun`) or completed ones (replays
 * persisted events). Returns the raw SSE Response — forward directly
 * from your route handler to the client.
 */
export async function streamAgentRunEvents(
  env: unknown,
  name: string,
  sessionId: string,
  runId: string,
): Promise<Response> {
  const binding = resolveAgentBinding(env, name);
  const stub = binding.get(binding.idFromName(sessionId));
  return stub.fetch(
    new Request(`http://agent.internal/agents/${name}/${sessionId}/runs/${runId}/stream`, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    }),
  );
}
