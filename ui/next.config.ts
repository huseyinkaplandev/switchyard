import type { NextConfig } from "next";

/**
 * `next dev --turbopack` and `next build` must not share one .next folder:
 * the build overwrites runtime chunks under a running dev server and the dev
 * server starts returning 500. The production scripts pass NEXT_DIST_DIR
 * explicitly; tying the folder to NODE_ENV instead would be a silent trap.
 */
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
