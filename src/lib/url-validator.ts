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
