/**
 * API Response utilities for consistent response handling
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Standard API response type
 */
export type ApiResponse<T = unknown> =
  | {
      success: true;
      data: T;
      timestamp: number;
      requestId?: string;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
      timestamp: number;
      requestId?: string;
    };

/**
 * Common error codes
 */
export const ApiErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
} as const;

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes];

/**
 * Safely format an error for logging
 */
export function formatError(error: unknown): string {
  if (error === null) return 'null';
  if (error === undefined) return 'undefined';
  if (typeof error === 'string') return error || 'Empty error string';

  const prefix = error instanceof Error ? `${error.message?.trim() || 'No message'} | Full error: ` : '';

  try {
    const str = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
    return prefix + (str || 'Empty object');
  } catch {
    return prefix + 'Unserializable error';
  }
}

/**
 * Safely stringify an object for logging
 */
export function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj) || '{}';
  } catch {
    return '[Circular or unserializable object]';
  }
}

function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Send a successful JSON response
 */
export function sendSuccess<T>(c: Context, data: T, status: ContentfulStatusCode = 200): Response {
  const requestId = c.get('requestId') || generateRequestId();
  return c.json(
    {
      success: true,
      data,
      timestamp: Date.now(),
      requestId,
    },
    status,
  );
}

/**
 * Send an error JSON response
 */
export function sendError(
  c: Context,
  code: ApiErrorCode,
  message: string,
  status: ContentfulStatusCode,
  details?: unknown,
): Response {
  const requestId = c.get('requestId') || generateRequestId();

  console.error(`[${requestId}] API Error:`, safeStringify({
    code,
    message,
    status,
    details,
    path: c.req.path,
    method: c.req.method,
  }));

  return c.json(
    {
      success: false,
      error: { code, message, details },
      timestamp: Date.now(),
      requestId,
    },
    status,
  );
}

/**
 * Only 5 HTTP status codes: 200, 400, 401, 404, 500
 */
export const STANDARD_STATUS_CODES = {
  SUCCESS: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
} as const;

/**
 * Standardized error response helpers
 */
export const ApiErrors = {
  badRequest: (c: Context, message: string = 'Bad request', details?: unknown) =>
    sendError(c, ApiErrorCodes.VALIDATION_ERROR, message, STANDARD_STATUS_CODES.BAD_REQUEST, details),

  unauthorized: (c: Context, message: string = 'Authentication required') =>
    sendError(c, ApiErrorCodes.UNAUTHORIZED, message, STANDARD_STATUS_CODES.UNAUTHORIZED),

  notFound: (c: Context, message: string = 'Resource not found') =>
    sendError(c, ApiErrorCodes.RESOURCE_NOT_FOUND, message, STANDARD_STATUS_CODES.NOT_FOUND),

  internal: (c: Context, message: string = 'Internal server error', details?: unknown) => {
    console.error(`[INTERNAL ERROR] ${message}`, safeStringify({ details, path: c.req.path, method: c.req.method }));
    return sendError(c, ApiErrorCodes.INTERNAL_ERROR, message, STANDARD_STATUS_CODES.INTERNAL_ERROR, details);
  },
};

/**
 * Middleware to add request ID to context
 */
export function requestIdMiddleware() {
  return async (c: Context, next: () => Promise<void>) => {
    const requestId = c.req.header('x-request-id') || generateRequestId();
    c.set('requestId', requestId);
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
      c.header('x-request-id', requestId);
    }
    await next();
  };
}
