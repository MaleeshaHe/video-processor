/**
 * @file src/types/index.ts
 * @description Central type definitions for the Video Processing Service.
 * All interfaces are exported from here so every layer imports from one place.
 */

// ─────────────────────────────────────────────
// API Response Shape
// ─────────────────────────────────────────────

/**
 * Standard API response envelope for all JSON responses.
 * Success responses may include additional data.
 * Error responses always include a message.
 */
export interface ApiResponse<T = undefined> {
  success: boolean;
  message: string;
  data?: T;
}

/**
 * Health check response data.
 */
export interface HealthCheckData {
  uptime: number;
  timestamp: string;
  environment: string;
}

// ─────────────────────────────────────────────
// Video Processing
// ─────────────────────────────────────────────

/**
 * Represents a single video processing job lifecycle.
 * Created when a file is uploaded; updated through each stage.
 */
export interface VideoJob {
  /** Unique identifier for this processing job (UUID v4) */
  jobId: string;
  /** Original filename as uploaded by the client */
  originalFilename: string;
  /** MIME type of the uploaded file */
  mimeType: string;
  /** File size in bytes */
  fileSize: number;
  /** Absolute path to the uploaded temp file */
  uploadPath: string;
  /** Absolute path to the processed output file */
  outputPath: string;
  /** ISO timestamp when the job was created */
  createdAt: string;
}

/**
 * Result returned by the video processing service.
 */
export interface ProcessingResult {
  /** Absolute path to the processed output file */
  outputPath: string;
  /** Execution time in milliseconds */
  durationMs: number;
}

/**
 * FFmpeg execution result from child_process.spawn().
 */
export interface FfmpegResult {
  /** Exit code from the FFmpeg process (0 = success) */
  exitCode: number;
  /** Combined stderr output from FFmpeg */
  stderr: string;
}

/**
 * Audio mixing options passed to the FFmpeg service.
 */
export interface AudioMixOptions {
  /** Path to the input video file */
  inputVideoPath: string;
  /** Path to the background music file */
  backgroundMusicPath: string;
  /** Path for the output processed file */
  outputPath: string;
  /** Background music volume (0.0 – 1.0+) */
  backgroundVolume: number;
  /** Original audio volume (0.0 – 1.0+) */
  originalAudioVolume: number;
}

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

/**
 * Strongly-typed application configuration.
 * Loaded once at startup from environment variables.
 */
export interface AppConfig {
  /** HTTP port the server listens on */
  port: number;
  /** Node environment: 'development' | 'production' | 'test' */
  nodeEnv: string;

  /** Paths */
  paths: {
    temp: string;
    uploads: string;
    outputs: string;
    backgroundMusic: string;
  };

  /** Upload constraints */
  upload: {
    /** Maximum file size in bytes */
    maxSizeBytes: number;
    /** Allowed MIME types */
    allowedMimeTypes: readonly string[];
    /** Allowed file extensions */
    allowedExtensions: readonly string[];
  };

  /** Audio processing parameters */
  audio: {
    backgroundVolume: number;
    originalAudioVolume: number;
  };

  /** Logging */
  log: {
    level: string;
  };
}

// ─────────────────────────────────────────────
// Error Handling
// ─────────────────────────────────────────────

/**
 * HTTP status codes used by this service.
 */
export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  BAD_REQUEST = 400,
  UNPROCESSABLE_ENTITY = 422,
  INTERNAL_SERVER_ERROR = 500,
  SERVICE_UNAVAILABLE = 503,
}

/**
 * Custom application error with an HTTP status code.
 * Thrown by services and caught by the centralized error middleware.
 */
export class AppError extends Error {
  public readonly statusCode: HttpStatus;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    // Restore prototype chain (required when extending built-in classes in TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────
// Supported Video Formats
// ─────────────────────────────────────────────

/**
 * Allowed MIME types for video uploads.
 * Extend this list to support additional formats in the future.
 */
export const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/quicktime', // .mov
  'video/x-msvideo', // .avi
  'video/x-matroska', // .mkv
  'video/webm',
] as const;

/**
 * Allowed file extensions for video uploads.
 */
export const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];
