import type { NextConfig } from "next";
import { CANDIDATE_IMAGE_HOSTS } from "./src/lib/capture/image-hosts";
import { parseDevAllowedOrigins } from "./src/lib/dev-origins";
import { securityHeaderRules } from "./src/lib/security-headers";

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
  // heic-decode は wasm を node_modules から読む。バンドルすると経路が壊れる。
  serverExternalPackages: ['heic-decode', 'libheif-js'],
  async headers() {
    const base = securityHeaderRules(process.env.NODE_ENV);
    // 同意画面は CSP を強制（Issue #272: frame-ancestors 'none'）
    const oauthCsp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "connect-src 'self'",
      "font-src 'self'",
    ].join('; ');
    return [
      ...base,
      {
        source: '/oauth/authorize/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: oauthCsp },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        source: '/oauth/authorize',
        headers: [
          { key: 'Content-Security-Policy', value: oauthCsp },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
  ...(allowedDevOrigins ? { allowedDevOrigins } : {}),
};

export default nextConfig;
