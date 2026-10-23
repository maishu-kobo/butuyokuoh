import type { NextConfig } from "next";
import { parseDevAllowedOrigins } from "./src/lib/dev-origins";

const allowedDevOrigins = parseDevAllowedOrigins(process.env.DEV_ALLOWED_ORIGINS, process.env.NODE_ENV);

const nextConfig: NextConfig = {
  devIndicators: false,
  // heic-decode は wasm を node_modules から読む。バンドルすると経路が壊れる。
  serverExternalPackages: ['heic-decode', 'libheif-js'],
  ...(allowedDevOrigins ? { allowedDevOrigins } : {}),
};

export default nextConfig;
