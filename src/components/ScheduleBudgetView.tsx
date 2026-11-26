'use client';

import PurchaseTimingEditor from './design/PurchaseTimingEditor';
import { purchaseTimingLabel, type PurchaseTiming } from '@/lib/purchase-timing';
import ScheduleBudget from './design/ScheduleBudget';
import { apiFetch } from '@/lib/api-fetch';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Category, Item } from '@/types';
import { rakutenPriceCaption } from '@/lib/capture/rakuten-price-note';
import { reconcileBudgetSelection } from '@/lib/design-budget';

function priceText(item: Item): string {
  if (item.current_price == null) return '価格未取得';
  return (item.quantity || 1) > 1
    ? `¥${((item.current_price || 0) * (item.quantity || 1)).toLocaleString()}`
    : `¥${item.current_price.toLocaleString()}`;
}

function PriceWithNote({ item, className }: { item: Item; className: string }) {
  const caption = rakutenPriceCaption(item);
  return (
    <span className={className}>
      {priceText(item)}
      {caption && (
        <span className="block text-xs font-normal text-gray-400 dark:text-gray-300">
          {caption.fetchedAt} {caption.note}
        </span>
      )}
    </span>
  );
}

interface BudgetData {
  [month: string]: {
    items: Item[];
    total: number;
  };
}

export default function ScheduleBudgetView({ presentation = 'legacy', query = '', revision = 0, categories = [], onProduct, onChanged }: {
  presentation?: 'legacy' | 'schedule'; query?: string; revision?: number; categories?:Category[];
  onProduct?: (item: Item) => void; onChanged?: () => Promise<void>;
} = {}) {
  const [budget, setBudget] = useState<BudgetData>({});
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const [savingSelection, setSavingSelection] = useState(false);
  const [period, setPeriod] = useState('all');
  const [dateItem, setDateItem] = useState<Item | null>(null);
  const [savedDateMessage, setSavedDateMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const selectionItems = useRef<Item[] | null>(null);
  const dateTrigger = useRef<HTMLButtonElement|null>(null);

  const fetchBudget = useCallback(async () => {
    try {
      const res = await apiFetch(presentation==='schedule'?'/api/budget?with=purchase-timing':'/api/budget');
      if (!res.ok) throw new Error(`Failed to fetch budget: ${res.status}`);
      const data = await res.json();
      // 月キーのオブジェクト以外（エラーJSON等）を弾く
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Unexpected response format');
      }
      // 各エントリを検証し、不正な形のエントリは除外してクラッシュを防ぐ
      const safeBudget: BudgetData = {};
      const items: Item[] = [];
      Object.entries(data as Record<string, { items?: unknown; total?: unknown }>).forEach(([month, monthData]) => {
        if (monthData && Array.isArray(monthData.items) && typeof monthData.total === 'number') {
          const monthItems = monthData.items as Item[];
          safeBudget[month] = { items: monthItems, total: monthData.total };
          items.push(...monthItems);
        }
      });
      setBudget(safeBudget);
      setAllItems(items);
      if (presentation === 'schedule') {
        const previous = selectionItems.current;
        setSelectedIds(selected => reconcileBudgetSelection(previous, items, selected));
        selectionItems.current = items;
      }
      setLoadError(false);
    } catch (error) {
      console.error('Failed to fetch budget:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [presentation]);

  useEffect(() => {
    // 取得関数の中の setState は await のあと。effect から直接呼ぶと新しい react-hooks が同期 setState と誤認する。
    void (async () => { await fetchBudget(); })();
  }, [revision, fetchBudget]);

  // 読み込み失敗時の再試行
  const handleRetry = () => {
    setLoadError(false);
    setLoading(true);
    fetchBudget();
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(selected => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const months = Object.keys(budget).filter(key => key !== 'undated').sort();
  const shownPeriod = period === 'all' || budget[period] ? period : 'all';
  const undatedData = budget.undated;

  function changePeriod(next: string) {
    setPeriod(next);
    if (presentation === 'legacy') setSelectedIds(new Set());
  }

  function closeDateEditor() {
    const trigger = dateItem && `agenda-date-${dateItem.id}`;
    setDateItem(null);
    if (trigger) requestAnimationFrame(() => (dateTrigger.current?.isConnected ? dateTrigger.current : document.getElementById(trigger))?.focus({preventScroll:true}));
  }

  async function finishDateEdit(value: PurchaseTiming) {
    await fetchBudget();
    await onChanged?.();
    const newPeriod=value.kind==='date'?value.date.slice(0,7):value.kind==='month'?value.month:'undated';
    if (shownPeriod !== 'all' && shownPeriod !== newPeriod) changePeriod(newPeriod);
    setSavedDateMessage('購入時期を'+purchaseTimingLabel(value)+'に変更しました。');
    closeDateEditor();
  }

  const chooseCandidate = async (groupId: number, itemId: number | null) => {
    if (savingSelection) return;
    setSavingSelection(true);
    setSelectionError('');
    try {
      const response = await apiFetch(`/api/comparison-groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgetItemId: itemId }),
      }, { notifyError: false });
      if (!response.ok) throw new Error('Budget selection failed');
      await fetchBudget();
      await onChanged?.();
    } catch {
      setSelectionError('合計に数える商品の設定を保存できませんでした。もう一度お試しください。');
    } finally {
      setSavingSelection(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500 dark:text-gray-400">読み込み中...</div>;
  }

  if (loadError) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-center py-8">
        <p>読み込みに失敗しました</p>
        <button
          onClick={handleRetry}
          className="mt-3 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
        >
          再試行
        </button>
      </div>
    );
  }

  // 全体の合計（未定も含む）
  const datedTotal = months.reduce((sum, month) => sum + budget[month].total, 0);
  const totalBudget = datedTotal + (undatedData?.total || 0);

  if (presentation === 'schedule' && onProduct) return <>
    {dateItem && <PurchaseTimingEditor key={dateItem.id} item={dateItem} onSaved={finishDateEdit} onClose={closeDateEditor}/>}
    {savedDateMessage && <p className="spend-message" role="status">{savedDateMessage}</p>}
    {selectionError && <p className="spend-message" role="alert">{selectionError}</p>}
    <ScheduleBudget budget={budget} allItems={allItems} categories={categories} period={shownPeriod} query={query}
      total={totalBudget} selectedIds={selectedIds}
      savingSelection={savingSelection} onPeriod={changePeriod} onSelect={toggleSelect}
      onReplaceSelection={ids=>setSelectedIds(new Set(ids))} onChoose={chooseCandidate} onProduct={onProduct}
      onDate={(item,trigger)=>{dateTrigger.current=trigger;setSavedDateMessage('');setDateItem(item);}}
      price={item=><PriceWithNote item={item} className="spend-formatted-price"/>}/>
  </>;

  return null;
}
