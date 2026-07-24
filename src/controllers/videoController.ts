/**
 * @file src/controllers/videoController.ts
 * @description HTTP controller for video processing operations.
 *
 * The controller layer has exactly three responsibilities:
 *  1. Extract inputs from the HTTP request (the uploaded file)
 *  2. Delegate all work to the service layer
 *  3. Send the HTTP response and trigger post-stream cleanup
 *
 * There is NO business logic here. No file paths, no FFmpeg, no validation.
 * All of that lives in videoProcessingService.ts.
 *
 * Stream-after-cleanup pattern:
 *  The output file cannot be deleted until after res.download() finishes
 *  streaming it to the client. We hook into the response 'finish' event
 *  to schedule cleanup at the correct moment — after the last byte is sent.
 *
 * Error flow:
 *  If the service throws, next(err) passes it to the centralized errorHandler
 *  middleware, which formats the JSON error response and logs it.
 *  The service's catch block already deleted temp files before re-throwing.
 */

import type { NextFunction, Request, Response } from 'express';
import path from 'path';
import { processVideo, cleanupJobFiles } from '../services/videoProcessingService';
import { AppError, HttpStatus } from '../types/index';
import logger from '../utils/logger';

// ─────────────────────────────────────────────
// POST /process
// ─────────────────────────────────────────────

/**
 * Handles video upload and processing requests.
 *
 * Flow:
 *  1. Validate that Multer attached a file (guard against missing field)
 *  2. Call processVideo() — runs FFmpeg, returns { job, result }
 *  3. Register a one-time 'finish' listener to clean up the output file
 *     after it has been fully streamed to the client
 *  4. Stream the output file back as video/mp4 using res.download()
 *
 * @param req  - Express request (expects req.file from Multer)
 * @param res  - Express response
 * @param next - Error forwarding to centralized errorHandler
 */
export async function handleProcessVideo(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // ── Guard: File must be present ───────────
  if (!req.file) {
    next(
      new AppError(
        'No video file received. Send a multipart/form-data request with field name "video".',
        HttpStatus.BAD_REQUEST,
      ),
    );
    return;
  }

  logger.info('Upload received', {
    originalFilename: req.file.originalname,
    mimeType: req.file.mimetype,
    fileSizeBytes: req.file.size,
    savedPath: req.file.path,
  });

  try {
    // ── Delegate to service layer ──────────
    const { job, result } = await processVideo(req.file);

    logger.info('Streaming processed video to client', {
      jobId: job.jobId,
      outputPath: result.outputPath,
      processingDurationMs: result.durationMs,
    });

    // ── Schedule output cleanup after stream ends ──
    //
    // res.download() starts streaming the file to the client.
    // The 'finish' event fires when the last byte has been flushed.
    // Only at that point is it safe to delete the output file.
    //
    // We use a one-time listener ('once') to avoid memory leaks.
    res.once('finish', () => {
      logger.info('Response stream finished — cleaning up output file', {
        jobId: job.jobId,
      });
      cleanupJobFiles(job);
    });

    // ── Build a clean download filename for the client ──
    const originalBasename = path.basename(
      job.originalFilename,
      path.extname(job.originalFilename),
    );
    const downloadFilename = `${originalBasename}-processed.mp4`;

    // ── Stream the file ────────────────────
    // res.download() sets Content-Disposition: attachment and Content-Type: video/mp4
    // It pipes the file stream directly — the full video is never loaded into memory.
    res.download(result.outputPath, downloadFilename, (downloadErr?: Error) => {
      if (downloadErr) {
        // The response may have already started sending headers.
        // Log the error but don't call next() — headers are already committed.
        logger.exception('Error streaming output file to client', downloadErr, {
          jobId: job.jobId,
          outputPath: result.outputPath,
        });

        // Force-clean the output file since 'finish' may not have fired
        cleanupJobFiles(job);
      }
    });
  } catch (err) {
    // Service already cleaned up temp files before re-throwing.
    // Forward to the centralized error handler.
    next(err);
  }
}
