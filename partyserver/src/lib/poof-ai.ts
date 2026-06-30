/**
 * Poof AI helper — the one way to call AI models (Workers AI, OpenAI,
 * Anthropic, Google, xAI, Groq, etc.) from a Poof user worker.
 *
 * Why go through this:
 *   Every AI call is metered to the project's credit budget and rejected
 *   when the project is over its limit, using the same billing pipeline
 *   that handles CPU/request usage. The platform pays Cloudflare for all
 *   inference (Workers AI billed directly, third-party providers via
 *   Cloudflare AI Gateway Unified Billing) and charges your project
 *   credits at exact provider cost × markup. Bypassing this helper means
 *   the call goes nowhere — direct provider SDKs aren't wired into user
 *   workers.
 *
 * How identity works:
 *   The worker simply does `fetch('https://poof-ai.internal/run', ...)`.
 *   Cloudflare's dispatch runtime routes every outbound fetch from this
 *   worker through the platform's outbound worker, which attaches the
 *   dispatcher-supplied script name and forwards to the AI proxy. Nothing
 *   the user worker sets in headers or env affects the attribution — the
 *   script name is sealed by Cloudflare at dispatch time.
 *
 * Model names use Cloudflare AI Gateway's compat format `provider/model`:
 *   - `openai/gpt-4o-mini`
 *   - `anthropic/claude-haiku-4-5`
 *   - `google-ai-studio/gemini-2.5-flash`
 *   - `workers-ai/@cf/meta/llama-3.1-8b-instruct` (or shorthand: `@cf/meta/llama-3.1-8b-instruct`)
 *
 * Return shape:
 *   - Chat-compatible models return OpenAI Chat Completions:
 *   {
 *     id, object, created, model,
 *     choices: [{ index, message: { role, content }, finish_reason }],
 *     usage: { prompt_tokens, completion_tokens, total_tokens },
 *   }
 *   - Native Workers AI models (embeddings, image generation, classifiers,
 *     vision/image input, audio) return their model-native shape.
 *
 * Usage:
 *   import { aiRun } from './lib/poof-ai.js';
 *   const result = await aiRun(c.env, 'openai/gpt-4o-mini', {
 *     messages: [{ role: 'user', content: 'Hi' }],
 *   });
 *   const text = result.choices[0].message.content;
 *
 * Streaming (OpenAI SSE format):
 *   const stream = await aiRun(c.env, model, { messages }, { stream: true });
 *   return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
 *
 * With Poof usage/billing metadata:
 *   const { result, usage } = await aiRun(c.env, model, { messages },
 *     { includeUsage: true });
 *   // result.choices[0].message.content is the model output
 *   // usage.costCredits is what got billed against the project
 *
 * Cloudflare Workers AI native models (embeddings, image, audio, vision):
 *   `@cf/baai/bge-*`, `@cf/llava-hf/llava-1.5-7b-hf`,
 *   `@cf/google/gemma-4-26b-a4b-it`,
 *   `@cf/microsoft/resnet-50`, `@cf/facebook/detr-resnet-50`,
 *   `@cf/black-forest-labs/*`, `@cf/openai/whisper-*`, `@cf/deepgram/*`,
 *   `@cf/myshell-ai/*` etc. work through aiRun too — the proxy auto-routes
 *   them to the native /workers-ai/{model} endpoint and returns the model's
 *   native shape (e.g. `{data, shape}` for embeddings, `{description}` for
 *   LLaVA image-to-text, OpenAI Chat Completions for Gemma vision chat, and
 *   `ArrayBuffer` for image/audio bytes). Type the generic accordingly.
 *   Third-party provider-native embeddings, image generation/editing, audio,
 *   and video endpoints are NOT wired up — use Cloudflare-hosted native
 *   models for those.
 *
 * Workers AI image input:
 *   const result = await aiRun<WorkersAiVisionOutput>(
 *     c.env,
 *     '@cf/google/gemma-4-26b-a4b-it',
 *     {
 *       messages: [{ role: 'user', content: [
 *         textPart('Describe this image'),
 *         imageUrlPart(imageDataUrl(base64Png, 'image/png')),
 *       ] }],
 *     },
 *     { max_completion_tokens: 128 },
 *   );
 *   const text = extractWorkersAiText(result);
 *
 * Read text from an image (OCR-style):
 *   const result = await aiRun<WorkersAiVisionOutput>(
 *     c.env,
 *     '@cf/google/gemma-4-26b-a4b-it',
 *     {
 *       messages: [{ role: 'user', content: [
 *         textPart('Read all visible text exactly. Preserve line breaks.'),
 *         imageUrlPart(imageDataUrl(base64Png, 'image/png')),
 *       ] }],
 *     },
 *     { max_completion_tokens: 256 },
 *   );
 *   const visibleText = extractWorkersAiText(result);
 */
import type { Context } from 'hono';

// Sentinel hostname the outbound worker intercepts. Never resolves in DNS;
// Cloudflare's dispatch runtime hands the request to poof-ai-outbound
// before any resolution happens.
const AI_SENTINEL_URL = 'https://poof-ai.internal/run';

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  cloudflareCostUsd: number;
  billableUsd: number;
  costCredits: number;
  estimated: boolean;
  logId: string | null;
}

export interface AiRunWithUsage<T> {
  result: T;
  usage: AiUsage;
}

export const POOF_AI_MAX_JSON_REQUEST_BYTES = 8 * 1024 * 1024;
export const POOF_AI_MAX_NUMBER_ARRAY_IMAGE_BYTES = 1_500_000;

export type AiImageInput = string | number[];

export type AiChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AiChatMessage {
  role: string;
  content: string | AiChatMessageContentPart[];
}

export interface WorkersAiVisionInputs {
  messages?: AiChatMessage[];
  prompt?: string;
  image?: AiImageInput;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  [key: string]: unknown;
}

export interface WorkersAiVisionOutput {
  response?: string;
  description?: string;
  text?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      role?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface ImageBytesToNumberArrayOptions {
  maxBytes?: number;
}

export class AiImageTooLargeError extends Error {
  constructor(bytes: number, maxBytes: number) {
    super(
      `image is ${bytes} bytes; imageBytesToNumberArray supports up to ${maxBytes} bytes before JSON exceeds the Poof AI request limit`,
    );
    this.name = 'AiImageTooLargeError';
  }
}

export function imageBytesToNumberArray(
  bytes: ArrayBuffer | Uint8Array,
  options: ImageBytesToNumberArrayOptions = {},
): number[] {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const maxBytes = options.maxBytes ?? POOF_AI_MAX_NUMBER_ARRAY_IMAGE_BYTES;
  if (Number.isFinite(maxBytes) && view.byteLength > maxBytes) {
    throw new AiImageTooLargeError(view.byteLength, maxBytes);
  }
  return Array.from(view);
}

export function imageDataUrl(base64: string, mediaType = 'image/png'): string {
  return base64.startsWith('data:') ? base64 : `data:${mediaType};base64,${base64}`;
}

export function textPart(text: string): AiChatMessageContentPart {
  return { type: 'text', text };
}

export function imageUrlPart(url: string): AiChatMessageContentPart {
  return { type: 'image_url', image_url: { url } };
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function extractWorkersAiText(result: WorkersAiVisionOutput): string {
  const message = result.choices?.find((choice) => choice.message)?.message;
  return (
    nonEmptyText(message?.content) ??
    nonEmptyText(result.response) ??
    nonEmptyText(result.description) ??
    nonEmptyText(result.text) ??
    ''
  );
}

export type AiRunOptions = {
  stream?: boolean;
  includeUsage?: boolean;
} & Record<string, unknown>;

type AiRunStreamOptions = AiRunOptions & {
  stream: true;
};

type AiRunWithUsageOptions = AiRunOptions & {
  includeUsage: true;
  stream?: false | undefined;
};

type AiRunPlainOptions = AiRunOptions & {
  stream?: false | undefined;
  includeUsage?: false | undefined;
};

export class AiBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiBlockedError';
  }
}

export class AiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

function usageFromHeaders(headers: Headers): AiUsage | null {
  const costCredits = headers.get('x-poof-ai-cost-credits');
  const cloudflareCostUsd = headers.get('x-poof-ai-cloudflare-cost-usd');
  const billableUsd = headers.get('x-poof-ai-billable-usd');
  if (!costCredits || !cloudflareCostUsd || !billableUsd) return null;
  return {
    promptTokens: Number(headers.get('x-poof-ai-prompt-tokens') ?? 0),
    completionTokens: Number(headers.get('x-poof-ai-completion-tokens') ?? 0),
    cloudflareCostUsd: Number(cloudflareCostUsd),
    billableUsd: Number(billableUsd),
    costCredits: Number(costCredits),
    estimated: headers.get('x-poof-ai-estimated') === 'true',
    logId: headers.get('x-poof-ai-log-id'),
  };
}

export async function aiRun(
  _env: unknown,
  model: string,
  inputs: Record<string, unknown>,
  options: AiRunStreamOptions,
): Promise<ReadableStream<Uint8Array>>;
export async function aiRun<T = unknown>(
  _env: unknown,
  model: string,
  inputs: Record<string, unknown>,
  options: AiRunWithUsageOptions,
): Promise<AiRunWithUsage<T>>;
export async function aiRun<T = unknown>(
  _env: unknown,
  model: string,
  inputs: Record<string, unknown>,
  options?: AiRunPlainOptions,
): Promise<T>;
export async function aiRun<T = unknown>(
  _env: unknown,
  model: string,
  inputs: Record<string, unknown>,
  options?: AiRunOptions,
): Promise<T | ReadableStream<Uint8Array> | AiRunWithUsage<T>> {
  const res = await fetch(AI_SENTINEL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, inputs, options }),
  });

  if (res.status === 403) {
    const text = await res.text().catch(() => 'blocked');
    throw new AiBlockedError(text);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new AiError(text, res.status);
  }

  if (options?.stream) {
    if (!res.body) throw new AiError('streaming response missing body', 502);
    return res.body;
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (options?.includeUsage) {
    if (contentType.includes('application/json')) {
      const body = await res.json();
      // Proxy wraps non-streaming includeUsage as `{result, usage}` where
      // `result` is the raw OpenAI Chat Completions response. Pass through.
      if (
        body &&
        typeof body === 'object' &&
        'result' in body &&
        'usage' in body
      ) {
        return body as AiRunWithUsage<T>;
      }
      const usage = usageFromHeaders(res.headers);
      if (!usage) throw new AiError('usage metadata missing from AI response', 502);
      return { result: body as T, usage };
    }

    const usage = usageFromHeaders(res.headers);
    if (!usage) throw new AiError('usage metadata missing from AI response', 502);
    return { result: (await res.arrayBuffer()) as T, usage };
  }

  if (!contentType.includes('application/json')) {
    return (await res.arrayBuffer()) as T;
  }

  return (await res.json()) as T;
}

// Convenience for Hono handlers.
export async function aiRunForContext(
  c: Context,
  model: string,
  inputs: Record<string, unknown>,
  options: AiRunStreamOptions,
): Promise<ReadableStream<Uint8Array>>;
export async function aiRunForContext<T = unknown>(
  c: Context,
  model: string,
  inputs: Record<string, unknown>,
  options: AiRunWithUsageOptions,
): Promise<AiRunWithUsage<T>>;
export async function aiRunForContext<T = unknown>(
  c: Context,
  model: string,
  inputs: Record<string, unknown>,
  options?: AiRunPlainOptions,
): Promise<T>;
export async function aiRunForContext<T = unknown>(
  c: Context,
  model: string,
  inputs: Record<string, unknown>,
  options?: AiRunOptions,
): Promise<T | ReadableStream<Uint8Array> | AiRunWithUsage<T>> {
  if (options?.stream) {
    return aiRun(c.env, model, inputs, options as AiRunStreamOptions);
  }
  if (options?.includeUsage) {
    return aiRun<T>(c.env, model, inputs, options as AiRunWithUsageOptions);
  }
  return aiRun<T>(c.env, model, inputs, options as AiRunPlainOptions | undefined);
}
