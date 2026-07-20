/**
 * @file src/services/ffmpegService.ts
 * @description Low-level FFmpeg execution service using child_process.spawn().
 *
 * This module is the ONLY place FFmpeg is invoked.
 * It is deliberately kept thin — no job management, no file cleanup, no config reading.
 * Its only responsibility: run an FFmpeg command and return the result.
 *
 * Design decisions:
 *  - Uses spawn() not exec() — avoids shell injection and buffering limits
 *  - Returns a Promise<FfmpegResult> — integrates cleanly with async/await
 *  - Rejects the Promise on non-zero exit codes with the full stderr output
 *  - Captures stderr progressively — FFmpeg writes progress to stderr by design
 *  - Logs every invocation with full args for debuggability
 *
 * FFmpeg Audio Mixing Strategy:
 *  amix filter — blends two audio streams:
 *    [0:a] original audio, volume-adjusted
 *    [1:a] background music, looped to match video duration, volume-adjusted
 *
 *  Key flags:
 *    -stream_loop -1   → loop music indefinitely (trimmed by output duration)
 *    -shortest         → output ends when the shortest input ends (the video)
 *    -c:v copy         → copy video stream without re-encoding (preserves quality)
 *    -c:a aac          → re-encode audio to AAC for MP4 container compatibility
 *    -map_metadata 0   → preserve original video metadata
 *    -movflags +faststart → optimize for streaming (moov atom at front)
 */

import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { AppError, HttpStatus } from '../types/index.js';
import type { AudioMixOptions, FfmpegResult } from '../types/index.js';
import logger from '../utils/logger.js';

// ─────────────────────────────────────────────
// FFmpeg Binary Resolution
// ─────────────────────────────────────────────

/**
 * The FFmpeg binary name.
 * On Linux/macOS: 'ffmpeg'
 * On Windows (if not in PATH): use the full path, e.g. 'C:\\ffmpeg\\bin\\ffmpeg.exe'
 * The FFMPEG_PATH environment variable can override this.
 */
const FFMPEG_BIN = process.env['FFMPEG_PATH'] ?? 'ffmpeg';

// ─────────────────────────────────────────────
// Core Spawn Executor
// ─────────────────────────────────────────────

/**
 * Executes an FFmpeg command with the given arguments.
 * Returns a Promise that resolves when FFmpeg exits with code 0,
 * or rejects with an AppError containing the FFmpeg stderr output.
 *
 * @param args - Array of FFmpeg CLI arguments (excluding the binary name)
 * @returns Promise resolving to FfmpegResult { exitCode, stderr }
 * @throws AppError if FFmpeg exits with a non-zero code
 */
export function runFfmpeg(args: string[]): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    logger.debug('Spawning FFmpeg', {
      binary: FFMPEG_BIN,
      args: args.join(' '),
    });

    let process: ChildProcessByStdio<null, Readable, Readable>;

    try {
      process = spawn(FFMPEG_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe'], // stdin closed, capture stdout+stderr
      });
    } catch (spawnErr) {
      // This occurs if the binary is not found or not executable
      reject(
        new AppError(
          `Failed to start FFmpeg. Ensure FFmpeg is installed and in your PATH. ` +
            `Binary: "${FFMPEG_BIN}". Error: ${String(spawnErr)}`,
          HttpStatus.SERVICE_UNAVAILABLE,
          false, // programmer error — not operational
        ),
      );
      return;
    }

    const stderrChunks: Buffer[] = [];

    // FFmpeg writes its progress, version info, and errors to stderr
    process.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      // Log FFmpeg progress lines at debug level (very verbose)
      logger.debug('FFmpeg stderr', { output: chunk.toString('utf8').trim() });
    });

    // stdout is rarely used by FFmpeg but we drain it to prevent backpressure
    process.stdout.on('data', (_chunk: Buffer) => {
      // intentionally empty — FFmpeg output goes to the file, not stdout
    });

    process.on('error', (err: Error) => {
      reject(
        new AppError(
          `FFmpeg process error: ${err.message}. ` +
            `Ensure FFmpeg is installed and accessible at "${FFMPEG_BIN}".`,
          HttpStatus.SERVICE_UNAVAILABLE,
          false,
        ),
      );
    });

    process.on('close', (code: number | null) => {
      const exitCode = code ?? 1;
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (exitCode !== 0) {
        logger.error('FFmpeg exited with non-zero code', {
          exitCode,
          // Only log the last 500 chars of stderr — it can be very long
          stderrTail: stderr.slice(-500),
        });

        reject(
          new AppError(
            `FFmpeg processing failed (exit code ${exitCode}). ` +
              `Check server logs for details.`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
        );
        return;
      }

      logger.debug('FFmpeg completed successfully', { exitCode });
      resolve({ exitCode, stderr });
    });
  });
}

// ─────────────────────────────────────────────
// Audio Mixing Command Builder
// ─────────────────────────────────────────────

/**
 * Mixes a video's original audio with background music using FFmpeg's amix filter.
 *
 * Processing behavior:
 *  - Background music is looped infinitely (-stream_loop -1)
 *  - Output duration is determined by the video (-shortest flag)
 *  - Video stream is copied byte-for-byte (no re-encoding, no quality loss)
 *  - Audio is re-encoded to AAC 192kbps (required for MP4 container)
 *  - Original audio and background music volumes are independently configurable
 *
 * Filter graph:
 *  [0:a]volume=<originalVol>[orig];
 *  [1:a]volume=<bgVol>[bg];
 *  [orig][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]
 *
 * @param options - AudioMixOptions containing paths and volume settings
 * @returns Promise<FfmpegResult> — rejects on FFmpeg error
 */
export async function mixAudioWithVideo(options: AudioMixOptions): Promise<FfmpegResult> {
  const {
    inputVideoPath,
    backgroundMusicPath,
    outputPath,
    backgroundVolume,
    originalAudioVolume,
  } = options;

  /**
   * Construct the audio filter graph.
   *
   * [0:a] — original video audio
   * [1:a] — background music (looped)
   * amix  — mixes both streams; duration=first means stop when first stream (video) ends
   * dropout_transition=0 — no fade-out when a stream ends (clean cut)
   */
  const audioFilter = [
    `[0:a]volume=${originalAudioVolume}[orig]`,
    `[1:a]volume=${backgroundVolume}[bg]`,
    `[orig][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
  ].join(';');

  const args: string[] = [
    '-y',                           // Overwrite output without prompting
    '-i', inputVideoPath,           // Input 0: video file
    '-stream_loop', '-1',           // Loop input 1 (music) indefinitely
    '-i', backgroundMusicPath,      // Input 1: background music
    '-filter_complex', audioFilter, // Audio mixing filter graph
    '-map', '0:v',                  // Map video stream from input 0
    '-map', '[aout]',               // Map mixed audio from filter graph
    '-c:v', 'copy',                 // Copy video stream — no re-encode
    '-c:a', 'aac',                  // Re-encode audio to AAC
    '-b:a', '192k',                 // Audio bitrate 192kbps
    '-shortest',                    // Stop when shortest stream ends (the video)
    '-map_metadata', '0',           // Preserve original video metadata
    '-movflags', '+faststart',      // Optimize for web streaming
    outputPath,                     // Output file
  ];

  logger.info('Starting FFmpeg audio mix', {
    inputVideo: inputVideoPath,
    backgroundMusic: backgroundMusicPath,
    outputPath,
    backgroundVolume,
    originalAudioVolume,
  });

  return runFfmpeg(args);
}

// ─────────────────────────────────────────────
// FFmpeg Version Check (startup validation)
// ─────────────────────────────────────────────

/**
 * Verifies that FFmpeg is installed and accessible.
 * Run this once at application startup to fail fast if FFmpeg is missing.
 *
 * @returns Promise<string> — the FFmpeg version string
 * @throws AppError if FFmpeg cannot be found or executed
 */
export async function verifyFfmpegInstallation(): Promise<string> {
  return new Promise((resolve, reject) => {
    let proc: ChildProcessByStdio<null, Readable, Readable>;

    try {
      proc = spawn(FFMPEG_BIN, ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      reject(
        new AppError(
          `FFmpeg not found. Install FFmpeg and ensure it is in your PATH. ` +
            `Binary checked: "${FFMPEG_BIN}"`,
          HttpStatus.SERVICE_UNAVAILABLE,
          false,
        ),
      );
      return;
    }

    const output: string[] = [];

    proc.stdout.on('data', (chunk: Buffer) => {
      output.push(chunk.toString('utf8'));
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      output.push(chunk.toString('utf8'));
    });

    proc.on('error', () => {
      reject(
        new AppError(
          `FFmpeg not found. Install FFmpeg and ensure it is in your PATH. ` +
            `Binary checked: "${FFMPEG_BIN}"`,
          HttpStatus.SERVICE_UNAVAILABLE,
          false,
        ),
      );
    });

    proc.on('close', (code) => {
      // ffmpeg -version exits with 0 on success
      if (code === 0) {
        const versionLine = output.join('').split('\n')[0] ?? 'Unknown version';
        resolve(versionLine.trim());
      } else {
        reject(
          new AppError(
            `FFmpeg version check failed (exit code ${code ?? 'null'}).`,
            HttpStatus.SERVICE_UNAVAILABLE,
            false,
          ),
        );
      }
    });
  });
}
