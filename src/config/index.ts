/**
 * @file src/config/index.ts
 * @description Loads, validates, and exports the application configuration.
 *
 * This module is the ONLY place that reads process.env.
 * All other modules must import from here — never read env vars directly.
 *
 * Fails fast at startup if required variables are missing or invalid.
 */

import dotenv from 'dotenv';
import path from 'path';
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES } from '../types/index.js';
import type { AppConfig } from '../types/index.js';

// Load .env file before reading any variables
dotenv.config();

// ─────────────────────────────────────────────
// Helper: Read & Validate Environment Variables
// ─────────────────────────────────────────────

/**
 * Reads a required string environment variable.
 * Throws at startup if the variable is missing or empty.
 */
function requireString(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') {
    throw new Error(`[Config] Missing required environment variable: ${key}`);
  }
  return value.trim();
}

/**
 * Reads an optional string environment variable with a fallback.
 */
function optionalString(key: string, fallback: string): string {
  const value = process.env[key];
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

/**
 * Reads a numeric environment variable with a fallback.
 * Throws if the variable exists but is not a valid finite number.
 */
function optionalNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!isFinite(parsed)) {
    throw new Error(
      `[Config] Environment variable "${key}" must be a valid number. Got: "${raw}"`,
    );
  }
  return parsed;
}

/**
 * Reads a float environment variable and clamps it to a safe range.
 */
function optionalFloat(key: string, fallback: number, min: number, max: number): number {
  const value = optionalNumber(key, fallback);
  if (value < min || value > max) {
    throw new Error(
      `[Config] Environment variable "${key}" must be between ${min} and ${max}. Got: ${value}`,
    );
  }
  return value;
}

// ─────────────────────────────────────────────
// Resolve Paths
// ─────────────────────────────────────────────

/**
 * Resolves a path relative to the project root (process.cwd()).
 * Prevents directory traversal by ensuring the resolved path
 * remains within the project root.
 */
function resolveSafePath(envKey: string, fallback: string): string {
  const rawValue = optionalString(envKey, fallback);
  const projectRoot = process.cwd();
  const resolved = path.resolve(projectRoot, rawValue);

  if (!resolved.startsWith(projectRoot)) {
    throw new Error(
      `[Config] Path for "${envKey}" resolves outside the project root. ` +
        `Potential directory traversal detected. Value: "${rawValue}"`,
    );
  }

  return resolved;
}

// ─────────────────────────────────────────────
// Build & Export Config
// ─────────────────────────────────────────────

/**
 * The single source of truth for all application configuration.
 * Loaded once at process startup; immutable thereafter.
 */
function buildConfig(): AppConfig {
  const port = optionalNumber('PORT', 3000);

  if (port < 1 || port > 65535) {
    throw new Error(`[Config] PORT must be between 1 and 65535. Got: ${port}`);
  }

  const backgroundVolume = optionalFloat('BACKGROUND_VOLUME', 0.15, 0, 5);
  const originalAudioVolume = optionalFloat('ORIGINAL_AUDIO_VOLUME', 1.0, 0, 5);
  const maxUploadSizeBytes = optionalNumber('MAX_UPLOAD_SIZE', 524_288_000); // 500 MB

  if (maxUploadSizeBytes < 1) {
    throw new Error(`[Config] MAX_UPLOAD_SIZE must be a positive integer.`);
  }

  return {
    port,
    nodeEnv: optionalString('NODE_ENV', 'development'),

    paths: {
      temp: resolveSafePath('TEMP_DIRECTORY', 'temp'),
      uploads: resolveSafePath('UPLOAD_DIRECTORY', 'temp/uploads'),
      outputs: resolveSafePath('OUTPUT_DIRECTORY', 'temp/outputs'),
      backgroundMusic: resolveSafePath('BACKGROUND_MUSIC_PATH', 'assets/background.mp3'),
    },

    upload: {
      maxSizeBytes: maxUploadSizeBytes,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      allowedExtensions: ALLOWED_EXTENSIONS,
    },

    audio: {
      backgroundVolume,
      originalAudioVolume,
    },

    log: {
      level: optionalString('LOG_LEVEL', 'info'),
    },
  };
}

// Validate at module load time — crash early if config is broken
let config: AppConfig;

try {
  config = buildConfig();
} catch (error) {
  // Use console.error here intentionally — logger isn't initialized yet
  console.error('[Config] Fatal configuration error:', (error as Error).message);
  process.exit(1);
}

export default config;

// Named export of individual sections for convenient destructuring
export const { paths, upload, audio, log } = config;

// Also export the requireString helper — used by server.ts to validate
// that background music file exists before starting
export { requireString };
