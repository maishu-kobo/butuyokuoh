type GoogleEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

function filled(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

// 画面へ渡してよいのは真偽だけ。ID とシークレットはサーバに残す。
export function googleClientConfig(env?: GoogleEnv): { clientId: string; clientSecret: string } | null {
  const source = env ?? process.env;
  const clientId = source.GOOGLE_CLIENT_ID;
  const clientSecret = source.GOOGLE_CLIENT_SECRET;
  if (!filled(clientId) || !filled(clientSecret)) return null;
  return { clientId, clientSecret };
}

export function googleLoginEnabled(env?: GoogleEnv): boolean {
  return googleClientConfig(env) !== null;
}
