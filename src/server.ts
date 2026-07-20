/**
 * @file src/server.ts
 * @description Process entry point for the Video Processing Service.
 *
 * Startup sequence:
 *  1. Load configuration (validated at module import time in config/index.ts)
 *  2. Ensure all required directories exist
 *  3. Verify FFmpeg binary is installed and accessible
 *  4. Verify the background music asset file exists
 *  5. Start the HTTP server
 *  6. Register SIGTERM / SIGINT handlers for graceful shutdown
 *
 * Graceful shutdown:
 *  On SIGTERM (Docker stop) or SIGINT (Ctrl+C):
 *  - Stop accepting new connections
 *  - Wait for in-flight requests to complete (up to 10s)
 *  - Close the logger file stream
 *  - Exit cleanly with code 0
 *
 * Why fail fast?
 *  Starting without FFmpeg or the music file would allow the service to boot
 *  successfully but fail on every single request. Failing at startup produces
 *  a clear error message and a non-zero exit code — both Docker and process
 *  managers (PM2) will surface this immediately.
 */

import http from 'http';
import path from 'path';
import app from './app.js';
import config from './config/index.js';
import logger from './utils/logger.js';
import { ensureDirectoriesExist, fileExists } from './utils/fileSystem.js';
import { verifyFfmpegInstallation } from './services/ffmpegService.js';

// ─────────────────────────────────────────────
// Startup Sequence
// ─────────────────────────────────────────────

async function start(): Promise<void> {
  logger.info('Starting Video Processing Service...', {
    nodeEnv: config.nodeEnv,
    nodeVersion: process.version,
  });

  // ── Step 1: Create required directories ───
  logger.info('Ensuring required directories exist...');
  ensureDirectoriesExist([
    config.paths.temp,
    config.paths.uploads,
    config.paths.outputs,
  ]);
  logger.info('Directories ready');

  // ── Step 2: Verify FFmpeg ─────────────────
  logger.info('Verifying FFmpeg installation...');
  try {
    const ffmpegVersion = await verifyFfmpegInstallation();
    logger.info('FFmpeg verified', { version: ffmpegVersion });
  } catch (err) {
    logger.exception('FFmpeg not found. Service cannot start.', err);
    process.exit(1);
  }

  // ── Step 3: Verify background music asset ─
  logger.info('Verifying background music asset...', {
    path: config.paths.backgroundMusic,
  });

  if (!fileExists(config.paths.backgroundMusic)) {
    logger.error(
      `Background music file not found: "${path.basename(config.paths.backgroundMusic)}". ` +
        `Please add a valid MP3 file to the assets/ directory and set BACKGROUND_MUSIC_PATH.`,
    );
    process.exit(1);
  }
  logger.info('Background music asset verified');

  // ── Step 4: Start HTTP server ─────────────
  const server = http.createServer(app);

  server.listen(config.port, () => {
    logger.info('='.repeat(55));
    logger.info('  Video Processing Service is RUNNING');
    logger.info('='.repeat(55));
    logger.info(`  Port        : ${config.port}`);
    logger.info(`  Environment : ${config.nodeEnv}`);
    logger.info(`  Health      : http://localhost:${config.port}/health`);
    logger.info(`  Process     : http://localhost:${config.port}/process`);
    logger.info('='.repeat(55));
  });

  // ── Step 5: Graceful Shutdown ─────────────
  const SHUTDOWN_TIMEOUT_MS = 10_000;

  function gracefulShutdown(signal: string): void {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    server.close((err) => {
      if (err) {
        logger.exception('Error during server close', err);
        logger.close();
        process.exit(1);
      }

      logger.info('HTTP server closed. All connections drained.');
      logger.info('Video Processing Service stopped cleanly.');
      logger.close();
      process.exit(0);
    });

    // Force-kill if shutdown takes too long
    setTimeout(() => {
      logger.error(
        `Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms. Force-exiting.`,
      );
      logger.close();
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref(); // .unref() prevents this timer from keeping the process alive
  }

  process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
  process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });

  // ── Step 6: Unhandled rejection safety net ─
  process.on('unhandledRejection', (reason: unknown) => {
    logger.exception('UNHANDLED PROMISE REJECTION — this is a bug', reason);
    // Do not exit — let the in-flight request fail naturally
    // but alert loudly so this gets fixed
  });

  process.on('uncaughtException', (err: Error) => {
    logger.exception('UNCAUGHT EXCEPTION — shutting down immediately', err);
    logger.close();
    process.exit(1);
  });
}

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────

start().catch((err: unknown) => {
  // This catch only triggers if start() itself throws before the server binds
  // eslint-disable-next-line no-console
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
