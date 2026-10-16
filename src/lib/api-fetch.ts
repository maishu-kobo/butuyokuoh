// Preserve Response semantics for existing callers while surfacing quota/expiry
// failures consistently, including controls which previously ignored !ok.
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit, options: { notifyError?: boolean } = {}): Promise<Response> {
  const response = await fetch(input, { ...init, cache: 'no-store' });
  if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
  else if (!response.ok && options.notifyError !== false) {
    const data = await response.clone().json().catch(() => null);
    window.dispatchEvent(new CustomEvent('api-error', { detail: data?.error || '操作に失敗しました。もう一度お試しください。' }));
  }
  return response;
}
