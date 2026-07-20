# 🎬 Video Processing Service

A production-ready REST API that accepts a video file, mixes in a predefined background music track using FFmpeg, and returns the processed video. Built with Node.js, TypeScript, and Express.js following clean layered architecture.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Running with Docker](#running-with-docker)
- [API Documentation](#api-documentation)
- [Example Requests](#example-requests)
- [Project Structure](#project-structure)
- [Audio Processing Details](#audio-processing-details)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Video Processing Service has a single, well-defined responsibility:

```
Receive Video → Add Background Music → Return Processed Video
```

It exposes two HTTP endpoints:

| Method | Path       | Description                         |
|--------|------------|-------------------------------------|
| GET    | `/health`  | Service health check                |
| POST   | `/process` | Upload a video, get processed video |

The service is completely self-contained and knows nothing about Google Drive, YouTube, Gemini, or n8n. It is designed to be called by any HTTP client including automation workflows.

---

## Architecture

```
HTTP Request
     │
     ▼
┌─────────────────────────────────────────┐
│            Express Middleware           │
│  Helmet → CORS → Compression → Logger  │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│               Routes Layer              │
│     healthRoutes  │  videoRoutes        │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│     Multer Upload Middleware            │
│  Validate type → Save to temp dir      │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│           Controllers Layer             │
│  videoController (HTTP in/out only)    │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│           Services Layer                │
│  videoProcessingService (orchestrator) │
│         ↓                              │
│  ffmpegService (child_process.spawn)   │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│            Utilities Layer              │
│     logger  │  fileSystem              │
└─────────────────────────────────────────┘
```

**Design Principles:**
- No business logic in controllers
- No HTTP knowledge in services
- Single responsibility per module
- Fail fast on startup — bad config crashes immediately
- Guaranteed temp file cleanup (success or failure)

---

## Requirements

### Local Development

| Requirement | Version  | Notes                             |
|-------------|----------|-----------------------------------|
| Node.js     | ≥ 20.0.0 | LTS recommended                   |
| npm         | ≥ 10.0.0 | Comes with Node 20                |
| FFmpeg      | ≥ 4.0    | Must be in system PATH            |

### Docker

| Requirement     | Version | Notes                         |
|-----------------|---------|-------------------------------|
| Docker Engine   | ≥ 24.0  | FFmpeg installed automatically |
| Docker Compose  | ≥ 2.20  | Included in Docker Desktop     |

### Installing FFmpeg

**Windows:**
```powershell
# Using winget
winget install ffmpeg

# Or using Chocolatey
choco install ffmpeg

# Verify
ffmpeg -version
```

**macOS:**
```bash
brew install ffmpeg
ffmpeg -version
```

**Ubuntu / Debian:**
```bash
sudo apt update && sudo apt install -y ffmpeg
ffmpeg -version
```

---

## Installation

### 1. Clone or download the project

```bash
cd video-processor
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your settings (see [Environment Variables](#environment-variables)).

### 4. Add your background music

Place your MP3 file in the `assets/` directory:

```bash
cp /path/to/your/music.mp3 assets/background.mp3
```

The filename must match `BACKGROUND_MUSIC_PATH` in your `.env`.

---

## Environment Variables

All variables are defined in `.env`. Copy `.env.example` as a starting point.

| Variable               | Default                    | Description                                              |
|------------------------|----------------------------|----------------------------------------------------------|
| `PORT`                 | `3000`                     | HTTP port the service listens on                         |
| `NODE_ENV`             | `development`              | `development` or `production`                            |
| `TEMP_DIRECTORY`       | `temp`                     | Root temp directory (relative to project root)           |
| `UPLOAD_DIRECTORY`     | `temp/uploads`             | Where uploaded files are saved before processing         |
| `OUTPUT_DIRECTORY`     | `temp/outputs`             | Where processed videos are written before streaming      |
| `BACKGROUND_MUSIC_PATH`| `assets/background.mp3`    | Path to the background music file                        |
| `MAX_UPLOAD_SIZE`      | `524288000`                | Maximum upload size in bytes (default: 500 MB)           |
| `BACKGROUND_VOLUME`    | `0.15`                     | Background music volume (0.0 = silent, 1.0 = full)      |
| `ORIGINAL_AUDIO_VOLUME`| `1.0`                      | Original video audio volume (0.0 = silent, 1.0 = full)  |
| `LOG_LEVEL`            | `info`                     | `debug`, `info`, `warn`, or `error`                      |

### Volume Level Reference

| Value | Effect                         |
|-------|--------------------------------|
| `0.0` | Completely silent              |
| `0.1` | Very quiet (good for ambience) |
| `0.15`| Default background level       |
| `0.5` | Half volume                    |
| `1.0` | Full original volume           |
| `1.5` | 50% amplified                  |

### Calculating MAX_UPLOAD_SIZE

```
100 MB  =  104857600
250 MB  =  262144000
500 MB  =  524288000  ← default
1 GB    = 1073741824
2 GB    = 2147483648
```

---

## Running Locally

### Development mode (with hot reload)

```bash
npm run dev
```

### Production mode (compiled)

```bash
npm run build
npm start
```

### Verify the service is running

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "success": true,
  "message": "Video Processing Service is running",
  "data": {
    "uptime": 12,
    "timestamp": "2026-07-20T15:00:00.000Z",
    "environment": "development"
  }
}
```

---

## Running with Docker

### Prerequisites

1. Docker and Docker Compose installed
2. Background music file in `assets/background.mp3`
3. `.env` file configured (or use defaults)

### Start the service

```bash
docker compose up
```

To run in the background:

```bash
docker compose up -d
```

### View logs

```bash
# Follow live logs
docker compose logs -f

# View last 100 lines
docker compose logs --tail=100
```

### Stop the service

```bash
# Graceful stop (preserves volumes)
docker compose down

# Stop and remove all temp data
docker compose down -v
```

### Rebuild after code changes

```bash
docker compose up --build
```

### Check container health

```bash
docker inspect video-processor --format='{{.State.Health.Status}}'
```

---

## API Documentation

### GET /health

Returns service status for health checks and monitoring.

**Request:**
```
GET /health HTTP/1.1
Host: localhost:3000
```

**Response — 200 OK:**
```json
{
  "success": true,
  "message": "Video Processing Service is running",
  "data": {
    "uptime": 42,
    "timestamp": "2026-07-20T15:00:00.000Z",
    "environment": "production"
  }
}
```

---

### POST /process

Uploads a video file and returns the processed video with background music mixed in.

**Request:**
```
POST /process HTTP/1.1
Host: localhost:3000
Content-Type: multipart/form-data; boundary=----FormBoundary

------FormBoundary
Content-Disposition: form-data; name="video"; filename="my-video.mp4"
Content-Type: video/mp4

<binary video data>
------FormBoundary--
```

| Field  | Type   | Required | Description                         |
|--------|--------|----------|-------------------------------------|
| `video`| File   | ✅ Yes   | The video file to process            |

**Accepted formats:** `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`

**Response — 200 OK (success):**
```
Content-Type: video/mp4
Content-Disposition: attachment; filename="my-video-processed.mp4"

<binary MP4 stream>
```

**Response — 400 Bad Request (no file):**
```json
{
  "success": false,
  "message": "No video file received. Send a multipart/form-data request with field name \"video\"."
}
```

**Response — 422 Unprocessable Entity (invalid format):**
```json
{
  "success": false,
  "message": "Invalid file type. Accepted formats: .mp4, .mov, .avi, .mkv, .webm. Received MIME type: \"image/jpeg\", extension: \".jpg\""
}
```

**Response — 422 Unprocessable Entity (file too large):**
```json
{
  "success": false,
  "message": "File too large. Maximum allowed size is 500 MB."
}
```

**Response — 503 Service Unavailable (music file missing):**
```json
{
  "success": false,
  "message": "Background music file not found at \"background.mp3\". Please add a valid audio file to the assets directory."
}
```

**Response — 500 Internal Server Error:**
```json
{
  "success": false,
  "message": "An unexpected internal server error occurred. Please try again."
}
```

---

## Example Requests

### curl

**Health check:**
```bash
curl http://localhost:3000/health
```

**Process a video:**
```bash
curl -X POST http://localhost:3000/process \
  -F "video=@/path/to/your/video.mp4" \
  --output processed-video.mp4
```

**Process with progress display:**
```bash
curl -X POST http://localhost:3000/process \
  -F "video=@/path/to/your/video.mp4" \
  --output processed-video.mp4 \
  --progress-bar
```

**Process a .mov file:**
```bash
curl -X POST http://localhost:3000/process \
  -F "video=@/path/to/recording.mov" \
  --output recording-processed.mp4
```

**Process and save with timestamp:**
```bash
curl -X POST http://localhost:3000/process \
  -F "video=@video.mp4" \
  --output "processed-$(date +%Y%m%d-%H%M%S).mp4"
```

### Postman

1. Create a new request: `POST http://localhost:3000/process`
2. Select the **Body** tab
3. Choose **form-data**
4. Add a key named `video`, change the type dropdown from **Text** to **File**
5. Select your video file
6. Click **Send**
7. In the response, click **Save Response → Save to file**

### n8n HTTP Request Node

Configure the HTTP Request node as follows:

| Setting | Value |
|---|---|
| Method | `POST` |
| URL | `http://video-processor:3000/process` (Docker) or `http://localhost:3000/process` (local) |
| Body Content Type | `Form Data` |
| Form Data Key | `video` |
| Form Data Value | *(binary video data from previous node)* |
| Response Format | `File` |

---

## Project Structure

```
video-processor/
├── src/
│   ├── app.ts                          # Express app factory (middleware + routes)
│   ├── server.ts                       # Process entry point (startup + shutdown)
│   ├── config/
│   │   └── index.ts                    # Environment loading + validation
│   ├── controllers/
│   │   └── videoController.ts          # HTTP layer (no business logic)
│   ├── middleware/
│   │   ├── upload.ts                   # Multer: file validation + storage
│   │   ├── errorHandler.ts             # Centralized error → JSON response
│   │   └── requestLogger.ts            # Morgan wired into custom logger
│   ├── routes/
│   │   ├── healthRoutes.ts             # GET /health
│   │   └── videoRoutes.ts              # POST /process
│   ├── services/
│   │   ├── ffmpegService.ts            # child_process.spawn FFmpeg executor
│   │   └── videoProcessingService.ts   # Job lifecycle orchestrator
│   ├── types/
│   │   └── index.ts                    # All TypeScript interfaces + AppError
│   └── utils/
│       ├── logger.ts                   # Structured logger (dev: colors, prod: JSON)
│       └── fileSystem.ts               # Directory creation + file cleanup helpers
├── assets/
│   └── background.mp3                  # ← PUT YOUR MUSIC FILE HERE
├── temp/
│   ├── uploads/                        # Uploaded videos (auto-deleted after processing)
│   └── outputs/                        # Processed videos (auto-deleted after streaming)
├── logs/
│   └── app.log                         # Production log file
├── dist/                               # Compiled JavaScript (git-ignored)
├── .env                                # Your environment (git-ignored)
├── .env.example                        # Template — copy to .env
├── .eslintrc.json                      # ESLint rules
├── .prettierrc.json                    # Code formatting rules
├── .dockerignore                       # Files excluded from Docker build context
├── Dockerfile                          # Multi-stage Docker build
├── docker-compose.yml                  # One-command deployment
├── package.json
└── tsconfig.json                       # Strict TypeScript configuration
```

---

## Audio Processing Details

### FFmpeg Filter Graph

The service uses FFmpeg's `amix` filter to blend two audio streams:

```
[0:a] original video audio  → volume adjustment → [orig]
[1:a] background music      → volume adjustment → [bg]
[orig][bg] → amix → [aout]  → AAC encode → output.mp4
```

### Key FFmpeg Flags

| Flag | Purpose |
|---|---|
| `-stream_loop -1` | Loop background music infinitely |
| `-shortest` | Stop output when video stream ends |
| `-c:v copy` | Copy video without re-encoding (preserves quality) |
| `-c:a aac -b:a 192k` | Re-encode audio to AAC for MP4 compatibility |
| `-movflags +faststart` | Move MP4 metadata to front for web streaming |
| `duration=first` | amix stops when first stream (video) ends |
| `dropout_transition=0` | No fade-out at stream end — clean cut |

### What Happens to My Video Quality?

- **Video:** Copied byte-for-byte — **zero quality loss**, no re-encoding
- **Audio:** Re-encoded to AAC 192kbps — near-lossless for human hearing
- **Duration:** Output is exactly the same length as the input video
- **Metadata:** Original video metadata is preserved (`-map_metadata 0`)

---

## Troubleshooting

### `FFmpeg not found. Install FFmpeg and ensure it is in your PATH.`

FFmpeg is not installed or not accessible.

```bash
# Check if FFmpeg is installed
ffmpeg -version

# Windows: add to PATH or set FFMPEG_PATH in .env
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe

# Linux/macOS
sudo apt install ffmpeg      # Ubuntu/Debian
brew install ffmpeg          # macOS
```

### `Background music file not found`

The `assets/background.mp3` file is missing.

```bash
# Check it exists
ls -la assets/

# Add your music file
cp /path/to/music.mp3 assets/background.mp3
```

### `File too large. Maximum allowed size is 500 MB.`

Increase `MAX_UPLOAD_SIZE` in `.env`:

```env
# 1 GB
MAX_UPLOAD_SIZE=1073741824
```

### `Invalid file type`

Only video files are accepted. Ensure you are sending:
- The correct field name: `video` (not `file`, not `upload`)
- A supported format: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`

### FFmpeg processing fails silently (output is 0 bytes)

Enable debug logging to see the full FFmpeg output:

```env
LOG_LEVEL=debug
```

Then re-run the request and check the logs for FFmpeg stderr output.

### Docker: `permission denied` on volume mounts

The container runs as UID 1001. Ensure host directories are accessible:

```bash
# Fix assets directory permissions
chmod 755 assets/
chmod 644 assets/background.mp3

# Fix logs directory
chmod 755 logs/
```

### Docker: container keeps restarting

Check the startup logs for the actual error:

```bash
docker compose logs video-processor
```

Common causes:
- FFmpeg not found (shouldn't happen in Docker — FFmpeg is installed in the image)
- `assets/background.mp3` not mounted or missing
- Port 3000 already in use on the host — change the left side of the port mapping in `docker-compose.yml`

### Processing takes very long

Large videos take time. For a 10-minute 1080p video, expect 30–120 seconds depending on your CPU. FFmpeg uses the `-c:v copy` flag so it does **not** re-encode video — only the audio is processed. If performance is critical, increase CPU limits in `docker-compose.yml`.

### `Unexpected field. Use the field name "video"`

You sent the file with the wrong field name. Use `video`:

```bash
# Correct
curl -F "video=@file.mp4" ...

# Wrong
curl -F "file=@file.mp4" ...
curl -F "upload=@file.mp4" ...
```

---

## Adding a Real Background Music File

Replace the placeholder with a real MP3:

1. Find or create a royalty-free music track
2. Place it at `assets/background.mp3`
3. Adjust volume in `.env` if needed:
   ```env
   BACKGROUND_VOLUME=0.12   # Subtle background
   BACKGROUND_VOLUME=0.20   # More prominent
   ```
4. Restart the service — no rebuild required

> **Note:** The music file is mounted as a read-only volume in Docker (`./assets:/app/assets:ro`), so you can swap the file on the host and restart the container without rebuilding the image.

---

## License

MIT
