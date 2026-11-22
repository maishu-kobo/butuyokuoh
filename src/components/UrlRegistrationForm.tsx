'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@astryxdesign/core/Button';
import { ArrowUpRight, Link2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { safeImgSrc } from '@/lib/capture/image-hosts';
import { linkableHttpUrl } from '@/lib/http-url';
import { priorityLevels, priorityNames } from '@/lib/design-rank';
import type { Category, ComparisonGroup } from '@/types';
import RegistrationActions from './RegistrationActions';

interface ProductInfo {
  name:string; price:number|null; image_url:string|null; source_name:string|null; note?:string;
}

export default function UrlRegistrationForm({initialUrl='',categories,groups,onSaved,onSavingChange,onManual}: {
  initialUrl?:string; categories:Category[]; groups:ComparisonGroup[]; onSaved:(message:string) => void; onSavingChange:(busy:boolean) => void;
  onManual:(url:string)=>void;
}) {
  const formId=useId();
  const [draft,setDraft] = useState(initialUrl);
  const urlField = useRef<HTMLInputElement>(null);
  const [request,setRequest] = useState<{url:string} | null>(() => initialUrl ? {url:initialUrl} : null);
  const [loading,setLoading] = useState(!!initialUrl);
  const [info,setInfo] = useState<ProductInfo|null>(null);
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const writing = useRef(false);
  const [priority,setPriority] = useState(3);
  const [category,setCategory] = useState('');
  const [quantity,setQuantity] = useState('1');
  const [date,setDate] = useState('');
  const [group,setGroup] = useState('');
  const [notes,setNotes] = useState('');

  useEffect(() => {
    if (!request) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch('/api/items/preview',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:request.url}),signal:abort.signal,
        },{notifyError:false});
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '商品情報を取得できませんでした。');
        if (!abort.signal.aborted) setInfo(data);
      } catch (reason) {
        if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '商品情報を取得できませんでした。');
      } finally { if (!abort.signal.aborted) setLoading(false); }
    })();
    return () => abort.abort();
  },[request]);

  function preview(event:React.FormEvent) {
    event.preventDefault();
    if (writing.current || saving) return;
    const url=linkableHttpUrl(draft.trim());
    if (!url) {setError('http または https の商品URLを入力してください。');return;}
    urlField.current?.blur();
    setInfo(null); setError(''); setLoading(true); setRequest({url});
  }
  async function save(event?:React.FormEvent) {
    event?.preventDefault();
    if (!request || writing.current) return;
    writing.current=true; setSaving(true); onSavingChange(true); setError('');
    try {
      const response=await apiFetch('/api/items',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:request.url,priority,category_id:category ? Number(category) : null,comparison_group_id:group ? Number(group) : null,notes:notes || null,quantity:Number(quantity),planned_purchase_date:date || null}),
      },{notifyError:false});
      const data=await response.json();
      if (!response.ok) throw new Error(data.error || '登録できませんでした。');
      onSaved(data.restoreMessage || data.scrapeNote || '販売ページから商品を登録しました');
    } catch(reason) {setError(reason instanceof Error ? reason.message : '登録できませんでした。');}
    finally {writing.current=false;setSaving(false);onSavingChange(false);}
  }

  const image=safeImgSrc(info?.image_url);
  return <div className="registration-url">
    {info && request ? <form id={formId} onSubmit={save}>
      <div className="registration-preview">
        {image && <Image unoptimized src={image} alt="" width={62} height={62}/>}
        <div><small>{info.source_name}</small><strong>{info.name}</strong><span>{info.price == null ? '価格未取得' : '¥'+info.price.toLocaleString('ja-JP')}</span></div>
      </div>
      <div className="registration-links">
        {linkableHttpUrl(request.url) && <a href={linkableHttpUrl(request.url)!} target="_blank" rel="noopener noreferrer" className="registration-source">販売ページを開く <ArrowUpRight size={14}/></a>}
        <button type="button" className="registration-change" disabled={saving} onClick={()=>{setRequest(null);setInfo(null);setError('');}}>URLを変更</button>
      </div>
      {info.note && <p className="ap-fine">{info.note}</p>}
      <details className="ap-details"><summary>優先度・購入予定など</summary>
        <div className="registration-fields">
          <label>優先度<select value={priority} onChange={e=>setPriority(Number(e.target.value))}>
            {priorityLevels.map(n=><option value={n} key={n}>{priorityNames[n]}</option>)}</select></label>
          <label>個数<input type="number" min="1" max="999" required value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
          <label>購入予定日<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
          {!!categories.length && <label>カテゴリ<select value={category} onChange={e=>setCategory(e.target.value)}>
            <option value="">なし</option>{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>}
          {!!groups.length && <label>比較グループ<select value={group} onChange={e=>setGroup(e.target.value)}>
            <option value="">なし</option>{groups.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</select></label>}
          <label>メモ<textarea rows={2} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
        </div>
      </details>
      <RegistrationActions>
        {error && <p className="ap-error" role="alert">{error}</p>}
        <div className="registration-action"><Button type="submit" form={formId} label={saving?'登録中…':'登録する'} variant="primary" isDisabled={saving}/></div>
      </RegistrationActions>
    </form> : <form id={formId} onSubmit={preview}>
      <label className="registration-field">商品URL<input type="url" ref={urlField} required maxLength={8192} autoCapitalize="none" autoCorrect="off"
        inputMode="url" enterKeyHint="go" spellCheck={false} placeholder="https://…" value={draft} onChange={e=>{setDraft(e.target.value);setError('');}} readOnly={loading || saving}/></label>
      <RegistrationActions>
        {error && <p className="ap-error" role="alert">{error}</p>}
        {loading && <p role="status" className="ap-fine">商品情報を取得中…</p>}
        {error && request && !loading && <div className="registration-links">
          <Button type="button" label="登録する" isDisabled={saving} onClick={()=>void save()}/>
          <button type="button" disabled={saving} onClick={()=>onManual(request.url)}>商品名を入力して登録</button>
        </div>}
        <div className="registration-action"><Button type="submit" form={formId} icon={<Link2 size={16}/>} variant="primary" label={error && request ? '再試行' : '商品情報を取得'} isDisabled={!draft.trim() || loading || saving}/></div>
      </RegistrationActions>
    </form>}
  </div>;
}
