/**
 * URLバリデーションユーティリティ
 * CodeQL: js/incomplete-url-substring-sanitization 対策
 */

// 許可されたドメインのリスト（完全一致）
const ALLOWED_DOMAINS = [
  'www.amazon.co.jp',
  'www.amazon.jp',
  'www.amazon.com',
  'amazon.co.jp',
  'amazon.jp',
  'amazon.com',
  'item.rakuten.co.jp',
  'my.bookmark.rakuten.co.jp',
  'books.rakuten.co.jp',
  'product.rakuten.co.jp',
] as const;

type SourceType = 'amazon' | 'rakuten' | 'other';

interface UrlValidationResult {
  isValid: boolean;
  source: SourceType;
  hostname: string;
  sanitizedUrl: string;
}

/**
 * URLを検証し、許可されたドメインかどうかをチェック
 * hostname.includes() ではなく、完全一致で検証
 */
export function validateAndSanitizeUrl(urlString: string): UrlValidationResult {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(urlString);
  } catch {
    return {
      isValid: false,
      source: 'other',
      hostname: '',
      sanitizedUrl: '',
    };
  }

  // プロトコルチェック（HTTPSのみ許可）
  if (parsedUrl.protocol !== 'https:') {
    return {
      isValid: false,
      source: 'other',
      hostname: parsedUrl.hostname,
      sanitizedUrl: '',
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // ドメインの完全一致チェック
  const isAllowedDomain = ALLOWED_DOMAINS.some(domain => hostname === domain);

  // ソースを判定（完全一致で）
  let source: SourceType = 'other';
  if (hostname === 'www.amazon.co.jp' || hostname === 'www.amazon.jp' || hostname === 'www.amazon.com' ||
      hostname === 'amazon.co.jp' || hostname === 'amazon.jp' || hostname === 'amazon.com') {
    source = 'amazon';
  } else if (hostname === 'item.rakuten.co.jp' || hostname === 'my.bookmark.rakuten.co.jp' ||
             hostname === 'books.rakuten.co.jp' || hostname === 'product.rakuten.co.jp') {
    source = 'rakuten';
  }

  // URLを再構築して安全なURLを生成
  const sanitizedUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}`;

  return {
    isValid: isAllowedDomain,
    source,
    hostname,
    sanitizedUrl,
  };
}

/**
 * 許可されたドメインへのリクエストかどうかを検証
 * SSRF対策
 */
export function isAllowedUrl(urlString: string): boolean {
  const result = validateAndSanitizeUrl(urlString);
  return result.isValid;
}

/**
 * URLからソースタイプを取得（許可リスト外も含む）
 */
export function getSourceFromUrl(urlString: string): SourceType {
  const result = validateAndSanitizeUrl(urlString);
  return result.source;
}

// 通知Webhookの許可ホスト（完全一致）
// SSRF対策: クラウドメタデータ(169.254.169.254)や内部宛URLを登録・送信できないようにする
const ALLOWED_SLACK_WEBHOOK_HOSTS = ['hooks.slack.com'] as const;
const ALLOWED_DISCORD_WEBHOOK_HOSTS = ['discord.com', 'discordapp.com'] as const;

type WebhookType = 'slack' | 'discord';

/**
 * 通知Webhook URLが許可されているかを検証（SSRF対策）
 * - URLとしてパース可能であること
 * - プロトコルがhttps（httpは不可）
 * - ホスト名が種別ごとの許可リストに完全一致
 *   - slack: hooks.slack.com
 *   - discord: discord.com / discordapp.com
 *
 * 完全一致のため `hooks.slack.com.evil.com` のようなサブドメイン偽装は拒否される。
 * 空文字/null/undefinedは「未設定」とみなし、ここでは検証対象外（呼び出し側で扱う）。
 */
export function isAllowedWebhookUrl(urlString: string, type: WebhookType): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    return false;
  }

  // HTTPSのみ許可（httpは不可）
  if (parsedUrl.protocol !== 'https:') {
    return false;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const allowedHosts =
    type === 'slack' ? ALLOWED_SLACK_WEBHOOK_HOSTS : ALLOWED_DISCORD_WEBHOOK_HOSTS;

  // ホスト名の完全一致チェック
  return allowedHosts.some((host) => hostname === host);
}

/**
 * 一般的なURLをサニタイズ（任意のドメイン）
 * 許可リストに関係なく、URLを正規化
 */
export function sanitizeGenericUrl(urlString: string): { isValid: boolean; sanitizedUrl: string; hostname: string } {
  try {
    const parsedUrl = new URL(urlString);

    // HTTP/HTTPSのみ許可
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      return { isValid: false, sanitizedUrl: '', hostname: '' };
    }

    // ローカルホストや内部IPをブロック（SSRF対策）
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.16.') ||
        hostname.endsWith('.local')) {
      return { isValid: false, sanitizedUrl: '', hostname };
    }

    const sanitizedUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}`;
    return { isValid: true, sanitizedUrl, hostname };
  } catch {
    return { isValid: false, sanitizedUrl: '', hostname: '' };
  }
}
