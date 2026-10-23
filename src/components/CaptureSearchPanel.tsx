'use client';

import { apiFetch } from '@/lib/api-fetch';
import {
  FLOW_STATUS,
  SLOW_MS,
  candidateCountStatus,
  fallbackFromIdentify,
  orderCandidates,
  productsToShow,
  statusAfterIdentify,
  statusAfterSearch,
  thrownCaptureRetry,
} from '@/lib/capture/capture-flow';
import { candidateThumbnail, formatCandidateFetchedAt } from '@/lib/capture/candidate-view';
import { type CaptureCandidate, type ProductGuess } from '@/lib/capture/contract';
import { RAKUTEN_CREDIT } from '@/lib/capture/rakuten';
import { useEffect, useRef, useState } from 'react';

type ListedCandidate = CaptureCandidate & { candidateId?: number };

export function CaptureSearchPanel({
  file,
  onManual,
  onRegistered,
}: {
  file: File | null;
  onManual: (name: string) => void;
  onRegistered: () => void;
}) {
  const [status, setStatus] = useState('');
  const [products, setProducts] = useState<ProductGuess[]>([]);
  const [chosen, setChosen] = useState<ProductGuess | null>(null);
  const [name, setName] = useState('');
  const [candidates, setCandidates] = useState<ListedCandidate[]>([]);
  const [amazonUrl, setAmazonUrl] = useState('');
  const [sort, setSort] = useState<'recommended' | 'price'>('recommended');
  const [selected, setSelected] = useState<number[]>([]);
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [identifyRetryable, setIdentifyRetryable] = useState(false);
  const [searchRetryable, setSearchRetryable] = useState(false);
  const [searchBlocked, setSearchBlocked] = useState(false);
  const searchBlockedRef = useRef(false);
  const searchRetryRef = useRef<{ product: ProductGuess | null; name: string } | null>(null);

  useEffect(() => {
    if (!file) return;
    const current = file;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, SLOW_MS);

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setSlow(false);
      setBusy(true);
      setNotice('');
      setProducts([]);
      setCandidates([]);
      setSelected([]);
      setAmazonUrl('');
      setStatus(FLOW_STATUS.identifying);
      setIdentifyRetryable(false);
      setSearchRetryable(false);
      searchRetryRef.current = null;
      searchBlockedRef.current = false;
      setSearchBlocked(false);
      const body = new FormData();
      body.append('photo', current);
      const response = await apiFetch('/api/capture/identify', { method: 'POST', body }, { notifyError: false });
      const data = await response.json().catch(() => null);
      if (cancelled) return;
      const fallback = fallbackFromIdentify(data, response.ok);
      const failure = statusAfterIdentify(data, response.ok);
      if (failure) {
        setBusy(false);
        setStatus(failure.message);
        setIdentifyRetryable(failure.retryable);
        if (fallback.enter) onManual(fallback.name);
        return;
      }
      const shown = productsToShow(data.confidence, data.products);
      setProducts(shown);
      const first = shown[0];
      setChosen(first);
      setName(first.name);
      if (data.confidence === 'sure') {
        await runSearch(first, first.name, () => cancelled);
      } else {
        setBusy(false);
        setStatus(FLOW_STATUS.choose);
      }
    })().catch(() => {
      if (cancelled) return;
      const retry = thrownCaptureRetry(false);
      setBusy(false);
      setSearchRetryable(false);
      setIdentifyRetryable(retry.kind === 'identify');
      setStatus(retry.message);
      onManual('');
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [file, attempt]);

  async function runSearch(product: ProductGuess | null, queryName: string, cancelled: () => boolean = () => false) {
    if (searchBlockedRef.current) return;
    const trimmed = queryName.trim();
    if (!trimmed) return;
    setBusy(true);
    setSlow(false);
    setNotice('');
    setSearchRetryable(false);
    setStatus(FLOW_STATUS.searching);
    const same = product !== null && trimmed === product.name;
    let response: Response;
    try {
      response = await apiFetch('/api/capture/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          brand: same ? product.brand : null,
          model: same ? product.model : null,
          jan: same ? product.jan : null,
        }),
      }, { notifyError: false });
    } catch {
      if (cancelled()) return;
      const retry = thrownCaptureRetry(true);
      searchRetryRef.current = { product, name: trimmed };
      setBusy(false);
      setIdentifyRetryable(false);
      setSearchRetryable(retry.kind === 'search');
      setStatus(retry.message);
      onManual(trimmed);
      return;
    }
    const data = await response.json().catch(() => null);
    if (cancelled()) return;
    setBusy(false);
    const decision = statusAfterSearch(data, response.ok, trimmed);
    if (decision.manual.enter) {
      setCandidates([]);
      searchBlockedRef.current = decision.blocked;
      setSearchBlocked(decision.blocked);
      setStatus(decision.message);
      onManual(decision.manual.name);
      return;
    }
    searchBlockedRef.current = false;
    setSearchBlocked(false);
    setCandidates(data.candidates);
    setAmazonUrl(typeof data.amazonUrl === 'string' ? data.amazonUrl : '');
    setSelected([]);
    setSort('recommended');
    setStatus(candidateCountStatus(data.candidates.length));
  }

  async function registerSelected() {
    if (selected.length === 0) return;
    setNotice('');
    const response = await apiFetch('/api/capture/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateIds: selected }),
    }, { notifyError: false });
    if (response.ok) {
      onRegistered();
      return;
    }
    const data = await response.json().catch(() => null);
    setNotice(typeof data?.error === 'string' ? data.error : '登録できませんでした');
  }

  if (!file && !status) return null;

  const listed = orderCandidates(candidates, sort);
  const showRakutenCredit = listed.some((item) => item.site === 'rakuten');

  return (
    <div className="mb-4 space-y-3">
      <p role="status" aria-live="polite" className="text-sm text-gray-600 dark:text-gray-300">{status}</p>
      {identifyRetryable && !busy && (
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="min-h-[24px] min-w-[24px] px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm"
        >
          もう一度判定する
        </button>
      )}
      {searchRetryable && !busy && !searchBlocked && (
        <button
          type="button"
          onClick={() => {
            const retry = searchRetryRef.current;
            if (!retry) return;
            void runSearch(retry.product, retry.name);
          }}
          className="min-h-[24px] min-w-[24px] px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm"
        >
          もう一度探す
        </button>
      )}
      {products.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {products.map((product) => (
            <button
              key={product.name}
              type="button"
              disabled={searchBlocked}
              onClick={() => {
                setChosen(product);
                setName(product.name);
                void runSearch(product, product.name);
              }}
              className="min-h-[24px] min-w-[24px] px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm"
            >
              {product.name}
            </button>
          ))}
        </div>
      )}
      {(chosen || name) && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1" htmlFor="capture-search-name">
            探す商品名
          </label>
          <div className="flex gap-2">
            <input
              id="capture-search-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md"
            />
            <button
              type="button"
              disabled={searchBlocked}
              onClick={() => void runSearch(chosen, name)}
              className="min-h-[24px] min-w-[24px] px-3 py-2 bg-slate-800 text-white rounded-md text-sm disabled:opacity-50"
            >
              この名前で探す
            </button>
          </div>
        </div>
      )}
      {listed.length > 0 && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button type="button" aria-pressed={sort === 'recommended'} onClick={() => setSort('recommended')} className="min-h-[24px] min-w-[24px] px-3 py-2 border rounded-md text-sm">おすすめ順</button>
            <button type="button" aria-pressed={sort === 'price'} onClick={() => setSort('price')} className="min-h-[24px] min-w-[24px] px-3 py-2 border rounded-md text-sm">安い順</button>
          </div>
          <ul className="space-y-2">
            {listed.map((item) => {
              const thumb = candidateThumbnail(item);
              const fetchedLabel = formatCandidateFetchedAt(item.fetchedAt);
              return (
              <li key={item.candidateId ?? item.id} className="flex items-start gap-2 rounded-md border border-gray-200 dark:border-slate-600 p-2">
                <input
                  type="checkbox"
                  aria-label={`候補を選ぶ ${item.title}`}
                  disabled={typeof item.candidateId !== 'number'}
                  checked={typeof item.candidateId === 'number' && selected.includes(item.candidateId)}
                  onChange={() => {
                    if (typeof item.candidateId !== 'number') return;
                    const id = item.candidateId;
                    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
                  }}
                  style={{ width: 24, height: 24 }}
                  className="mt-1 h-6 w-6 min-h-[24px] min-w-[24px] shrink-0"
                />
                {thumb && (
                  <img
                    src={thumb.src}
                    alt={thumb.alt}
                    width={64}
                    height={64}
                    loading="lazy"
                    decoding="async"
                    className="h-16 w-16 shrink-0 object-contain"
                  />
                )}
                <div className="min-w-0 flex-1 break-words text-sm">
                  <p className="text-gray-500 dark:text-gray-400">{item.shopName}</p>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{item.title}</p>
                  <p>
                    ¥{item.price.toLocaleString('ja-JP')}
                    {fetchedLabel ? <> <time dateTime={item.fetchedAt}>{fetchedLabel}</time></> : null}
                  </p>
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[24px] min-w-[24px] items-center underline">商品ページ</a>
                </div>
              </li>
              );
            })}
          </ul>
          {amazonUrl && (
            <a href={amazonUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[24px] min-w-[24px] items-center text-sm underline">Amazonで探す</a>
          )}
          {showRakutenCredit && (
            <p className="text-xs text-gray-400">
              <a href={RAKUTEN_CREDIT.url} target="_blank" rel="noopener noreferrer" className="underline">{RAKUTEN_CREDIT.label}</a>
            </p>
          )}
          <button
            type="button"
            onClick={() => void registerSelected()}
            disabled={selected.length === 0}
            className="min-h-[24px] min-w-[24px] px-4 py-2 bg-blue-500 text-white rounded-md disabled:opacity-50"
          >
            選んだ候補を登録
          </button>
        </div>
      )}
      {slow && busy && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-900/30 p-3 text-sm">
          <p>時間がかかっています。やり直すか、手入力を選べます。</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setAttempt((value) => value + 1)} className="min-h-[24px] min-w-[24px] px-3 py-2 border rounded-md">やり直す</button>
            <button type="button" onClick={() => onManual(name)} className="min-h-[24px] min-w-[24px] px-3 py-2 border rounded-md">手入力</button>
          </div>
        </div>
      )}
      {notice && <p role="alert" className="text-sm text-red-700">{notice}</p>}
    </div>
  );
}
