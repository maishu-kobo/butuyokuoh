/** Google ログイン後の戻り先。通常はログイン origin 内だけを許可する。 */
export function authRedirectUrl(url: string, baseUrl: string): string {
  try {
    const target = new URL(url, baseUrl);
    if (target.username || target.password) return baseUrl;
    if (target.origin === new URL(baseUrl).origin) return target.href;
    // Google の登録済み callback origin と異なる場合も、MCP の許可画面だけに戻す。
    if (target.protocol === 'https:' && target.origin === process.env.MCP_PUBLIC_ORIGIN
      && target.pathname === '/oauth/authorize/consent') return target.href;
  } catch {
    // 不正な戻り先はログイン origin に戻す。
  }
  return baseUrl;
}
