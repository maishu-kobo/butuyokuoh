// 開発サーバを電話やテールスケールから開くときのホスト名。本番では使わない。

export function parseDevAllowedOrigins(
  raw: string | undefined,
  nodeEnv: string | undefined,
): string[] | undefined {
  if (nodeEnv !== 'development') return undefined;
  if (typeof raw !== 'string') return undefined;
  const hosts: string[] = [];
  for (const part of raw.split(',')) {
    const host = normalizeDevHostname(part);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts.length > 0 ? hosts : undefined;
}

function normalizeDevHostname(value: string): string | null {
  let token = value.trim().toLowerCase();
  if (!token) return null;
  if (token.includes('://') || token.startsWith('//')) {
    try {
      token = new URL(token.includes('://') ? token : `http:${token}`).hostname;
    } catch {
      return null;
    }
  } else if (token.includes('/')) {
    return null;
  } else if (!token.includes('*')) {
    token = stripDevPort(token);
  }
  if (!token || token.includes('/') || token.includes('@') || /\s/.test(token)) return null;
  return token;
}

function stripDevPort(token: string): string {
  if (token.startsWith('[')) {
    const end = token.indexOf(']');
    return end > 1 ? token.slice(1, end) : token;
  }
  const colon = token.lastIndexOf(':');
  if (colon <= 0) return token;
  const host = token.slice(0, colon);
  const port = token.slice(colon + 1);
  if (/^\d+$/.test(port) && host && !host.includes(':')) return host;
  return token;
}
