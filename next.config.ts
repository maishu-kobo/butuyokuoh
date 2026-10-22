import type { NextConfig } from "next";
import { parseDevAllowedOrigins } from "./src/lib/dev-origins";

const allowedDevOrigins = parseDevAllowedOrigins(process.env.DEV_ALLOWED_ORIGINS, process.env.NODE_ENV);

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(allowedDevOrigins ? { allowedDevOrigins } : {}),
};

export default nextConfig;
