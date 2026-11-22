'use client';

import { useCallback, useEffect, useRef, useState, type RefObject, type ChangeEvent } from 'react';
import Image from 'next/image';
import { Button } from '@astryxdesign/core/Button';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Lightbox } from '@astryxdesign/core/Lightbox';
import { Camera, ImagePlus, Maximize2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { photoForUpload } from '@/lib/capture/photo-pick';
import { CaptureSearchPanel } from './CaptureSearchPanel';
import RegistrationActions from './RegistrationActions';

const noChange = () => {};

export function AgendaPhotoEntry({ isGuest, onSaved, onExisting, cameraInputRef, compact=false, onSavingChange }: {
  compact?: boolean;
  onSavingChange?: (busy:boolean) => void;
  cameraInputRef?: RefObject<HTMLInputElement | null>;
  isGuest: boolean;
  onSaved: (message: string) => void;
  onExisting: (location: 'list' | 'purchased' | 'trash') => void;
}) {
  const internalCamera = useRef<HTMLInputElement>(null);
  const camera = cameraInputRef ?? internalCamera;
  const library = useRef<HTMLInputElement>(null);
  const zoomTrigger = useRef<HTMLButtonElement>(null);
  const version = useRef(0);
  const uploaded = useRef<string | null>(null);
  const saving = useRef(false);
  const [photo,setPhoto] = useState<{file:File; src:string} | null>(null);
  const [preview,setPreview] = useState('');
  const [note,setNote] = useState('');
  const [date,setDate] = useState('');
  const [name,setName] = useState('');
  const [busy,setBusy] = useState(false);
  const [reading,setReading] = useState(false);
  const [error,setError] = useState('');
  const [liveEnabled,setLiveEnabled] = useState(false);
  const [live,setLive] = useState(false);
  const [zoom,setZoom] = useState(false);
  useEffect(() => {
    if (isGuest) return;
    let current = true;
    void apiFetch('/api/capture', undefined, {notifyError:false}).then(r=>r.ok ? r.json() : null)
      .then(data=>{if(current) setLiveEnabled(data?.enabled===true);}).catch(()=>{});
    return () => {current=false;};
  },[isGuest]);
  useEffect(() => () => {if (photo) URL.revokeObjectURL(photo.src);},[photo]);

  function resetChoice() {
    setLive(false); setName(''); setPreview(''); setError('');
    uploaded.current = null;
  }
  async function loadFile(file: File) {
    const current = ++version.current;
    setReading(true); setError('');
    try {
      const result = await photoForUpload([file]);
      if (version.current !== current) return;
      if (!result.ok) {
        if (!result.ignored) setError(result.message);
        return;
      }
      let prepared = result.file;
      if (prepared.type !== 'image/jpeg') {
        const body = new FormData();
        body.append('photo',prepared);
        const response = await apiFetch('/api/capture/photo-preview',{method:'POST',body},{notifyError:false});
        if (!response.ok) throw new Error('写真を読み込めませんでした。');
        const jpg = await response.blob();
        if (version.current !== current) return;
        prepared = new File([jpg], (prepared.name.replace(/\.[^.]+$/, '') || 'photo') + '.jpg', {type:'image/jpeg'});
      }
      resetChoice();
      setPhoto({file:prepared,src:URL.createObjectURL(prepared)});
    } catch {
      if (version.current === current) setError('写真を読み込めませんでした。別の写真を選んでください。');
    } finally { if (version.current === current) setReading(false); }
  }
  function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value='';
    if (file) void loadFile(file);
  }
  const enterManual = useCallback((guess:string)=>{setName(guess);},[]);
  const src = preview || photo?.src;
  function markSaving(value:boolean) {
    saving.current=value;setBusy(value);onSavingChange?.(value);
  }
  async function save() {
    if (saving.current || reading || !photo) return;
    markSaving(true); setError('');
    try {
        if (!uploaded.current) {
          const body = new FormData();
          body.append('file',photo!.file);
          const response = await apiFetch('/api/upload',{method:'POST',body},{notifyError:false});
          const data = await response.json();
          if (!response.ok || typeof data.url !== 'string') throw new Error(data.error || '写真を保存できませんでした');
          uploaded.current=data.url;
        }
      const payload={ manual:true, name:name.trim() || '写真で残したほしいもの（型番未確定）', image_url:uploaded.current, notes:note.trim() || null, planned_purchase_date:date || null };
      const response=await apiFetch('/api/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},{notifyError:false});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error || '登録できませんでした');
      onSaved(date ? '購入予定を付けて登録しました' : '写真をほしいものリストに登録しました');
    } catch(reason){setError(reason instanceof Error ? reason.message : '保存できませんでした。もう一度お試しください。');}
    finally{markSaving(false);}
  }
  const annotations=<>
    <TextArea label="気になった理由（任意）" placeholder="サイズを店頭で確認したい" width="100%" rows={2} value={note} onChange={setNote} maxLength={1600}/>
    <label className="ap-labeled">購入予定日 <small>任意</small><input aria-label="購入予定日" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
  </>;
  return <div className="ap-photo-layout">
    <section className="ap-photo-col" aria-label="登録する写真"
      onDragOver={event=>{if(!isGuest)event.preventDefault();}}
      onDrop={event=>{if(isGuest || busy)return;event.preventDefault();const files=event.dataTransfer.files;if(files.length===1)void loadFile(files[0]);else if(files.length)setError('写真は1枚ずつ選んでください。');}}>
      {src ? <div className="ap-preview"><button type="button" ref={zoomTrigger} onClick={()=>setZoom(true)} aria-label="写真を拡大">
        <Image src={src} width={640} height={480} unoptimized alt="選択した写真" /><span><Maximize2 size={14}/> 拡大</span>
      </button></div> : <div className="ap-empty-photo"><Camera size={42} strokeWidth={1.3}/><h2>登録する写真を選ぶ</h2><p>商品の本体や値札が写った写真を使えます。</p></div>}
      <div className="ap-photo-actions">
        {!isGuest && <><Button label="カメラで撮る" icon={<Camera size={17}/>} onClick={()=>camera.current?.click()} isDisabled={busy}/>
          <Button label="写真を選ぶ" icon={<ImagePlus size={17}/>} onClick={()=>library.current?.click()} isDisabled={busy}/>
          <input hidden ref={camera} type="file" accept="image/*" capture="environment" aria-label="カメラの写真" onChange={pick}/>
          <input hidden ref={library} type="file" accept="image/*" aria-label="登録する画像ファイル" onChange={pick}/></>}
        {isGuest && <p className="ap-fine">写真の登録はログイン後に利用できます。</p>}
      </div>
      {reading && <p role="status">写真を準備しています…</p>}
    </section>
    <section className="ap-fields" aria-label="写真の登録内容">
      {compact ? <details className="ap-details"><summary>メモ・購入予定日</summary><div className="registration-notes">{annotations}</div></details> :
        <><h2>写真とメモを残す</h2><p className="ap-fine">型番・価格がわからなくても登録できます。</p>{annotations}</>}
      {photo && <details className="ap-details" open={name ? true : undefined}><summary>商品名を指定（任意）</summary><label className="ap-labeled">商品名<input type="text" maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label></details>}
      <RegistrationActions>
      {error && <p role="alert" className="ap-error">{error}</p>}
      <div className="ap-submit"><span>価格未取得で登録できます</span>
        <Button label={busy?'登録しています…':compact?'登録する':'ほしいものに登録'} variant="primary" size="lg" isDisabled={busy || reading || !src || isGuest} onClick={()=>void save()}/>
      </div>
      </RegistrationActions>
      {photo && liveEnabled && <section className="ap-online"><h3>販売ページを探す</h3>
        {!live ? <><p className="ap-fine">商品判定と販売候補の検索を開始します。</p><Button label="この写真から商品を検索" onClick={()=>setLive(true)}/></>
          : <CaptureSearchPanel allowManualSearchOnFallback file={photo.file} onSearching={noChange} onPreview={setPreview} onManual={enterManual} onRegistered={onSaved} onRegisteringChange={markSaving} onViewRegistered={onExisting} plannedDate={date} notes={note}/>}
      </section>}
    </section>
    {zoom && src && <Lightbox isOpen hasZoom media={{src,alt:'登録する写真'}} onOpenChange={v=>{if(!v){setZoom(false);requestAnimationFrame(()=>zoomTrigger.current?.focus());}}}/>}
  </div>;
}
