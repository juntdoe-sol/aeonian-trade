import type { Context, ErrorHandler, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * Captures ALL requests/responses and errors
 */
export function createRequestLogger() {
  return async (c: Context, next: Next) => {
    const startTime = Date.now();
    const reqId = c.get('requestId') || 'unknown';
    const method = c.req.method;
    const path = c.req.path;
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP');
    const userAgent = c.req.header('User-Agent');

    // Extract user info
    const userId = c.get('userId');
    const walletAddress = c.get('walletAddress');
    const authType = c.get('authType');

    try {
      await next();

      // Log all requests with user context
      const responseTime = Date.now() - startTime;
      const status = c.res.status;

      // Build user info string
      const userInfo = userId ? ` user=${userId}` : '';
      const walletInfo =
        walletAddress && walletAddress !== userId ? ` wallet=${walletAddress}` : '';
      const authInfo = authType ? ` auth=${authType}` : '';
      const ipInfo = ip ? ` ip=${ip}` : '';

      console.log(
        `[${status >= 400 ? 'ERROR' : 'SUCCESS'}] ${method} ${path} -> ${status} (${responseTime}ms) reqId=${reqId}${userInfo}${walletInfo}${authInfo}${ipInfo}`,
      );
    } catch (error) {
      // Log any unhandled errors with full context
      const responseTime = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      console.error(
        `[UNHANDLED_ERROR] ${method} ${path} -> ERROR (${responseTime}ms) reqId=${reqId}`,
        JSON.stringify({
          error: errorMsg,
          stack,
          ip,
          userAgent,
          userId,
          walletAddress,
          authType,
        }),
      );

      // Re-throw to be handled by global error handler
      throw error;
    }
  };
}

/**
 * Global error handler for unhandled exceptions
 */
export function globalErrorHandler(): ErrorHandler {
  return async (err: Error, c: Context) => {
    const reqId = c.get('requestId') || 'unknown';

    // HTTPException carries its own Response (status, body, headers) — let it
    // through so structured failures like the Phoenix geo gate's 451 reach the
    // client intact instead of getting flattened to a generic 500.
    if (err instanceof HTTPException) {
      return err.getResponse();
    }

    console.error(`[GLOBAL_ERROR] Unhandled error for reqId=${reqId}:`, JSON.stringify({
      name: err.name,
      message: err.message,
      stack: err.stack,
      path: c.req.path,
      method: c.req.method,
    }));

    return c.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          requestId: reqId,
        },
      },
      500,
    );
  };
}
