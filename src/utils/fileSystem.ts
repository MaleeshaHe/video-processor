/**
 * @file src/utils/fileSystem.ts
 * @description File system helper utilities for safe directory creation,
 * unique filename generation, and guaranteed temp-file cleanup.
 *
 * These helpers are consumed by the VideoProcessingService and Multer middleware.
 * They are intentionally pure (no side effects beyond the filesystem) and
 * do not import any service-layer modules — keeping the dependency graph clean.
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger.js';

// ─────────────────────────────────────────────
// Directory Management
// ─────────────────────────────────────────────

/**
 * Ensures that all required application directories exist.
 * Creates them recursively if they are missing.
 * Safe to call multiple times — idempotent.
 *
 * @param directories - Array of absolute directory paths to create
 * @throws {Error} if any directory cannot be created
 */
export function ensureDirectoriesExist(directories: string[]): void {
  for (const dir of directories) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      logger.debug('Directory ready', { path: dir });
    } catch (err) {
      throw new Error(`Failed to create directory "${dir}": ${String(err)}`);
    }
  }
}

// ─────────────────────────────────────────────
// Unique Filename Generation
// ─────────────────────────────────────────────

/**
 * Generates a unique, safe filename for an uploaded video.
 * Format: <uuid>-<sanitized-original-name>
 *
 * The original filename is sanitized to:
 *  - Remove path separators (prevents directory traversal)
 *  - Replace whitespace with underscores
 *  - Strip characters that aren't alphanumeric, dash, underscore, or dot
 *
 * @param originalFilename - The original filename from the upload
 * @param directory        - The directory the file will be stored in
 * @returns Absolute path: /path/to/directory/<uuid>-<sanitized-name>
 */
export function generateUploadPath(originalFilename: string, directory: string): string {
  const sanitized = path
    .basename(originalFilename)           // strip any path components
    .replace(/\s+/g, '_')                 // spaces → underscores
    .replace(/[^a-zA-Z0-9._-]/g, '')     // remove unsafe chars
    .toLowerCase()
    .slice(0, 100);                       // cap length to prevent overly long paths

  const safeFilename = sanitized || 'upload'; // fallback if sanitization removes everything
  const uniqueName = `${uuidv4()}-${safeFilename}`;

  return path.join(directory, uniqueName);
}

/**
 * Generates a unique output filename for a processed video.
 * Always produces an .mp4 file regardless of the input format,
 * since FFmpeg re-muxes to MP4 container during audio mixing.
 *
 * @param jobId     - The UUID for this processing job
 * @param directory - The output directory
 * @returns Absolute path: /path/to/directory/<jobId>-output.mp4
 */
export function generateOutputPath(jobId: string, directory: string): string {
  return path.join(directory, `${jobId}-output.mp4`);
}

// ─────────────────────────────────────────────
// File Existence & Validation
// ─────────────────────────────────────────────

/**
 * Checks whether a file exists and is readable.
 *
 * @param filePath - Absolute path to the file
 * @returns true if the file exists and is accessible; false otherwise
 */
export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the size of a file in bytes.
 * Returns 0 if the file does not exist or cannot be read.
 *
 * @param filePath - Absolute path to the file
 */
export function getFileSizeBytes(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────
// Temp File Cleanup
// ─────────────────────────────────────────────

/**
 * Deletes a single file safely.
 * Logs a warning if deletion fails but does NOT throw —
 * a failed cleanup should never propagate to the client.
 *
 * @param filePath - Absolute path to the file to delete
 */
export function deleteFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.debug('Temp file deleted', { path: filePath });
    }
  } catch (err) {
    logger.warn('Failed to delete temp file', {
      path: filePath,
      error: String(err),
    });
  }
}

/**
 * Deletes multiple files safely in parallel.
 * All deletions are attempted regardless of individual failures.
 * Logs a warning for each failed deletion but never throws.
 *
 * @param filePaths - Array of absolute paths to delete
 */
export function deleteFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    deleteFile(filePath);
  }
}

// ─────────────────────────────────────────────
// Path Safety
// ─────────────────────────────────────────────

/**
 * Validates that a resolved file path stays within an allowed base directory.
 * Guards against directory traversal attacks (e.g. "../../etc/passwd").
 *
 * @param filePath  - The path to validate
 * @param baseDir   - The directory the path must be contained within
 * @returns true if the path is safe; false if it escapes baseDir
 */
export function isPathSafe(filePath: string, baseDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  return resolvedFile.startsWith(resolvedBase + path.sep) || resolvedFile === resolvedBase;
}
