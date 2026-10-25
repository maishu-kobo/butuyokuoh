// 画面の返事に付けるセキュリティヘッダ。
// CSP は Report-Only。強制すると、Next の開発サーバや Cloudflare が差し込むスクリプトで
// 画面が止まり得る。違反はブラウザのコンソールに残るだけで、表示も通信も止めない。
// X-Content-Type-Options、Referrer-Policy、フレーム拒否は強制する。

export type SecurityHeader = { key: string; value: string };

export function contentSecurityPolicy(nodeEnv: string | undefined): string {
  // Next は本文にスクリプトを出す。開発サーバはさらに eval を使う。本番の返事には eval を付けない。
  const script = ["'self'", "'unsafe-inline'"];
  if (nodeEnv !== 'production') script.push("'unsafe-eval'");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    // Google ログインは同じオリジンへ送ってから accounts.google.com へ遷移する。遷移は CSP の対象外。
    "form-action 'self'",
    `script-src ${script.join(' ')}`,
    // 画面の style 属性（色、グラフ、並び替え）を止めない。
    "style-src 'self' 'unsafe-inline'",
    // アップロードした画像は自分のホスト。店のサムネイルと商品画像は https。
    // data: と blob: はページ自身が作る画像。
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    // ログイン、写真の POST、開発サーバの更新は同じオリジン。Cloudflare Access は別ホストへの画面遷移なので足さない。
    "connect-src 'self'",
    "manifest-src 'self'",
  ].join('; ');
}

export function securityHeaders(nodeEnv: string | undefined = process.env.NODE_ENV): SecurityHeader[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy(nodeEnv) },
  ];
}

export function securityHeaderRules(nodeEnv: string | undefined = process.env.NODE_ENV) {
  return [
    {
      source: '/:path*',
      headers: securityHeaders(nodeEnv),
    },
  ];
}
