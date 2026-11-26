'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import type { Item } from '@/types';
import { apiFetch } from '@/lib/api-fetch';
import { parsePurchaseTiming, purchaseTimingInput, type PurchaseTiming } from '@/lib/purchase-timing';
import PurchaseTimingFields, { timingDraft, timingValue } from './PurchaseTimingFields';
import ReviewSheet from './ReviewSheet';

export default function PurchaseTimingEditor({item,onSaved,onClose}:{item:Item;onSaved:(value:PurchaseTiming)=>Promise<void>;onClose:()=>void}) {
  const [draft,setDraft]=useState(()=>timingDraft(item));
  const [dirty,setDirty]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  async function save(event:React.FormEvent) {
    event.preventDefault();if(saving) return;
    const value=parsePurchaseTiming(timingValue(draft));
    if(!value) {setError('購入時期を確認してください。');return;}
    if(!dirty) {onClose();return;}
    setSaving(true);setError('');
    try {
      const response=await apiFetch('/api/items/ranking',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'timing',itemId:item.id,...purchaseTimingInput(value)})},{notifyError:false});
      if(!response.ok) throw new Error();
      await onSaved(value);
    } catch {setError('保存できませんでした。もう一度お試しください。');setSaving(false);}
  }
  return <ReviewSheet title="購入時期" onClose={onClose} lockDismiss={saving} fitVisualViewport className="purchase-timing-sheet">
    <form className="purchase-timing-editor" onSubmit={save}>
      <h4>{item.comparison_group_name || item.name}</h4>
      <PurchaseTimingFields value={draft} disabled={saving} onChange={next=>{setDraft(next);setDirty(true);}}/>
      {error&&<p role="alert">{error}</p>}
      <div className="purchase-timing-actions"><Button type="button" label="キャンセル" variant="secondary" isDisabled={saving} onClick={onClose}/>
        <Button type="submit" label={saving?'保存中…':'保存'} variant="primary" isDisabled={saving}/></div>
    </form>
  </ReviewSheet>;
}
