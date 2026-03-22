/**
 * Spatial proxy route — forwards /api/spatial/* to the Sedona Python service
 * running on port 7474. This keeps the Sedona service internal and lets the
 * frontend call /api/spatial/boundary-stats etc. via the same Express server.
 */

import { Router, Request, Response } from "express";

const SEDONA_BASE = process.env.SEDONA_URL ?? "http://localhost:7474";

export const spatialProxyRouter = Router();

spatialProxyRouter.all("/api/spatial/*", async (req: Request, res: Response) => {
  // Strip /api prefix — Sedona routes are /spatial/...
  const sedonaPath = req.path.replace(/^\/api/, "");
  const url = `${SEDONA_BASE}${sedonaPath}`;

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    // Sedona service may not be running; return a graceful degraded response
    console.warn("[SpatialProxy] Sedona service unavailable:", (err as Error).message);
    res.status(503).json({
      error: "Spatial analytics service unavailable",
      degraded: true,
    });
  }
});
