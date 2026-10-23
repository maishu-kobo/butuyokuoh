// providers の公開 JSON から Google があるかだけを見る。秘密は読まない。
export function googleListed(providers: unknown): boolean {
  if (!providers || typeof providers !== 'object') return false;
  const google = (providers as { google?: unknown }).google;
  if (!google || typeof google !== 'object') return false;
  return (google as { id?: unknown }).id === 'google';
}
