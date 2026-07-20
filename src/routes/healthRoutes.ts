/**
 * @file src/routes/healthRoutes.ts
 * @description Health check route for uptime monitoring and orchestration probes.
 *
 * GET /health
 * Used by Docker HEALTHCHECK, load balancers, and n8n to verify the service is alive.
 * Returns service uptime, current timestamp, and environment.
 *
 * This route intentionally has no authentication — it must be publicly accessible
 * for infrastructure health checks to function correctly.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import config from '../config/index.js';
import type { ApiResponse, HealthCheckData } from '../types/index.js';
import { HttpStatus } from '../types/index.js';

const router = Router();

/**
 * GET /health
 *
 * @returns 200 with service status, uptime in seconds, and environment
 */
router.get('/health', (_req: Request, res: Response): void => {
  const data: HealthCheckData = {
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  };

  const response: ApiResponse<HealthCheckData> = {
    success: true,
    message: 'Video Processing Service is running',
    data,
  };

  res.status(HttpStatus.OK).json(response);
});

export default router;
