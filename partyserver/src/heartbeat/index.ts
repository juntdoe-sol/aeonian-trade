/**
 * Heartbeat — Scheduled task registry.
 *
 * This module connects heartbeat.json (config) to handler functions.
 * The config defines which tasks exist, their cron expressions, and whether
 * they're enabled. This file maps task names to their implementations.
 *
 * To add a scheduled task:
 * 1. Create a handler file in this directory (e.g., cleanup.ts)
 * 2. Import and register it in the `handlers` map below
 * 3. Add the task entry to heartbeat.json with a cron expression
 * 4. Deploy — schedules are registered with the platform heartbeat dispatcher
 *
 * Per-environment scheduling:
 * - `cron` is the default schedule (used for preview deployments)
 * - `schedule.live` overrides cron, startTime, and/or endTime for production deployments
 *
 * Trigger paths:
 * - Cron: platform dispatcher → /__internal/heartbeat/:taskName (via dispatch namespace)
 * - Manual: UI Run button → platform API → dispatcher → /__internal/heartbeat/:taskName
 * - Admin: POST /__heartbeat/:taskName (requires admin auth)
 *
 * See: .claude/skills/scheduled-tasks/SKILL.md for full guide.
 */

import heartbeatConfig from '../../heartbeat.json';
import type { Hono } from 'hono';
import { sendSuccess, ApiErrors } from '../lib/api-response.js';
import { validatePoofAuth } from '../lib/poof-auth.js';

// Import your task handlers here:
import { battleResolver } from './battle-resolver.js';
import { pnlLeaderboard } from './pnl-leaderboard.js';
import { liquidationDetect } from './liquidation-detect.js';
import { monthlyRewardFinalize } from './monthly-reward-finalize.js';

/** Task name format: lowercase alphanumeric, hyphens, underscores. Max 64 chars. */
const VALID_TASK_NAME = /^[a-z0-9_-]{1,64}$/;

/** Maps task names (from heartbeat.json) to handler functions. */
const handlers: Record<string, () => Promise<void>> = {
  'battle-resolver': battleResolver,
  'pnl-leaderboard': pnlLeaderboard,
  'liquidation-detect': liquidationDetect,
  'monthly-reward-finalize': monthlyRewardFinalize,
};

export interface HeartbeatTask {
  name: string;
  cron: string;
  handler: string;
  enabled: boolean;
  description?: string;
  /** Per-environment schedule overrides. */
  schedule?: {
    /** Production (live) overrides. Each field falls back to the top-level default. */
    live?: {
      cron?: string;
      startTime?: string;
      endTime?: string;
      enabled?: boolean;
    };
  };
}

/**
 * Run a single task by name. Used for manual triggers via /__heartbeat/:taskName.
 * Throws if the task doesn't exist or has no registered handler.
 */
export async function runHeartbeatTask(taskName: string): Promise<void> {
  const task = (heartbeatConfig.tasks as HeartbeatTask[]).find((t) => t.name === taskName);
  if (!task) {
    throw new Error(`Task "${taskName}" not found in heartbeat.json`);
  }

  const handler = handlers[task.name];
  if (!handler) {
    throw new Error(`No handler registered for task "${task.name}". Add it to src/heartbeat/index.ts`);
  }

  console.log(`[heartbeat] Manual trigger: "${task.name}"`);
  await handler();
  console.log(`[heartbeat] Completed "${task.name}"`);
}

/**
 * Register heartbeat routes on the Hono app.
 * Called from src/index.ts to keep routes/index.ts clean and user-editable.
 *
 * Two routes:
 * - POST /__heartbeat/:taskName — Manual trigger (requires admin auth)
 * - POST /__internal/heartbeat/:taskName — Internal trigger from cron dispatcher
 *
 * The internal route requires no auth because access is enforced by two layers:
 * 1. poofproxy blocks all `/__internal/*` requests from the public internet (returns 404)
 * 2. Only the platform-owned heartbeat dispatcher can reach user workers through the
 *    Cloudflare dispatch namespace binding (`poof_apps`), which requires Cloudflare
 *    account access to configure — no user worker can be spoofed into this namespace
 */
export function registerHeartbeatRoutes(app: Hono): void {
  // Manual trigger — requires admin auth
  app.post('/__heartbeat/:taskName', async (c) => {
    await validatePoofAuth(c, true);
    const taskName = c.req.param('taskName');
    if (!VALID_TASK_NAME.test(taskName)) {
      return ApiErrors.badRequest(c, 'Invalid task name');
    }
    try {
      await runHeartbeatTask(taskName);
      return sendSuccess(c, { task: taskName, status: 'completed' });
    } catch (error) {
      return ApiErrors.badRequest(c, error instanceof Error ? error.message : 'Task failed');
    }
  });

  // Internal trigger — called by the heartbeat dispatcher via dispatch namespace.
  // No auth required: unreachable from public internet (poofproxy blocks /__internal/*),
  // and only platform-owned workers in the poof_apps dispatch namespace can call it.
  app.post('/__internal/heartbeat/:taskName', async (c) => {
    const taskName = c.req.param('taskName');
    if (!VALID_TASK_NAME.test(taskName)) {
      return c.json({ success: false, error: 'Invalid task name' }, 400);
    }
    try {
      await runHeartbeatTask(taskName);
      return sendSuccess(c, { task: taskName, status: 'completed' });
    } catch (error) {
      // Generic error — don't leak handler internals on the internal route
      console.error(`[heartbeat] Internal trigger failed for "${taskName}":`, error);
      return c.json({ success: false, error: 'Task execution failed' }, 500);
    }
  });
}
