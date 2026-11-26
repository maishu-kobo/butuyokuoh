'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ArrowUpRight, CalendarDays, Check, ChevronDown } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { formatYen } from '@/lib/capture/list-card';
import { linkableHttpUrl } from '@/lib/http-url';
import { amountText, type ReviewProduct } from '@/lib/design-home';
import type { Category, ComparisonGroup, Item } from '@/types';
import PhotoGroupCard from '../PhotoGroupCard';
import ItemCard from '../ItemCard';
import { ProductPicture } from './ProductLayouts';
import { purchaseTiming, purchaseTimingLabel } from '@/lib/purchase-timing';

export default function ProductDetails({ product, groups, categories, onReload, onDelete, onDate }: {
  product: ReviewProduct; groups: ComparisonGroup[]; categories: Category[];
  onReload: () => Promise<void>; onDelete: (id: number) => void; onDate: (item: Item, trigger: HTMLButtonElement) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const { active, row, face } = product;
  const group = row.kind === 'photo' ? groups.find(g => g.id === row.groupId) : null;
  const hasPurchasedOffer = product.offers.some(item => item.is_purchased);

  async function countOffer(id: number | null) {
    if (row.kind !== 'photo' || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/api/comparison-groups/'+row.groupId, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({budgetItemId:id}),
      }, {notifyError:false});
      if (!response.ok) throw new Error();
      await onReload();
    } catch {
      setError('販売候補を変更できませんでした。もう一度お試しください。');
    } finally { setBusy(false); }
  }

  return <div className="review-details">
    <div className="review-detail-head">
      <div className="review-detail-photo"><ProductPicture product={product} /></div>
      <div><small>{active.category_name || '未分類'}</small><h4>{product.name}</h4><strong>{amountText(active)}</strong></div>
    </div>
    {!!active.notes && <p className="review-detail-note">{active.notes}</p>}
    <button type="button" className="review-detail-date" onClick={e => onDate(active,e.currentTarget)}>
      <CalendarDays size={18} /><span>購入時期</span><strong>{purchaseTimingLabel(purchaseTiming(active))}</strong>
    </button>
    <div className="review-offer-heading"><h4>販売候補</h4><span>{product.offers.length}件</span></div>
    <ul className="review-offers">{product.offers.map(item => {
      const url = linkableHttpUrl(item.url);
      const included = item.countsInTotal !== false;
      return <li key={item.id}>
        <div><strong>{item.source_name || item.source}</strong>
          <span>{item.current_price == null ? '価格未取得' : formatYen(item.current_price)}</span></div>
        <div>{url && <a href={url} target="_blank" rel="noopener noreferrer">販売ページ <ArrowUpRight size={13} /></a>}
          {item.is_purchased ? <small>購入済み</small> : row.kind === 'photo' && !hasPurchasedOffer && (
            <button type="button" aria-pressed={included} disabled={busy}
              aria-label={item.source_name+'を予算に使う'} onClick={() => void countOffer(item.id)}>
              {included && <Check size={13} aria-hidden />}{included ? '予算に計上中' : 'この店を選ぶ'}
            </button>
          )}
        </div>
      </li>;
    })}</ul>
    {row.kind === 'photo' && group?.budget_item_id != null && !hasPurchasedOffer && <Button type="button" variant="ghost"
      label="自動（最安）に戻す" className="review-text-action" isDisabled={busy} onClick={() => void countOffer(null)} />}
    {error && <p role="alert">{error}</p>}
    <details className="review-full-detail" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>編集・価格履歴・購入済み操作 <ChevronDown size={16} /></summary>
      {expanded && (row.kind === 'photo' ? <PhotoGroupCard card={row} item={face} categories={categories}
        comparisonGroups={groups} onUpdate={onReload} isDragEnabled={false} shopsOpen />
        : <ItemCard item={face} categories={categories} comparisonGroups={groups} onUpdate={onReload} onDelete={onDelete} />)}
    </details>
  </div>;
}
