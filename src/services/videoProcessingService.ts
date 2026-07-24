/**
 * @file src/services/videoProcessingService.ts
 * @description High-level video processing orchestrator.
 *
 * This service owns the full lifecycle of a video processing job:
 *  1. Accept a raw upload (Multer file object)
 *  2. Build a typed VideoJob with all paths resolved
 *  3. Validate the background music file exists
 *  4. Invoke the FFmpeg service to mix audio
 *  5. Verify the output file was actually created
 *  6. Guarantee cleanup of ALL temp files — success or failure
 *  7. Return the output path and execution duration
 *
 * Separation of concerns:
 *  - This service does NOT know about HTTP (no req/res)
 *  - This service does NOT execute FFmpeg commands directly
 *  - The controller does NOT know about file paths or cleanup
 *
 * Extensibility:
 *  Adding watermarks, subtitles, or filters means adding new service
 *  calls between steps 4 and 5 without changing this file's structure.
 */

import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import config from '../config/index';
import { AppError, HttpStatus } from '../types/index';
import type { VideoJob, ProcessingResult } from '../types/index';
import { mixAudioWithVideo } from './ffmpegService';
import {
  generateOutputPath,
  fileExists,
  getFileSizeBytes,
  deleteFiles,
} from '../utils/fileSystem';
import logger from '../utils/logger';

// ─────────────────────────────────────────────
// Job Builder
// ─────────────────────────────────────────────

/**
 * Constructs a VideoJob from a Multer file object.
 * Generates the output path for this job.
 *
 * @param file - The file object produced by Multer after upload
 * @returns A fully-formed VideoJob
 */
function buildVideoJob(file: Express.Multer.File): VideoJob {
  const jobId = uuidv4();

  return {
    jobId,
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    fileSize: file.size,
    uploadPath: file.path,
    outputPath: generateOutputPath(jobId, config.paths.outputs),
    createdAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// Validation Helpers
// ─────────────────────────────────────────────

/**
 * Validates that the uploaded video file is still present on disk.
 * Multer saves it before the controller runs, but we verify defensively.
 *
 * @throws AppError (422) if the upload file has disappeared
 */
function validateUploadExists(job: VideoJob): void {
  if (!fileExists(job.uploadPath)) {
    throw new AppError(
      `Uploaded file not found at expected path. This is an internal error.`,
      HttpStatus.INTERNAL_SERVER_ERROR,
      false,
    );
  }

  logger.debug('Upload file verified', {
    jobId: job.jobId,
    path: job.uploadPath,
    sizeBytes: getFileSizeBytes(job.uploadPath),
  });
}

/**
 * Validates that the background music file exists at the configured path.
 * This is checked per-job (not just at startup) so hot-reloaded configs
 * are caught immediately rather than silently producing broken output.
 *
 * @throws AppError (503) if the music file is missing
 */
function validateBackgroundMusicExists(): void {
  const musicPath = config.paths.backgroundMusic;

  if (!fileExists(musicPath)) {
    throw new AppError(
      `Background music file not found at "${path.basename(musicPath)}". ` +
        `Please add a valid audio file to the assets directory.`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  logger.debug('Background music verified', { path: musicPath });
}

/**
 * Validates that the FFmpeg output file was actually produced.
 * A zero-byte output file indicates FFmpeg failed silently.
 *
 * @throws AppError (500) if output is missing or empty
 */
function validateOutputExists(job: VideoJob): void {
  if (!fileExists(job.outputPath)) {
    throw new AppError(
      `Processing completed but output file was not created. FFmpeg may have failed silently.`,
      HttpStatus.INTERNAL_SERVER_ERROR,
      false,
    );
  }

  const outputSize = getFileSizeBytes(job.outputPath);
  if (outputSize === 0) {
    throw new AppError(
      `Processing completed but output file is empty (0 bytes). ` +
        `The FFmpeg audio mix may have failed.`,
      HttpStatus.INTERNAL_SERVER_ERROR,
      false,
    );
  }

  logger.debug('Output file verified', {
    jobId: job.jobId,
    outputPath: job.outputPath,
    outputSizeBytes: outputSize,
  });
}

// ─────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────

/**
 * Deletes the upload temp file for a job.
 * Called in the finally block — runs whether processing succeeded or failed.
 * The output file is NOT deleted here — it is streamed to the client first.
 *
 * @param job - The VideoJob whose upload file should be deleted
 */
function cleanupUpload(job: VideoJob): void {
  logger.debug('Cleaning up upload temp file', { jobId: job.jobId });
  deleteFiles([job.uploadPath]);
}

/**
 * Deletes both the upload and output temp files for a job.
 * Called after the output has been streamed to the client,
 * or when processing fails before the output is usable.
 *
 * @param job - The VideoJob whose files should be deleted
 */
export function cleanupJobFiles(job: VideoJob): void {
  logger.debug('Cleaning up all job temp files', { jobId: job.jobId });
  deleteFiles([job.uploadPath, job.outputPath]);
}

// ─────────────────────────────────────────────
// Main Processing Function
// ─────────────────────────────────────────────

/**
 * Processes an uploaded video file by mixing in background music.
 *
 * Full lifecycle:
 *  1. Build a VideoJob from the Multer file
 *  2. Validate upload + background music exist
 *  3. Execute FFmpeg audio mix
 *  4. Validate output was created
 *  5. (always) Delete upload temp file
 *  6. Return the output path and duration
 *
 * @param file - Multer file from the upload middleware
 * @returns ProcessingResult containing output path and execution time
 * @throws AppError on validation failures or FFmpeg errors
 */
export async function processVideo(file: Express.Multer.File): Promise<{
  job: VideoJob;
  result: ProcessingResult;
}> {
  const job = buildVideoJob(file);
  const startTime = Date.now();

  logger.info('Video processing job started', {
    jobId: job.jobId,
    originalFilename: job.originalFilename,
    mimeType: job.mimeType,
    fileSizeBytes: job.fileSize,
  });

  try {
    // ── Step 1: Validate inputs ───────────────
    validateUploadExists(job);
    validateBackgroundMusicExists();

    // ── Step 2: Execute FFmpeg ────────────────
    logger.info('FFmpeg audio mix starting', { jobId: job.jobId });

    await mixAudioWithVideo({
      inputVideoPath: job.uploadPath,
      backgroundMusicPath: config.paths.backgroundMusic,
      outputPath: job.outputPath,
      backgroundVolume: config.audio.backgroundVolume,
      originalAudioVolume: config.audio.originalAudioVolume,
    });

    // ── Step 3: Validate output ───────────────
    validateOutputExists(job);

    const durationMs = Date.now() - startTime;

    logger.info('Video processing job completed', {
      jobId: job.jobId,
      outputPath: job.outputPath,
      outputSizeBytes: getFileSizeBytes(job.outputPath),
      durationMs,
    });

    const result: ProcessingResult = {
      outputPath: job.outputPath,
      durationMs,
    };

    return { job, result };
  } catch (err) {
    const durationMs = Date.now() - startTime;

    logger.exception('Video processing job failed', err, {
      jobId: job.jobId,
      durationMs,
    });

    // If processing failed, clean up everything including any partial output
    deleteFiles([job.uploadPath, job.outputPath]);

    // Re-throw so the controller's error handler can respond to the client
    throw err;
  } finally {
    // Always delete the upload file — the output is handled by the controller
    // (either streamed to client or already deleted in the catch block above)
    cleanupUpload(job);
  }
}
