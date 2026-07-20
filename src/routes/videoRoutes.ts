/**
 * @file src/routes/videoRoutes.ts
 * @description Route definitions for video processing endpoints.
 *
 * This file is intentionally thin — it only wires middleware and controllers
 * together. No logic lives here.
 *
 * Middleware chain for POST /process:
 *  1. upload.single('video') — Multer: validates, saves, attaches req.file
 *  2. handleProcessVideo     — Controller: processes and streams the result
 *
 * If upload.single() rejects (wrong type, too large), it calls next(err)
 * which skips the controller and goes straight to errorHandler.
 */

import { Router } from 'express';
import upload from '../middleware/upload.js';
import { handleProcessVideo } from '../controllers/videoController.js';

const router = Router();

/**
 * POST /process
 *
 * Accepts a video file upload and returns the processed video with background music.
 *
 * Request:
 *  Content-Type: multipart/form-data
 *  Field:        video  (required, see ALLOWED_MIME_TYPES for accepted formats)
 *
 * Response (success):
 *  Content-Type:        video/mp4
 *  Content-Disposition: attachment; filename="<original>-processed.mp4"
 *  Body:                Binary MP4 stream
 *
 * Response (error):
 *  Content-Type: application/json
 *  Body:         { success: false, message: "..." }
 */
router.post('/process', upload.single('video'), handleProcessVideo);

export default router;
