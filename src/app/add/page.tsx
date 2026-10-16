'use client';

import { apiFetch } from '@/lib/api-fetch';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import AddItemForm from '@/components/AddItemForm';
import { Category } from '@/types';
import { Crown, ArrowLeft, Loader2, Check, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface ProductInfo {
  name: string;
  price: number | null;
  image_url: string | null;
  source: string;
  source_name: string;
}

function AddPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isGuest, loading: authLoading } = useAuth();

  const [url, setUrl] = useState('');
  const [safeUrl, setSafeUrl] = useState<string | null>(null);
  const [productInfo, setProductInfo] = useState<ProductInfo | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [priority, setPriority] = useState(3);
  const [categoryId, setCategoryId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [plannedDate, setPlannedDate] = useState('');

  // URLを検証してサニタイズ（XSS対策）
  const sanitizeUrlForLink = (inputUrl: string): string | null => {
    try {
      const parsed = new URL(inputUrl);
      // http/httpsのみ許可（javascript:等を防ぐ）
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
      }
      return parsed.href;
    } catch {
      return null;
    }
  };

  // URLパラメータからURLを取得
  useEffect(() => {
    const urlParam = searchParams.get('url');
    const textParam = searchParams.get('text');

    // URLを抽出（textに含まれる場合もある）
    let extractedUrl = urlParam || '';

    if (!extractedUrl && textParam) {
      // textからURLを抽出
      const urlMatch = textParam.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        extractedUrl = urlMatch[0];
      }
    }

    if (extractedUrl) {
      setUrl(extractedUrl);
      setSafeUrl(sanitizeUrlForLink(extractedUrl));
    }
  }, [searchParams]);

  // カテゴリ取得
  useEffect(() => {
    if (user) {
      apiFetch('/api/categories')
        .then(res => res.json())
        .then(data => setCategories(data))
        .catch(() => {});
    }
  }, [user]);

  // URLがあれば商品情報を取得
  useEffect(() => {
    if (url && user && !isGuest && !productInfo) {
      fetchProductInfo();
    }
  }, [url, user]);

  const fetchProductInfo = async () => {
    if (!url) return;

    setLoading(true);
    setError('');

    try {
      const res = await apiFetch('/api/items/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '商品情報の取得に失敗しました');
      }

      const data = await res.json();
      setProductInfo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!url) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await apiFetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          priority,
          category_id: categoryId ? Number(categoryId) : null,
          quantity,
          planned_purchase_date: plannedDate || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '追加に失敗しました');
      }

      setSuccess(true);
      
      // 2秒後にメインページへ
      setTimeout(() => {
        router.push('/');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  };

  // 認証ローディング中
  if (authLoading) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <Loader2 className="animate-spin text-amber-500" size={32} />
      </div>
    );
  }

  // 未ログイン
  if (!user) {
    return (
      <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center p-4">
        <Crown className="text-amber-500 mb-4" size={48} />
        <h1 className="text-xl font-bold mb-2">ログインが必要です</h1>
        <p className="text-gray-600 mb-4">商品を追加するにはログインしてください</p>
        <Link
          href="/"
          className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600"
        >
          ログインページへ
        </Link>
      </div>
    );
  }

  if (isGuest) return <main className="p-4 max-w-lg mx-auto space-y-4">
    <Link href="/">← リストへ戻る</Link>
    <p>ゲスト体験では商品を手動で追加できます。URLからの取得はログイン後に利用できます。</p>
    <AddItemForm categories={categories} comparisonGroups={[]} onAdd={() => router.push('/')} />
  </main>;

  // 成功画面
  if (success) {
    return (
      <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center p-4">
        <div className="bg-green-100 rounded-full p-4 mb-4">
          <Check className="text-green-600" size={48} />
        </div>
        <h1 className="text-xl font-bold mb-2">追加しました！</h1>
        <p className="text-gray-600">リストに戻ります...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100">
      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-amber-500 to-orange-500 text-white p-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="p-1 hover:bg-white/20 rounded">
            <ArrowLeft size={24} />
          </Link>
          <Crown size={28} />
          <h1 className="text-lg font-bold">商品を追加</h1>
        </div>
      </header>

      <main className="p-4 max-w-lg mx-auto">
        {/* URL入力（パラメータがない場合） */}
        {!url && (
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              商品URL
            </label>
            <input
              type="url"
              placeholder="https://www.amazon.co.jp/..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              onClick={fetchProductInfo}
              disabled={!url || loading}
              className="mt-3 w-full py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
            >
              商品情報を取得
            </button>
          </div>
        )}

        {/* ローディング */}
        {loading && (
          <div className="bg-white rounded-lg shadow p-8 flex flex-col items-center">
            <Loader2 className="animate-spin text-amber-500 mb-3" size={32} />
            <p className="text-gray-600">商品情報を取得中...</p>
          </div>
        )}

        {/* エラー */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-600">{error}</p>
            <button
              onClick={fetchProductInfo}
              className="mt-2 text-sm text-red-600 underline"
            >
              再試行
            </button>
          </div>
        )}

        {/* 商品情報 */}
        {productInfo && !loading && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {/* 商品プレビュー */}
            <div className="p-4 border-b">
              <div className="flex gap-4">
                {productInfo.image_url && (
                  <img
                    src={productInfo.image_url}
                    alt=""
                    className="w-20 h-20 object-contain rounded bg-gray-50"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="font-medium text-gray-900 line-clamp-2">
                    {productInfo.name}
                  </h2>
                  {productInfo.price && (
                    <p className="text-lg font-bold text-orange-600 mt-1">
                      ¥{productInfo.price.toLocaleString()}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    {productInfo.source_name}
                  </p>
                </div>
              </div>
              {safeUrl && (
                <a
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 text-xs text-blue-500 flex items-center gap-1 hover:underline"
                >
                  <ExternalLink size={12} />
                  商品ページを開く
                </a>
              )}
            </div>

            {/* 設定 */}
            <div className="p-4 space-y-4">
              {/* 優先度 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  優先度
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((p) => (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        priority === p
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-amber-300'
                      }`}
                    >
                      {p === 1 ? '🔥' : p === 2 ? '⭐' : p === 3 ? '●' : p === 4 ? '○' : '・'}
                    </button>
                  ))}
                </div>
              </div>

              {/* カテゴリ */}
              {categories.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    カテゴリ
                  </label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">なし</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* 個数・購入予定日 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    個数
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    購入予定日
                  </label>
                  <input
                    type="date"
                    value={plannedDate}
                    onChange={(e) => setPlannedDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* 追加ボタン */}
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-3 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    追加中...
                  </>
                ) : (
                  <>
                    <Crown size={20} />
                    物欲王に追加
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AddPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <Loader2 className="animate-spin text-amber-500" size={32} />
      </div>
    }>
      <AddPageContent />
    </Suspense>
  );
}
