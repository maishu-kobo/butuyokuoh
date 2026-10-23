import type { NextConfig } from "next";
import { CANDIDATE_IMAGE_HOSTS } from "./src/lib/capture/image-hosts";
import { parseDevAllowedOrigins } from "./src/lib/dev-origins";

const allowedDevOrigins = parseDevAllowedOrigins(process.env.DEV_ALLOWED_ORIGINS, process.env.NODE_ENV);

const nextConfig: NextConfig = {
  devIndicators: false,
  // 候補画像の next/image は配信元の https だけ。任意のホストは足さない。
  images: {
    remotePatterns: CANDIDATE_IMAGE_HOSTS.map((hostname) => ({
      protocol: "https",
      hostname,
      pathname: "/**",
    })),
  },
  ...(allowedDevOrigins ? { allowedDevOrigins } : {}),
};

export default nextConfig;
