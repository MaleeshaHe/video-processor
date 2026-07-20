/**
 * @file src/middleware/errorHandler.ts
 * @description Centralized Express error-handling middleware.
 *
 * This is the ONLY place where errors are converted to HTTP responses.
 * It must be registered LAST in the Express middleware chain (after all routes).
 *
 * Handles three categories of errors:
 *  1. AppError     — intentional, operational errors thrown by services/controllers
 *  2. Multer errors — file upload rejections (size limit, invalid type)
 *  3. Unexpected   — unhandled errors (bugs, third-party failures)
 *
 * All responses follow the ApiResponse envelope:
 *  { success: false, message: "..." }
 *
 * In development, the error stack trace is included for debugging.
 * In production, stack traces are suppressed.
 */

import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { AppError, HttpStatus } from '../types/index.js';
import type { ApiResponse } from '../types/index.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';

// ─────────────────────────────────────────────
// Multer Error Message Mapping
// ─────────────────────────────────────────────

/**
 * Maps Multer error codes to human-readable messages.
 * Prevents raw Multer internals from leaking to clients.
 */
function getMulterErrorMessage(err: MulterError): { message: string; status: HttpStatus } {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return {
        message: `File too large. Maximum allowed size is ${(config.upload.maxSizeBytes / 1_048_576).toFixed(0)} MB.`,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      };
    case 'LIMIT_FILE_COUNT':
      return {
        message: 'Too many files. Only one video file is allowed per request.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      };
    case 'LIMIT_UNEXPECTED_FILE':
      return {
        message: `Unexpected field. Use the field name "video" for video uploads.`,
        status: HttpStatus.BAD_REQUEST,
      };
    default:
      return {
        message: `Upload error: ${err.message}`,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      };
  }
}

// ─────────────────────────────────────────────
// 404 Handler
// ─────────────────────────────────────────────

/**
 * Catch-all handler for routes that don't exist.
 * Must be registered AFTER all route definitions.
 */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  logger.warn('Route not found', { method: req.method, path: req.path });

  const response: ApiResponse = {
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
  };

  res.status(404).json(response);
}

// ─────────────────────────────────────────────
// Centralized Error Handler
// ─────────────────────────────────────────────

/**
 * Express error-handling middleware.
 * Signature MUST have 4 parameters — Express detects it by arity.
 *
 * @param err  - The error thrown/passed via next(err)
 * @param req  - The incoming request
 * @param res  - The response object
 * @param _next - Required by Express but not used (errors don't continue)
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const isDev = config.nodeEnv !== 'production';

  // ── 1. Operational AppError ───────────────
  if (err instanceof AppError) {
    logger.warn('Operational error', {
      statusCode: err.statusCode,
      message: err.message,
      path: req.path,
      method: req.method,
    });

    const response: ApiResponse & { stack?: string } = {
      success: false,
      message: err.message,
      ...(isDev && err.stack ? { stack: err.stack } : {}),
    };

    res.status(err.statusCode).json(response);
    return;
  }

  // ── 2. Multer Errors ──────────────────────
  if (err instanceof MulterError) {
    const { message, status } = getMulterErrorMessage(err);

    logger.warn('Multer upload error', {
      code: err.code,
      field: err.field,
      message: err.message,
      path: req.path,
    });

    const response: ApiResponse = { success: false, message };
    res.status(status).json(response);
    return;
  }

  // ── 3. AppError passed via Multer fileFilter ──
  // When fileFilter calls cb(new AppError(...)), Multer wraps it differently
  // in some versions. This handles the unwrapped case.
  if (err instanceof Error && err.name === 'AppError') {
    const appErr = err as AppError;
    const response: ApiResponse = { success: false, message: appErr.message };
    res.status(appErr.statusCode ?? HttpStatus.UNPROCESSABLE_ENTITY).json(response);
    return;
  }

  // ── 4. Unexpected / Programmer Errors ─────
  logger.exception('Unhandled error', err, {
    path: req.path,
    method: req.method,
  });

  const response: ApiResponse & { stack?: string } = {
    success: false,
    message: 'An unexpected internal server error occurred. Please try again.',
    ...(isDev && err instanceof Error && err.stack ? { stack: err.stack } : {}),
  };

  res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(response);
}
