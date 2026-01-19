'use client';

import { useEffect, useState } from 'react';
import { BarChart3, PieChart, TrendingUp, Package, ShoppingCart } from 'lucide-react';

interface Stats {
  overview: {
    wishlistCount: number;
    purchasedCount: number;
    wishlistTotal: number;
    purchasedTotal: number;
  };
  byCategory: { category_name: string; category_color: string; count: number; total: number }[];
  byPriority: { priority: number; count: number; total: number }[];
  monthlyPurchased: { month: string; count: number; total: number }[];
  bySource: { source: string; count: number; total: number }[];
  priceRanges: { range: string; count: number }[];
}

const priorityLabels: Record<number, string> = {
  1: '最高',
  2: '高',
  3: '普通',
  4: '低',
  5: '最低',
};

const sourceLabels: Record<string, string> = {
  amazon: 'Amazon',
  rakuten: '楽天',
  other: 'その他',
};

export default function StatsView() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data);
      setLoading(false);
    };
    fetchStats();
  }, []);

  if (loading) {
    return <div className="text-center py-8 text-gray-500 dark:text-gray-400">読み込み中...</div>;
  }

  if (!stats) {
    return <div className="text-center py-8 text-gray-500 dark:text-gray-400">データの取得に失敗しました</div>;
  }

  const maxCategoryTotal = Math.max(...stats.byCategory.map(c => c.total || 0), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BarChart3 className="text-orange-500" size={24} />
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">統計ダッシュボード</h2>
      </div>

      {/* 概要カード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-blue-500 mb-2">
            <Package size={20} />
            <span className="text-sm text-gray-500 dark:text-gray-400">ほしいもの</span>
          </div>
          <p className="text-2xl font-bold">{stats.overview.wishlistCount}<span className="text-sm text-gray-400">件</span></p>
          <p className="text-sm text-gray-500 dark:text-gray-400">¥{stats.overview.wishlistTotal.toLocaleString()}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-green-500 mb-2">
            <ShoppingCart size={20} />
            <span className="text-sm text-gray-500 dark:text-gray-400">購入済み</span>
          </div>
          <p className="text-2xl font-bold">{stats.overview.purchasedCount}<span className="text-sm text-gray-400">件</span></p>
          <p className="text-sm text-gray-500 dark:text-gray-400">¥{stats.overview.purchasedTotal.toLocaleString()}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-orange-500 mb-2">
            <TrendingUp size={20} />
            <span className="text-sm text-gray-500 dark:text-gray-400">平均価格</span>
          </div>
          <p className="text-2xl font-bold">
            ¥{stats.overview.wishlistCount > 0 
              ? Math.round(stats.overview.wishlistTotal / stats.overview.wishlistCount).toLocaleString()
              : 0}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">ほしいものリスト</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-purple-500 mb-2">
            <PieChart size={20} />
            <span className="text-sm text-gray-500 dark:text-gray-400">カテゴリ数</span>
          </div>
          <p className="text-2xl font-bold">{stats.byCategory.length}<span className="text-sm text-gray-400">個</span></p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* カテゴリ別 */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-4">カテゴリ別</h3>
          {stats.byCategory.length === 0 ? (
            <p className="text-gray-400 text-sm">データがありません</p>
          ) : (
            <div className="space-y-3">
              {stats.byCategory.map((cat, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span style={{ color: cat.category_color }}>{cat.category_name}</span>
                    <span className="text-gray-500 dark:text-gray-400">{cat.count}件 / ¥{(cat.total || 0).toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all"
                      style={{ 
                        width: `${((cat.total || 0) / maxCategoryTotal) * 100}%`,
                        backgroundColor: cat.category_color 
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 優先度別 */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-4">優先度別</h3>
          {stats.byPriority.length === 0 ? (
            <p className="text-gray-400 text-sm">データがありません</p>
          ) : (
            <div className="space-y-2">
              {stats.byPriority.map((p) => (
                <div key={p.priority} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className={`px-2 py-1 rounded text-sm ${
                    p.priority <= 2 ? 'bg-red-100 text-red-700' :
                    p.priority === 3 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200'
                  }`}>
                    {priorityLabels[p.priority]}
                  </span>
                  <span className="text-gray-600 dark:text-gray-300">{p.count}件</span>
                  <span className="font-medium">¥{(p.total || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ソース別 */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-4">サイト別</h3>
          {stats.bySource.length === 0 ? (
            <p className="text-gray-400 text-sm">データがありません</p>
          ) : (
            <div className="space-y-2">
              {stats.bySource.map((s) => (
                <div key={s.source} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className={`px-2 py-1 rounded text-sm ${
                    s.source === 'amazon' ? 'bg-orange-100 text-orange-700' :
                    s.source === 'rakuten' ? 'bg-red-100 text-red-700' :
                    'bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200'
                  }`}>
                    {sourceLabels[s.source] || s.source}
                  </span>
                  <span className="text-gray-600 dark:text-gray-300">{s.count}件</span>
                  <span className="font-medium">¥{(s.total || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 価格帯分布 */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-4">価格帯分布</h3>
          {stats.priceRanges.length === 0 ? (
            <p className="text-gray-400 text-sm">データがありません</p>
          ) : (
            <div className="space-y-2">
              {stats.priceRanges.map((r) => (
                <div key={r.range} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className="text-sm text-gray-600 dark:text-gray-300">{r.range}</span>
                  <span className="font-medium">{r.count}件</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 月別購入履歴 */}
      {stats.monthlyPurchased.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-4">月別購入履歴</h3>
          <div className="space-y-2">
            {stats.monthlyPurchased.map((m) => (
              <div key={m.month} className="flex items-center justify-between py-2 border-b last:border-0">
                <span className="text-gray-600 dark:text-gray-300">{m.month}</span>
                <span className="text-gray-500 dark:text-gray-400">{m.count}件</span>
                <span className="font-medium">¥{(m.total || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
