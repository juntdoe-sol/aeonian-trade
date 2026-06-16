/**
 * Queues — asynchronous background job registry.
 *
 * To add a queue consumer:
 * 1. Create a handler file in this directory (e.g. send-email.ts)
 * 2. Import and register it in the `handlers` map below
 * 3. Add the queue entry to queues.json
 * 4. Deploy — Cloudflare Queue resources and bindings are provisioned by Poof
 *
 * In Poof Cloud, user API workers are deployed into a Cloudflare Workers for
 * Platforms dispatch namespace. Cloudflare Queue worker consumers target a
 * platform-owned dispatcher worker, which forwards jobs here through the
 * /__internal/queues/:queueName route. The exported queue() handler remains for
 * local/account-worker compatibility.
 */

import queuesConfig from '../../queues.json';
import type { Context, Hono } from 'hono';
import { sendSuccess } from '../lib/api-response.js';
import {
  recordQueueJobStatus,
  resolvePoofAppId,
} from '../lib/poof-queue.js';
import type { QueueJobStatus } from '../lib/poof-queue-job-tracker.js';

interface QueueConfigEntry {
  name: string;
  enabled: boolean;
  consumer?: {
    maxRetries?: number;
    retryDelaySeconds?: number;
  };
}

interface QueueEnvelope {
  __poofQueue: string;
  __poofAppId?: string;
  __poofJobId?: string;
  payload: unknown;
}

interface RawQueueMessage {
  id?: string;
  attempts?: number;
  body: unknown;
  ack?: () => void;
  retry?: (options?: { delaySeconds?: number }) => void;
}

interface RawQueueBatch {
  queue?: string;
  messages: RawQueueMessage[];
}

export interface QueueJob<TPayload = unknown> {
  queueName: string;
  payload: TPayload;
  /** Poof-tracked queue job id. Present when enqueued with enqueueQueue(). */
  jobId?: string;
  /** Back-compatible alias: tracked job id when present, otherwise Cloudflare message id. */
  id?: string;
  cloudflareMessageId?: string;
  attempts: number;
}

export interface QueueHandlerContext {
  env: Record<string, unknown>;
  ctx?: unknown;
  rawMessage: RawQueueMessage;
  updateStatus: (update: { status?: QueueJobStatus; message?: string; metadata?: Record<string, unknown> }) => Promise<void>;
}

export type QueueHandler<TPayload = unknown> = (
  job: QueueJob<TPayload>,
  context: QueueHandlerContext,
) => Promise<void> | void;

const VALID_QUEUE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Import your queue handlers here:
// import { sendEmail } from './send-email.js';

/** Maps queue names from queues.json to handler functions. */
const handlers: Record<string, QueueHandler> = {
  // Register your handlers here:
  // 'emails': sendEmail,
};

function assertValidQueueName(queueName: string): string {
  if (!VALID_QUEUE_NAME.test(queueName)) {
    throw new Error('Invalid queue name');
  }
  return queueName;
}

function getQueueConfig(queueName: string): QueueConfigEntry | undefined {
  const validQueueName = assertValidQueueName(queueName);
  return (queuesConfig.queues as QueueConfigEntry[]).find((queue) => queue.name === validQueueName);
}

function unwrapMessage(rawMessage: RawQueueMessage): QueueEnvelope {
  const body = rawMessage.body as Partial<QueueEnvelope> | null;
  if (!body || typeof body !== 'object' || typeof body.__poofQueue !== 'string') {
    throw new Error('Queue message is missing the Poof queue envelope');
  }
  return {
    __poofQueue: assertValidQueueName(body.__poofQueue),
    __poofAppId: body.__poofAppId,
    __poofJobId: body.__poofJobId,
    payload: body.payload,
  };
}

function verifyInternalQueueDispatch(c: Context): Response | null {
  let expectedAppId: string;
  try {
    expectedAppId = resolvePoofAppId(c.env as Record<string, unknown>);
  } catch {
    return c.json({ success: false, error: 'Queue dispatch unavailable' }, 500);
  }

  const headerAppId = c.req.header('x-tarobase-app-id');
  const dispatchKind = c.req.header('x-poof-internal-dispatch');
  if (headerAppId !== expectedAppId || dispatchKind !== 'queue') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  return null;
}

function resolveTrackingAppId(envelope: QueueEnvelope, env: Record<string, unknown>): string | undefined {
  if (typeof envelope.__poofAppId === 'string' && envelope.__poofAppId) return envelope.__poofAppId;
  try {
    return resolvePoofAppId(env);
  } catch {
    return undefined;
  }
}

async function safeRecordQueueJobStatus(
  env: Record<string, unknown>,
  appId: string | undefined,
  jobId: string | undefined,
  update: {
    queueName: string;
    status: QueueJobStatus;
    attempts?: number;
    cloudflareMessageId?: string;
    error?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!appId || !jobId) return;
  try {
    await recordQueueJobStatus(env, appId, jobId, {
      appId,
      queueName: update.queueName,
      status: update.status,
      attempts: update.attempts,
      cloudflareMessageId: update.cloudflareMessageId,
      error: update.error,
      message: update.message,
      metadata: update.metadata,
    });
  } catch (error) {
    console.error(`[queue] Failed to update tracked job ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function processEnvelope(
  envelope: QueueEnvelope,
  rawMessage: RawQueueMessage,
  env: Record<string, unknown>,
  ctx?: unknown,
): Promise<void> {
  const queueConfig = getQueueConfig(envelope.__poofQueue);
  if (!queueConfig || !queueConfig.enabled) {
    throw new Error(`Queue "${envelope.__poofQueue}" is not enabled in queues.json`);
  }

  const appId = resolveTrackingAppId(envelope, env);
  const jobId = envelope.__poofJobId;
  const attempts = rawMessage.attempts ?? 1;
  const handler = handlers[envelope.__poofQueue];
  if (!handler) {
    const error = `No handler registered for queue "${envelope.__poofQueue}". Add it to src/queues/index.ts`;
    const maxRetries = queueConfig.consumer?.maxRetries ?? 3;
    await safeRecordQueueJobStatus(env, appId, jobId, {
      queueName: envelope.__poofQueue,
      status: attempts > maxRetries ? 'failed' : 'retrying',
      attempts,
      cloudflareMessageId: rawMessage.id,
      error,
    });
    throw new Error(error);
  }

  await safeRecordQueueJobStatus(env, appId, jobId, {
    queueName: envelope.__poofQueue,
    status: 'running',
    attempts,
    cloudflareMessageId: rawMessage.id,
  });

  try {
    await handler(
      {
        queueName: envelope.__poofQueue,
        payload: envelope.payload,
        jobId,
        id: jobId || rawMessage.id,
        cloudflareMessageId: rawMessage.id,
        attempts,
      },
      {
        env,
        ctx,
        rawMessage,
        updateStatus: async (update) => {
          await safeRecordQueueJobStatus(env, appId, jobId, {
            queueName: envelope.__poofQueue,
            status: update.status || 'running',
            attempts,
            cloudflareMessageId: rawMessage.id,
            message: update.message,
            metadata: update.metadata,
          });
        },
      },
    );

    await safeRecordQueueJobStatus(env, appId, jobId, {
      queueName: envelope.__poofQueue,
      status: 'succeeded',
      attempts,
      cloudflareMessageId: rawMessage.id,
    });
  } catch (error) {
    const maxRetries = queueConfig.consumer?.maxRetries ?? 3;
    await safeRecordQueueJobStatus(env, appId, jobId, {
      queueName: envelope.__poofQueue,
      status: attempts > maxRetries ? 'failed' : 'retrying',
      attempts,
      cloudflareMessageId: rawMessage.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function markEnvelopeDeadLetter(
  queueName: string,
  payload: unknown,
  env: Record<string, unknown>,
  options: { id?: string; attempts?: number; jobId?: string },
): Promise<void> {
  const queueConfig = getQueueConfig(queueName);
  if (!queueConfig || !queueConfig.enabled) {
    throw new Error(`Queue "${queueName}" is not enabled in queues.json`);
  }

  const appId = (() => {
    try {
      return resolvePoofAppId(env);
    } catch {
      return undefined;
    }
  })();

  await safeRecordQueueJobStatus(env, appId, options.jobId, {
    queueName,
    status: 'dead_lettered',
    attempts: options.attempts ?? 1,
    cloudflareMessageId: options.id,
    error: 'Queue message reached the dead letter queue',
  });
}

export async function markQueuePayloadDeadLetter(
  queueName: string,
  payload: unknown,
  env: Record<string, unknown>,
  options: { id?: string; attempts?: number; jobId?: string } = {},
): Promise<void> {
  await markEnvelopeDeadLetter(queueName, payload, env, options);
}

async function processMessage(rawMessage: RawQueueMessage, env: Record<string, unknown>, ctx?: unknown): Promise<void> {
  await processEnvelope(unwrapMessage(rawMessage), rawMessage, env, ctx);
}

export async function processQueuePayload(
  queueName: string,
  payload: unknown,
  env: Record<string, unknown>,
  options: { id?: string; attempts?: number; jobId?: string; ctx?: unknown } = {},
): Promise<void> {
  const validQueueName = assertValidQueueName(queueName);
  const rawMessage: RawQueueMessage = {
    id: options.id,
    attempts: options.attempts,
    body: { __poofQueue: validQueueName, __poofJobId: options.jobId, payload },
  };
  await processEnvelope({ __poofQueue: validQueueName, __poofJobId: options.jobId, payload }, rawMessage, env, options.ctx);
}

export async function processQueueBatch(
  batch: RawQueueBatch,
  env: Record<string, unknown>,
  ctx?: unknown,
): Promise<void> {
  await Promise.allSettled(
    batch.messages.map(async (message) => {
      try {
        await processMessage(message, env, ctx);
        message.ack?.();
      } catch (error) {
        const queueName = (() => {
          try {
            return unwrapMessage(message).__poofQueue;
          } catch {
            return batch.queue || 'unknown';
          }
        })();
        const retryDelaySeconds = (() => {
          try {
            return getQueueConfig(queueName)?.consumer?.retryDelaySeconds ?? 60;
          } catch {
            return 60;
          }
        })();
        console.error(
          `[queue] Failed ${queueName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        message.retry?.({ delaySeconds: retryDelaySeconds });
      }
    }),
  );
}

/** Register internal queue dispatch routes used by the platform queue dispatcher. */
export function registerQueueRoutes(app: Hono): void {
  // Internal routes are reachable only through the platform dispatch namespace:
  // generated workers deploy with workers_dev=false, and poofproxy returns 404
  // for public /__internal/* requests. The headers below are an additional
  // target check for dispatcher calls, not a public authentication mechanism.
  app.post('/__internal/queues/:queueName', async (c) => {
    const unauthorized = verifyInternalQueueDispatch(c);
    if (unauthorized) return unauthorized;

    let queueName: string;
    try {
      queueName = assertValidQueueName(c.req.param('queueName'));
    } catch {
      return c.json({ success: false, error: 'Invalid queue name' }, 400);
    }

    let body: { payload?: unknown; id?: unknown; attempts?: unknown; jobId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    try {
      await processQueuePayload(queueName, body.payload, c.env as Record<string, unknown>, {
        id: typeof body.id === 'string' ? body.id : undefined,
        attempts: typeof body.attempts === 'number' ? body.attempts : undefined,
        jobId: typeof body.jobId === 'string' ? body.jobId : undefined,
        ctx: c.executionCtx,
      });
      return sendSuccess(c, { queue: queueName, status: 'completed' });
    } catch (error) {
      console.error(`[queue] Internal dispatch failed for "${queueName}":`, error);
      return c.json({ success: false, error: 'Queue execution failed' }, 500);
    }
  });

  app.post('/__internal/queues/:queueName/dead-letter', async (c) => {
    const unauthorized = verifyInternalQueueDispatch(c);
    if (unauthorized) return unauthorized;

    let queueName: string;
    try {
      queueName = assertValidQueueName(c.req.param('queueName'));
    } catch {
      return c.json({ success: false, error: 'Invalid queue name' }, 400);
    }

    let body: { payload?: unknown; id?: unknown; attempts?: unknown; jobId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    try {
      await markQueuePayloadDeadLetter(queueName, body.payload, c.env as Record<string, unknown>, {
        id: typeof body.id === 'string' ? body.id : undefined,
        attempts: typeof body.attempts === 'number' ? body.attempts : undefined,
        jobId: typeof body.jobId === 'string' ? body.jobId : undefined,
      });
      return sendSuccess(c, { queue: queueName, status: 'dead_lettered' });
    } catch (error) {
      console.error(`[queue] Dead letter status update failed for "${queueName}":`, error);
      return c.json({ success: false, error: 'Queue dead letter update failed' }, 500);
    }
  });
}
