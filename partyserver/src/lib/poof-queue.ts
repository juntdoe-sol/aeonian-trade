import type { Context } from 'hono';
import queuesConfig from '../../queues.json';
import type {
  QueueJobRecord,
  QueueJobStatus,
  QueueJobStatusUpdate,
} from './poof-queue-job-tracker.js';
export type { QueueJobRecord, QueueJobStatus } from './poof-queue-job-tracker.js';

interface QueueBinding {
  send(body: unknown, options?: { delaySeconds?: number }): Promise<void>;
  sendBatch(
    messages: Array<{ body: unknown }>,
    options?: { delaySeconds?: number },
  ): Promise<void>;
}

interface QueueConfigEntry {
  name: string;
  enabled: boolean;
}

interface QueueEnvelope {
  __poofQueue: string;
  __poofAppId: string;
  __poofJobId?: string;
  payload: unknown;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  };
}

export interface EnqueuedQueueJob {
  jobId: string;
  status: QueueJobStatus;
  queueName: string;
}

/**
 * Context shape accepted by the public queue helpers. Anything carrying a
 * Cloudflare Workers `env` bag works:
 * - Hono `Context` from a route handler (`c`)
 * - `QueueHandlerContext` from inside a queue consumer (`context`)
 *
 * This lets handlers call `enqueueQueue(context, ...)` to chain or fan out
 * follow-up jobs without faking a Hono Context.
 */
export type QueueOpsContext = Context | { env: Record<string, unknown> };

function envOf(c: QueueOpsContext): Record<string, unknown> {
  return c.env as Record<string, unknown>;
}

const MAX_QUEUE_MESSAGE_BYTES = 128_000;
const MAX_QUEUE_BATCH_BYTES = 256_000;
const MAX_QUEUE_BATCH_SIZE = 100;
const MAX_QUEUE_DELAY_SECONDS = 86_400;
const VALID_QUEUE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function queueBindingName(queueName: string): string {
  const normalized = queueName.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_');
  return `POOF_QUEUE_${normalized}`;
}

function getQueueConfig(queueName: string): QueueConfigEntry {
  if (!VALID_QUEUE_NAME.test(queueName)) {
    throw new Error(`Invalid queue name: ${queueName}`);
  }

  const queue = (queuesConfig.queues as QueueConfigEntry[]).find((entry) => entry.name === queueName);
  if (!queue) {
    throw new Error(`Queue "${queueName}" is not defined in queues.json`);
  }
  if (!queue.enabled) {
    throw new Error(`Queue "${queueName}" is disabled`);
  }
  return queue;
}

function payloadBytes(payload: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch (error) {
    throw new Error(`Queue payload must be JSON serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (serialized === undefined) {
    throw new Error('Queue payload must be JSON serializable');
  }
  return new TextEncoder().encode(serialized).length;
}

function assertPayloadSize(payload: unknown): number {
  const bytes = payloadBytes(payload);
  if (bytes > MAX_QUEUE_MESSAGE_BYTES) {
    throw new Error(`Queue payload is ${bytes} bytes; max is ${MAX_QUEUE_MESSAGE_BYTES} bytes`);
  }
  return bytes;
}

function resolveQueue(c: QueueOpsContext, queueName: string): QueueBinding {
  const queue = getQueueConfig(queueName);
  const binding = queueBindingName(queue.name);
  const env = envOf(c);
  const queueBinding = env[binding] as QueueBinding | undefined;
  if (!queueBinding) {
    throw new Error(`Queue binding "${binding}" is not available. Deploy this worker after editing queues.json.`);
  }
  return queueBinding;
}

export function resolvePoofAppId(env: Record<string, unknown>): string {
  const appId = env.TAROBASE_APP_ID || process.env.TAROBASE_APP_ID;
  if (typeof appId !== 'string' || !appId) {
    throw new Error('TAROBASE_APP_ID is not available for queue enqueue');
  }
  return appId;
}

function resolveAppId(c: QueueOpsContext): string {
  return resolvePoofAppId(envOf(c));
}

function createQueueEnvelope(queueName: string, appId: string, payload: unknown, jobId?: string): QueueEnvelope {
  return jobId
    ? { __poofQueue: queueName, __poofAppId: appId, __poofJobId: jobId, payload }
    : { __poofQueue: queueName, __poofAppId: appId, payload };
}

function sendOptions(options: { delaySeconds?: number }): { delaySeconds?: number } | undefined {
  if (options.delaySeconds === undefined) return undefined;
  if (!Number.isFinite(options.delaySeconds)) {
    throw new Error('Queue delaySeconds must be a finite number');
  }
  const delaySeconds = Math.floor(options.delaySeconds);
  if (delaySeconds < 0 || delaySeconds > MAX_QUEUE_DELAY_SECONDS) {
    throw new Error(`Queue delaySeconds must be between 0 and ${MAX_QUEUE_DELAY_SECONDS}`);
  }
  return { delaySeconds };
}

function createQueueJobId(): string {
  const randomPart = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16)
    || Math.random().toString(36).slice(2, 12);
  return `qjob_${Date.now().toString(36)}_${randomPart}`;
}

function resolveTracker(env: Record<string, unknown>, appId: string) {
  const namespace = env.POOF_QUEUE_JOB_TRACKER as DurableObjectNamespaceLike | undefined;
  if (!namespace) {
    throw new Error('POOF_QUEUE_JOB_TRACKER Durable Object binding is not available');
  }
  return namespace.get(namespace.idFromName(appId));
}

async function trackerFetch(
  env: Record<string, unknown>,
  appId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return resolveTracker(env, appId).fetch(`https://poof-queue-jobs${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

export async function recordQueueJobStatus(
  env: Record<string, unknown>,
  appId: string,
  jobId: string | undefined,
  update: QueueJobStatusUpdate,
): Promise<void> {
  if (!jobId) return;
  const response = await trackerFetch(env, appId, `/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...update, appId }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Failed to update queue job ${jobId}: ${response.status}${detail ? ` ${detail}` : ''}`);
  }
}

export async function getQueueJobStatus(c: QueueOpsContext, jobId: string): Promise<QueueJobRecord | null> {
  const appId = resolveAppId(c);
  const response = await trackerFetch(envOf(c), appId, `/jobs/${encodeURIComponent(jobId)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to load queue job ${jobId}: ${response.status}`);
  }
  const body = await response.json() as { job?: QueueJobRecord };
  return body.job || null;
}

export async function listQueueJobs(
  c: QueueOpsContext,
  options: { queueName?: string; status?: QueueJobStatus; limit?: number } = {},
): Promise<QueueJobRecord[]> {
  const appId = resolveAppId(c);
  const query = new URLSearchParams();
  if (options.queueName) query.set('queueName', options.queueName);
  if (options.status) query.set('status', options.status);
  if (options.limit) query.set('limit', String(options.limit));
  const suffix = query.toString() ? `?${query}` : '';
  const response = await trackerFetch(envOf(c), appId, `/jobs${suffix}`);
  if (!response.ok) {
    throw new Error(`Failed to list queue jobs: ${response.status}`);
  }
  const body = await response.json() as { jobs?: QueueJobRecord[] };
  return body.jobs || [];
}

export async function streamQueueJobStatus(c: QueueOpsContext, jobId: string): Promise<Response> {
  const appId = resolveAppId(c);
  return resolveTracker(envOf(c), appId)
    .fetch(`https://poof-queue-jobs/jobs/${encodeURIComponent(jobId)}/events`);
}

export async function enqueueQueue(
  c: QueueOpsContext,
  queueName: string,
  payload: unknown,
  options: { delaySeconds?: number; jobId?: string } = {},
): Promise<EnqueuedQueueJob> {
  const queue = resolveQueue(c, queueName);
  const env = envOf(c);
  const appId = resolveAppId(c);
  const jobId = options.jobId || createQueueJobId();
  const envelope = createQueueEnvelope(queueName, appId, payload, jobId);
  assertPayloadSize(envelope);

  await recordQueueJobStatus(env, appId, jobId, {
    appId,
    queueName,
    status: 'enqueueing',
    delaySeconds: options.delaySeconds,
  });
  // Record queued before sending so a successful queue.send cannot be followed
  // by a tracker write failure that leaves the job stuck at enqueueing.
  await recordQueueJobStatus(env, appId, jobId, {
    appId,
    queueName,
    status: 'queued',
    delaySeconds: options.delaySeconds,
  });

  try {
    await queue.send(envelope, sendOptions(options));
    return { jobId, status: 'queued', queueName };
  } catch (error) {
    await recordQueueJobStatus(env, appId, jobId, {
      appId,
      queueName,
      status: 'send_failed',
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}

export async function enqueueQueueBatch(
  c: QueueOpsContext,
  queueName: string,
  payloads: unknown[],
  options: { delaySeconds?: number; jobIds?: string[] } = {},
): Promise<{ jobs: EnqueuedQueueJob[] }> {
  if (payloads.length === 0) {
    throw new Error('Queue batch must include at least one message');
  }
  if (payloads.length > MAX_QUEUE_BATCH_SIZE) {
    throw new Error(`Queue batch has ${payloads.length} messages; max is ${MAX_QUEUE_BATCH_SIZE}`);
  }
  if (options.jobIds && options.jobIds.length !== payloads.length) {
    throw new Error('jobIds length must match payloads length');
  }

  const queue = resolveQueue(c, queueName);
  const env = envOf(c);
  const appId = resolveAppId(c);
  const jobIds = options.jobIds || payloads.map(() => createQueueJobId());
  const messages = payloads.map((payload, index) => {
    const envelope = createQueueEnvelope(queueName, appId, payload, jobIds[index]);
    assertPayloadSize(envelope);
    return { body: envelope };
  });
  const batchBytes = payloadBytes({ messages });
  if (batchBytes > MAX_QUEUE_BATCH_BYTES) {
    throw new Error(`Queue batch is ${batchBytes} bytes; max is ${MAX_QUEUE_BATCH_BYTES}`);
  }

  await Promise.all(jobIds.map((jobId, index) => recordQueueJobStatus(env, appId, jobId, {
    appId,
    queueName,
    status: 'enqueueing',
    delaySeconds: options.delaySeconds,
    metadata: { batchIndex: index, batchSize: payloads.length },
  })));
  // Same ordering as enqueueQueue(): if Cloudflare accepts the batch,
  // status tracking has already moved all jobs past enqueueing.
  await Promise.all(jobIds.map((jobId, index) => recordQueueJobStatus(env, appId, jobId, {
    appId,
    queueName,
    status: 'queued',
    delaySeconds: options.delaySeconds,
    metadata: { batchIndex: index, batchSize: payloads.length },
  })));

  try {
    await queue.sendBatch(messages, sendOptions(options));
    return {
      jobs: jobIds.map((jobId) => ({ jobId, status: 'queued', queueName })),
    };
  } catch (error) {
    await Promise.all(jobIds.map((jobId) => recordQueueJobStatus(env, appId, jobId, {
      appId,
      queueName,
      status: 'send_failed',
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined)));
    throw error;
  }
}
