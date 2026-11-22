'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { useId, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import type { Item } from '@/types';

export default function BudgetDateEditor({ item, onSaved, onClose }: {
  item: Item;
  onSaved: (date: string) => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(item.planned_purchase_date || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();

  async function save() {
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      const response = await apiFetch(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planned_purchase_date: date || null }),
      }, { notifyError: false });
      if (!response.ok) throw new Error();
      await onSaved(date);
    } catch {
      setError('予定日を保存できませんでした。もう一度お試しください。');
      setSaving(false);
    }
  }

  return (
    <Dialog isOpen onOpenChange={open => { if (!open && !saving) onClose(); }}
      aria-labelledby={titleId} width={420} className="agenda-date-dialog">
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2 id={titleId}>購入予定日を変更</h2>
        <p>{item.name}</p>
        <label>購入予定日
          <input type="date" value={date} min="0001-01-01" max="9999-12-31" onChange={event => setDate(event.target.value)} />
        </label>
        <Button type="button" label="日程未定にする" variant="ghost" isDisabled={saving} onClick={() => setDate('')} />
        {error && <p role="alert">{error}</p>}
        <div className="agenda-date-dialog-actions">
          <Button type="button" label="キャンセル" variant="secondary" isDisabled={saving} onClick={onClose} />
          <Button type="submit" label="予定日を保存" variant="primary" isDisabled={saving} />
        </div>
      </form>
    </Dialog>
  );
}
