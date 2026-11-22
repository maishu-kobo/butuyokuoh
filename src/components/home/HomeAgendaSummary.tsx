'use client';

import Image from 'next/image';
import { Button } from '@astryxdesign/core/Button';
import { ArrowUpRight, CalendarDays } from 'lucide-react';
import { displayableItemImageUrl } from '@/lib/capture/image-hosts';
import { localCalendarDate } from '@/lib/local-date';
import { photoImageUrl } from '@/lib/capture/photo-card-view';
import type { Item } from '@/types';

const dateShort = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

export default function HomeAgendaSummary({ items, productCount, total, onBudget }: { items: Item[]; productCount: number; total: number; onBudget?: () => void }) {
  const today = localCalendarDate();
  const upcoming = items.reduce<Item | undefined>((next, item) => {
    if (item.countsInTotal === false || !item.planned_purchase_date || item.planned_purchase_date < today) return next;
    return !next || item.planned_purchase_date < next.planned_purchase_date! ? item : next;
  }, undefined);
  const img = upcoming && (upcoming.group_origin === 'photo' || upcoming.comparison_group_origin === 'photo'
    ? photoImageUrl(upcoming.source, upcoming.image_url) : displayableItemImageUrl(upcoming.image_url));
  const noPrice = items.filter(item => item.countsInTotal !== false && item.current_price == null).length;
  const date = upcoming?.planned_purchase_date;
  const localDate = date && new Date(date + 'T12:00:00');

  return (
    <section className="agenda-summary" aria-label="購入予定とリストの概要">
      <div className="agenda-next">
        <div className="agenda-next-copy">
          <h2><CalendarDays size={16} aria-hidden="true" /> 次の購入予定</h2>
          {date && localDate && Number.isFinite(localDate.getTime()) ? <>
            <time dateTime={date}>{dateShort.format(localDate)}</time>
            <p>{upcoming?.name}</p>
          </> : <p className="agenda-next-empty">これからの購入予定はありません</p>}
          {onBudget && <Button type="button" variant="ghost" label="出費予定を見る" onClick={onBudget} endContent={<ArrowUpRight size={15} aria-hidden="true" />} />}
        </div>
        {img && <Image className="agenda-next-photo" width={175} height={160} src={img} alt="" unoptimized />}
      </div>
      <dl className="agenda-list-totals">
        <div><dt>ほしい商品</dt><dd>{productCount}<span className="agenda-count-unit">件</span></dd>
          <small>販売候補 {items.length}件</small></div>
        <div><dt>合計金額</dt><dd>¥{total.toLocaleString()}</dd>
          {noPrice > 0 && <small>価格未取得 {noPrice}件</small>}</div>
      </dl>
    </section>
  );
}
