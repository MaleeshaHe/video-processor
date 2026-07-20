/**
 * @file src/utils/logger.ts
 * @description Production-ready structured logger for the Video Processing Service.
 *
 * Behavior:
 *  - Development (NODE_ENV !== 'production'): colored, human-readable output to stdout
 *  - Production (NODE_ENV === 'production'):  JSON-structured output to stdout + log file
 *
 * Log levels (lowest → highest severity):
 *   debug → info → warn → error
 *
 * Only messages at or above the configured LOG_LEVEL are emitted.
 * The logger itself never throws — all internal errors are silently swallowed
 * to ensure a broken log write never crashes the service.
 */

import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────
// Log Level Definitions
// ─────────────────────────────────────────────

/** Numeric severity values — higher = more severe */
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

// ─────────────────────────────────────────────
// ANSI Color Helpers (development only)
// ─────────────────────────────────────────────

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  timestamp: '\x1b[90m', // grey
} as const;

function colorize(text: string, color: keyof typeof COLORS): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

// ─────────────────────────────────────────────
// Log File Stream (production only)
// ─────────────────────────────────────────────

/**
 * Creates an append-mode write stream to the log file.
 * Returns null (and logs a warning to stderr) if the file cannot be opened.
 */
function createLogStream(logDir: string): fs.WriteStream | null {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'app.log');
    return fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf8' });
  } catch (err) {
    process.stderr.write(
      `[Logger] Warning: Could not open log file stream. Error: ${String(err)}\n`,
    );
    return null;
  }
}

// ─────────────────────────────────────────────
// Structured Log Entry (production JSON format)
// ─────────────────────────────────────────────

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  /** Optional contextual metadata (jobId, filePath, durationMs, etc.) */
  meta?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Logger Class
// ─────────────────────────────────────────────

class Logger {
  private readonly minLevel: number;
  private readonly isProduction: boolean;
  private readonly fileStream: fs.WriteStream | null;

  constructor() {
    const rawLevel = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase();
    this.minLevel = LOG_LEVELS[rawLevel as LogLevel] ?? LOG_LEVELS.info;
    this.isProduction = process.env['NODE_ENV'] === 'production';

    // Only create a file stream in production — dev output goes to console only
    this.fileStream = this.isProduction
      ? createLogStream(path.resolve(process.cwd(), 'logs'))
      : null;
  }

  // ── Core Emit ─────────────────────────────

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < this.minLevel) {
      return; // Skip messages below the configured threshold
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
    };

    this.isProduction ? this.writeJson(entry) : this.writePretty(entry);
  }

  // ── Production: JSON Output ────────────────

  private writeJson(entry: LogEntry): void {
    try {
      const line = JSON.stringify(entry) + '\n';
      process.stdout.write(line);
      this.fileStream?.write(line);
    } catch {
      // Never throw from logger
    }
  }

  // ── Development: Colored Human-Readable Output ──

  private writePretty(entry: LogEntry): void {
    try {
      const time = colorize(entry.timestamp, 'timestamp');
      const levelLabel = entry.level.toUpperCase().padEnd(5);
      const coloredLevel = colorize(levelLabel, entry.level);
      const msg = entry.level === 'error'
        ? colorize(entry.message, 'bold')
        : entry.message;

      let line = `${time} ${coloredLevel} ${msg}`;

      if (entry.meta && Object.keys(entry.meta).length > 0) {
        const metaStr = Object.entries(entry.meta)
          .map(([k, v]) => `${colorize(k, 'dim')}=${String(v)}`)
          .join(' ');
        line += `  ${metaStr}`;
      }

      // Route errors to stderr, everything else to stdout
      if (entry.level === 'error') {
        process.stderr.write(line + '\n');
      } else {
        process.stdout.write(line + '\n');
      }
    } catch {
      // Never throw from logger
    }
  }

  // ── Public API ────────────────────────────

  /**
   * Low-level diagnostic information. Only visible when LOG_LEVEL=debug.
   * Use for tracing execution paths during development.
   */
  public debug(message: string, meta?: Record<string, unknown>): void {
    this.emit('debug', message, meta);
  }

  /**
   * General operational messages. Default log level.
   * Use for normal lifecycle events (startup, request received, job complete).
   */
  public info(message: string, meta?: Record<string, unknown>): void {
    this.emit('info', message, meta);
  }

  /**
   * Non-fatal issues that require attention.
   * Use for unexpected but recoverable situations.
   */
  public warn(message: string, meta?: Record<string, unknown>): void {
    this.emit('warn', message, meta);
  }

  /**
   * Fatal or unrecoverable errors.
   * Use for exceptions, FFmpeg failures, and unhandled rejections.
   */
  public error(message: string, meta?: Record<string, unknown>): void {
    this.emit('error', message, meta);
  }

  /**
   * Convenience method: logs an Error object with its stack trace.
   */
  public exception(message: string, err: unknown, meta?: Record<string, unknown>): void {
    const errorMeta: Record<string, unknown> = {
      ...meta,
      errorName: err instanceof Error ? err.name : 'UnknownError',
      errorMessage: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? 'No stack trace') : undefined,
    };
    this.emit('error', message, errorMeta);
  }

  /**
   * Gracefully closes the file stream on process shutdown.
   * Call this in the SIGTERM / SIGINT handler.
   */
  public close(): void {
    this.fileStream?.end();
  }
}

// ─────────────────────────────────────────────
// Singleton Export
// ─────────────────────────────────────────────

/**
 * Global logger singleton. Import and use directly:
 * @example
 * import logger from '../utils/logger';
 * logger.info('Processing started', { jobId });
 */
const logger = new Logger();
export default logger;
