/**
 * @file src/middleware/upload.ts
 * @description Multer v2 upload middleware configuration.
 *
 * Responsibilities:
 *  - Accept only allowed video MIME types and file extensions
 *  - Enforce configurable maximum file size
 *  - Store uploads in the configured upload directory with UUID-based names
 *  - Reject all non-video files before they reach the controller
 *
 * Security considerations:
 *  - Validates MIME type reported by the client (Content-Type)
 *  - Validates file extension from the original filename
 *  - Uses UUID-based filenames to prevent filename collisions and traversal
 *  - Upload directory is resolved at startup from config — not from user input
 */

import multer, { type FileFilterCallback } from 'multer';
import path from 'path';
import type { Request } from 'express';
import config from '../config/index.js';
import { AppError, HttpStatus } from '../types/index.js';
import { generateUploadPath } from '../utils/fileSystem.js';
import logger from '../utils/logger.js';

// ─────────────────────────────────────────────
// Storage Engine
// ─────────────────────────────────────────────

/**
 * Disk storage engine with UUID-based filename generation.
 * The destination and filename are resolved from config — never from user input.
 */
const storage = multer.diskStorage({
  destination(_req: Request, _file: Express.Multer.File, cb): void {
    cb(null, config.paths.uploads);
  },

  filename(_req: Request, file: Express.Multer.File, cb): void {
    const uploadPath = generateUploadPath(file.originalname, config.paths.uploads);
    // diskStorage expects just the filename, not the full path
    cb(null, path.basename(uploadPath));
  },
});

// ─────────────────────────────────────────────
// File Filter
// ─────────────────────────────────────────────

/**
 * Validates that an uploaded file is an accepted video format.
 *
 * Performs TWO checks:
 *  1. MIME type — checked against the allow-list
 *  2. File extension — checked against the allow-list
 *
 * Both must pass. If either fails, the upload is rejected with a
 * descriptive AppError before any bytes are written to disk.
 */
function videoFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void {
  const { allowedMimeTypes, allowedExtensions } = config.upload;
  const ext = path.extname(file.originalname).toLowerCase();

  const isMimeAllowed = (allowedMimeTypes as readonly string[]).includes(file.mimetype);
  const isExtAllowed = (allowedExtensions as readonly string[]).includes(ext);

  if (!isMimeAllowed || !isExtAllowed) {
    logger.warn('Upload rejected: invalid file type', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      extension: ext,
    });

    // Pass an AppError to Multer — it will be forwarded to the error handler
    return cb(
      new AppError(
        `Invalid file type. Accepted formats: ${allowedExtensions.join(', ')}. ` +
          `Received MIME type: "${file.mimetype}", extension: "${ext || 'none'}"`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    );
  }

  logger.debug('Upload accepted: valid file type', {
    originalname: file.originalname,
    mimetype: file.mimetype,
  });

  cb(null, true);
}

// ─────────────────────────────────────────────
// Multer Instance
// ─────────────────────────────────────────────

/**
 * Configured Multer instance.
 * Used as route-level middleware on the POST /process endpoint.
 *
 * @example
 * router.post('/process', upload.single('video'), controller.processVideo);
 */
const upload = multer({
  storage,
  fileFilter: videoFileFilter,
  limits: {
    fileSize: config.upload.maxSizeBytes,
    files: 1, // Only one file per request
  },
});

export default upload;
