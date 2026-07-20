/**
 * @file src/app.ts
 * @description Express application factory.
 *
 * This module creates and configures the Express app.
 * It does NOT start listening on a port — that is server.ts's responsibility.
 * This separation allows the app to be imported cleanly for integration tests.
 *
 * Middleware registration order (must not be changed):
 *  1. Helmet          — Security headers (must be first, before any response is sent)
 *  2. CORS            — Cross-origin headers (before routes)
 *  3. Compression     — gzip/deflate (before body is sent, after security)
 *  4. Body parsers    — Parse JSON/urlencoded bodies (before routes read req.body)
 *  5. Request logger  — Log every incoming request (after parsers, before routes)
 *  6. Routes          — Business logic
 *  7. 404 handler     — Catch unmatched routes (after all route definitions)
 *  8. Error handler   — Must be the LAST middleware registered (Express detects by arity)
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import config from './config/index.js';
import requestLogger from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/healthRoutes.js';
import videoRouter from './routes/videoRoutes.js';

// ─────────────────────────────────────────────
// App Factory
// ─────────────────────────────────────────────

function createApp(): express.Application {
  const app = express();

  // ── 1. Security Headers ───────────────────
  //
  // Helmet sets ~15 HTTP security headers in one call:
  //  - Content-Security-Policy
  //  - X-Frame-Options: DENY
  //  - X-Content-Type-Options: nosniff
  //  - Referrer-Policy
  //  - Strict-Transport-Security (HSTS)
  //  - etc.
  app.use(helmet());

  // ── 2. CORS ───────────────────────────────
  //
  // For a service consumed by n8n (local or same network),
  // we allow all origins by default. In production, restrict
  // this to your n8n instance's URL via an env variable.
  app.use(
    cors({
      origin: process.env['ALLOWED_ORIGIN'] ?? '*',
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  // ── 3. Compression ────────────────────────
  //
  // gzip/deflate for JSON responses (error messages, health checks).
  // Binary video streams are NOT compressed — they are already compressed
  // by the video codec. Compression middleware auto-skips non-compressible types.
  app.use(compression());

  // ── 4. Body Parsers ───────────────────────
  //
  // JSON: for future JSON-body endpoints
  // urlencoded: for standard form submissions
  // File uploads use Multer (multipart/form-data) — configured per-route
  //
  // Size limits here apply to JSON/urlencoded bodies only.
  // Multer enforces its own limit for file uploads.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── 5. Request Logger ─────────────────────
  app.use(requestLogger);

  // ── 6. Routes ─────────────────────────────
  app.use('/', healthRouter);
  app.use('/', videoRouter);

  // ── 7. 404 Handler ────────────────────────
  // Catches any request that didn't match a route above
  app.use(notFoundHandler);

  // ── 8. Centralized Error Handler ──────────
  // MUST be last — Express identifies error handlers by the 4-parameter signature
  app.use(errorHandler);

  return app;
}

// Export the configured Express application
const app = createApp();
export default app;

// Export config for server.ts to use
export { config };
