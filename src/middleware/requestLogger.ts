/**
 * @file src/middleware/requestLogger.ts
 * @description HTTP request logging middleware using Morgan.
 *
 * Morgan is wired into our custom logger so all HTTP traffic appears in the
 * same output stream as application logs — no split log sources in production.
 *
 * Two formats are used:
 *  - Development: 'dev' (colorized, concise: METHOD /path STATUS time)
 *  - Production:  Custom JSON-compatible tokens for structured log parsing
 *
 * Health check requests (GET /health) are excluded from access logs to
 * prevent log noise from monitoring/orchestration ping traffic.
 */

import morgan from 'morgan';
import type { Request, Response } from 'express';
import logger from '../utils/logger.js';
import config from '../config/index.js';

// ─────────────────────────────────────────────
// Custom Morgan Write Stream
// ─────────────────────────────────────────────

/**
 * Morgan write stream that pipes HTTP log lines into our structured logger.
 * This ensures all logs — application and HTTP — share the same format and destination.
 */
const morganStream = {
  write(message: string): void {
    // Morgan appends a newline — trim it before passing to the logger
    logger.info(message.trim());
  },
};

// ─────────────────────────────────────────────
// Skip Rules
// ─────────────────────────────────────────────

/**
 * Determines whether a request should be excluded from access logs.
 * Currently skips GET /health to reduce monitoring noise.
 *
 * Extend this function to skip other high-frequency internal routes.
 */
function shouldSkipLog(req: Request, _res: Response): boolean {
  return req.method === 'GET' && req.path === '/health';
}

// ─────────────────────────────────────────────
// Production Token Format
// ─────────────────────────────────────────────

/**
 * Custom Morgan format string for production.
 * Produces a consistent, parseable log line:
 * METHOD /path HTTP/1.1 | 200 | 1234ms | 5678b | ::1
 */
const PRODUCTION_FORMAT =
  ':method :url HTTP/:http-version | :status | :response-time ms | :res[content-length]b | :remote-addr';

// ─────────────────────────────────────────────
// Middleware Export
// ─────────────────────────────────────────────

/**
 * Express HTTP request logging middleware.
 *
 * Usage (in app.ts, before routes):
 * @example
 * app.use(requestLogger);
 */
const requestLogger = morgan(
  config.nodeEnv === 'production' ? PRODUCTION_FORMAT : 'dev',
  {
    stream: morganStream,
    skip: shouldSkipLog,
  },
);

export default requestLogger;
