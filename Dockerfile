# ============================================================
# Stage 1: Builder
# Installs all dependencies and compiles TypeScript to JS
# ============================================================
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first — leverage Docker layer caching
# If package.json doesn't change, npm install is skipped on rebuild
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for TypeScript compiler)
RUN npm ci --frozen-lockfile

# Copy source code and TypeScript config
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript → dist/
RUN npm run build

# ============================================================
# Stage 2: Production
# Lean runtime image with only what is needed to run the service
# ============================================================
FROM node:20-alpine AS production

# ── Install FFmpeg ────────────────────────────────────────
# alpine-based FFmpeg is smaller than Debian's (~50MB vs ~300MB)
RUN apk add --no-cache ffmpeg

# ── Create non-root user for security ────────────────────
# Never run application processes as root inside a container
RUN addgroup -g 1001 -S appgroup && \
    adduser  -u 1001 -S appuser -G appgroup

# Set working directory
WORKDIR /app

# ── Copy package files and install ONLY production dependencies ──
COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile --omit=dev

# ── Copy compiled output from builder stage ──────────────
COPY --from=builder /app/dist ./dist

# ── Create required directories with correct ownership ───
# These are also created at runtime by server.ts, but pre-creating
# them here ensures they exist with the right permissions from the start
RUN mkdir -p assets temp/uploads temp/outputs logs && \
    chown -R appuser:appgroup /app

# ── Switch to non-root user ───────────────────────────────
USER appuser

# ── Environment defaults ──────────────────────────────────
# These are overridden by docker-compose.yml or runtime -e flags
ENV NODE_ENV=production \
    PORT=3000 \
    TEMP_DIRECTORY=temp \
    UPLOAD_DIRECTORY=temp/uploads \
    OUTPUT_DIRECTORY=temp/outputs \
    BACKGROUND_MUSIC_PATH=assets/gone.m4a \
    MAX_UPLOAD_SIZE=524288000 \
    BACKGROUND_VOLUME=0.5 \
    ORIGINAL_AUDIO_VOLUME=1.0 \
    LOG_LEVEL=info

# ── Expose port ───────────────────────────────────────────
EXPOSE 3000

# ── Health check ─────────────────────────────────────────
# Docker will mark the container as unhealthy if /health returns non-200
# Interval: check every 30s
# Timeout: fail if no response within 10s
# Retries: mark unhealthy after 3 consecutive failures
# Start period: give the app 10s to boot before health checks begin
HEALTHCHECK \
    --interval=30s \
    --timeout=10s \
    --retries=3 \
    --start-period=10s \
    CMD wget -qO- http://localhost:3000/health || exit 1

# ── Start the service ─────────────────────────────────────
CMD ["node", "dist/server.js"]
