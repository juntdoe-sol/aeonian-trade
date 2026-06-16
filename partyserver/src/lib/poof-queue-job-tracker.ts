export type QueueJobStatus =
  | 'enqueueing'
  | 'queued'
  | 'running'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'dead_lettered'
  | 'send_failed';

export interface QueueJobEvent {
  status: QueueJobStatus;
  at: number;
  attempts?: number;
  cloudflareMessageId?: string;
  message?: string;
}

export interface QueueJobRecord {
  id: string;
  appId: string;
  queueName: string;
  status: QueueJobStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  attempts?: number;
  cloudflareMessageId?: string;
  delaySeconds?: number;
  lastError?: string;
  metadata?: Record<string, unknown>;
  events: QueueJobEvent[];
}

export interface QueueJobStatusUpdate {
  appId?: string;
  queueName?: string;
  status: QueueJobStatus;
  attempts?: number;
  cloudflareMessageId?: string;
  delaySeconds?: number;
  error?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(options?: { prefix?: string; limit?: number; reverse?: boolean }): Promise<Map<string, T>>;
}

interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}

type QueueJobSubscriber = WritableStreamDefaultWriter<Uint8Array>;

const encoder = new TextEncoder();
const JOB_PREFIX = 'job:';
const MAX_EVENTS = 50;
const VALID_APP_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_QUEUE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const VALID_STATUSES: ReadonlySet<QueueJobStatus> = new Set([
  'enqueueing',
  'queued',
  'running',
  'retrying',
  'succeeded',
  'failed',
  'dead_lettered',
  'send_failed',
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function jobKey(jobId: string): string {
  return `${JOB_PREFIX}${jobId}`;
}

function sanitizeJobId(raw: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(raw)) {
    throw new Error('Invalid queue job id');
  }
  return raw;
}

function sanitizeAppId(raw: string): string {
  if (!VALID_APP_ID.test(raw)) {
    throw new Error('Invalid app id');
  }
  return raw;
}

function sanitizeQueueName(raw: string): string {
  if (!VALID_QUEUE_NAME.test(raw)) {
    throw new Error('Invalid queue name');
  }
  return raw;
}

function sanitizeStatus(raw: QueueJobStatus): QueueJobStatus {
  if (!VALID_STATUSES.has(raw)) {
    throw new Error('Invalid queue job status');
  }
  return raw;
}

function eventFrame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Durable Object reached through the POOF_QUEUE_JOB_TRACKER binding.
 * Do not proxy PUT/PATCH requests to public clients; mutations are intended
 * for the generated queue runtime and handlers via recordQueueJobStatus().
 */
export class QueueJobTracker {
  private subscribers = new Map<string, Set<QueueJobSubscriber>>();

  constructor(private state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'jobs') {
        return jsonResponse({ jobs: await this.listJobs(url) });
      }

      if (parts.length >= 2 && parts[0] === 'jobs') {
        const jobId = sanitizeJobId(parts[1]);

        if (request.method === 'GET' && parts.length === 2) {
          const job = await this.getJob(jobId);
          return job ? jsonResponse({ job }) : jsonResponse({ error: 'Queue job not found' }, 404);
        }

        if (request.method === 'GET' && parts.length === 3 && parts[2] === 'events') {
          return this.streamJobEvents(jobId, request);
        }

        if ((request.method === 'PUT' || request.method === 'PATCH') && parts.length === 2) {
          const update = await request.json() as QueueJobStatusUpdate;
          const job = await this.upsertJob(jobId, update);
          return jsonResponse({ job });
        }
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : 'Queue job tracker error' },
        400,
      );
    }
  }

  private async getJob(jobId: string): Promise<QueueJobRecord | undefined> {
    return this.state.storage.get<QueueJobRecord>(jobKey(jobId));
  }

  private async upsertJob(jobId: string, update: QueueJobStatusUpdate): Promise<QueueJobRecord> {
    const existing = await this.getJob(jobId);
    const now = Date.now();
    const appId = update.appId || existing?.appId;
    const queueName = update.queueName || existing?.queueName;
    if (!appId) throw new Error('Queue job update is missing appId');
    if (!queueName) throw new Error('Queue job update is missing queueName');
    const status = sanitizeStatus(update.status);
    const sanitizedAppId = sanitizeAppId(appId);
    const sanitizedQueueName = sanitizeQueueName(queueName);

    const event: QueueJobEvent = {
      status,
      at: now,
      attempts: update.attempts,
      cloudflareMessageId: update.cloudflareMessageId,
      message: update.message || update.error,
    };

    const events = [...(existing?.events || []), event].slice(-MAX_EVENTS);
    const record: QueueJobRecord = {
      id: jobId,
      appId: sanitizedAppId,
      queueName: sanitizedQueueName,
      status,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      startedAt: existing?.startedAt,
      completedAt: existing?.completedAt,
      failedAt: existing?.failedAt,
      attempts: update.attempts ?? existing?.attempts,
      cloudflareMessageId: update.cloudflareMessageId || existing?.cloudflareMessageId,
      delaySeconds: update.delaySeconds ?? existing?.delaySeconds,
      lastError: update.error ?? existing?.lastError,
      metadata: update.metadata ? { ...(existing?.metadata || {}), ...update.metadata } : existing?.metadata,
      events,
    };

    if (status === 'running' && !record.startedAt) {
      record.startedAt = now;
    }
    if (status === 'succeeded') {
      record.completedAt = now;
      record.lastError = undefined;
    }
    if (status === 'failed' || status === 'dead_lettered' || status === 'send_failed') {
      record.failedAt = now;
    }

    await this.state.storage.put(jobKey(jobId), record);
    this.broadcast(jobId, record);
    return record;
  }

  private async listJobs(url: URL): Promise<QueueJobRecord[]> {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
    const rawQueueName = url.searchParams.get('queueName');
    const rawStatus = url.searchParams.get('status');
    const queueName = rawQueueName ? sanitizeQueueName(rawQueueName) : null;
    const status = rawStatus ? sanitizeStatus(rawStatus as QueueJobStatus) : null;
    const entries = await this.state.storage.list<QueueJobRecord>({
      prefix: JOB_PREFIX,
      reverse: true,
      limit: 500,
    });

    const jobs: QueueJobRecord[] = [];
    for (const job of entries.values()) {
      if (queueName && job.queueName !== queueName) continue;
      if (status && job.status !== status) continue;
      jobs.push(job);
      if (jobs.length >= limit) break;
    }
    return jobs;
  }

  private streamJobEvents(jobId: string, request: Request): Response {
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const subscribers = this.subscribers.get(jobId) || new Set<QueueJobSubscriber>();
    subscribers.add(writer);
    this.subscribers.set(jobId, subscribers);

    const cleanup = () => {
      subscribers.delete(writer);
      if (subscribers.size === 0) this.subscribers.delete(jobId);
      writer.close().catch(() => undefined);
    };
    request.signal?.addEventListener('abort', cleanup, { once: true });

    this.getJob(jobId)
      .then((job) => writer.write(eventFrame('snapshot', job || null)))
      .catch(() => writer.write(eventFrame('snapshot', null)));

    return new Response(stream.readable, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  }

  private broadcast(jobId: string, job: QueueJobRecord): void {
    const subscribers = this.subscribers.get(jobId);
    if (!subscribers) return;
    for (const writer of [...subscribers]) {
      writer.write(eventFrame('update', job)).catch(() => {
        subscribers.delete(writer);
      });
    }
  }
}
