'use client';

import { useRef, useState, type ReactNode } from 'react';
import { CalendarCheck2, ChevronDown, ChevronRight, CircleDollarSign, ListFilter, SlidersHorizontal } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Lightbox } from '@astryxdesign/core/Lightbox';
import { apiFetch } from '@/lib/api-fetch';
import { amountText, type ReviewProduct } from '@/lib/design-home';
import { monthCaption, priorityLevels, priorityNames, rankedProducts, rankItem, type GuideAction, type MoveAction, type RankScope, type Timing } from '@/lib/design-rank';
import { focusedListSections, listDisplayLabel, type ListDisplay } from '@/lib/design-list-preview';
import type { Item } from '@/types';
import { ProductPicture } from './ProductLayouts';
import { PriorityDrag, PriorityRow } from './PriorityDrag';

async function writeRank(action: GuideAction | MoveAction) {
  const response = await apiFetch('/api/items/ranking', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(action),
  }, {notifyError:false});
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(problem?.error || '保存できませんでした。もう一度お試しください。');
  }
}

export default function RankedList({products,visible,openGuide,openProduct,onReload,focused=false,display='priority',priorities=[],openDisplay,onDate,empty,orderedProducts,selection}: {
  products:ReviewProduct[]; visible:ReviewProduct[]; openGuide:(p:ReviewProduct) => void; openProduct:(p:ReviewProduct) => void;
  onReload:() => Promise<void>;
  focused?:boolean;display?:ListDisplay;priorities?:number[];openDisplay:()=>void;
  onDate:(item:Item,trigger:HTMLButtonElement)=>void;empty?:ReactNode;
  orderedProducts?:ReviewProduct[];
  selection?:{ids:Set<number>;matchingIds:Set<number>;toggle:(ids:number[])=>void};
}) {
  const [scope,setScope] = useState<RankScope>('all');
  const [busy,setBusy] = useState(false);
  const writing = useRef(false);
  const [error,setError] = useState('');
  const [result,setResult] = useState('');
  const [photo,setPhoto] = useState<ReviewProduct|null>(null);
  const photoTrigger = useRef<HTMLButtonElement|null>(null);
  const currentYear = String(new Date().getFullYear());
  const ordered = rankedProducts(products);
  const numbers = new Map(ordered.map((p,i) => [p.key,i+1]));
  const matches = new Set(visible.map(p => p.key));
  const visiblePeers = new Map<number,ReviewProduct[]>();
  for (const product of ordered.filter(p=>matches.has(p.key))) {
    const level = rankItem(product).priority;
    const peers = visiblePeers.get(level) ?? [];
    peers.push(product);
    visiblePeers.set(level,peers);
  }
  const sections = focused ? focusedListSections(orderedProducts ?? ordered,visible,display) : scope === 'all' ? [{level:0,entries:ordered}] :
    priorityLevels.map(level => ({level,entries:ordered.filter(p => rankItem(p).priority === level)}));
  const showPriority=!focused || display!=='priority';
  async function move(source:ReviewProduct,target:ReviewProduct,side:'before'|'after') {
    if (writing.current || source === target) return;
    writing.current = true;
    setBusy(true); setError('');
    try {
      await writeRank({action:'move',itemId:rankItem(source).id,targetId:rankItem(target).id,side,scope:'priority'});
      await onReload(); setResult(source.name+'の順位を変更しました。');
    } catch (e) { setError(e instanceof Error ? e.message : '並べ替えに失敗しました。'); }
    finally { writing.current = false; setBusy(false); }
  }
  function dropPeer(sourceKey:string,targetKey:string) {
    const source = ordered.find(p => p.key === sourceKey);
    const target = ordered.find(p => p.key === targetKey);
    if (!source || !target || rankItem(source).priority !== rankItem(target).priority) return;
    void move(source,target,numbers.get(sourceKey)! < numbers.get(targetKey)! ? 'after' : 'before');
  }
  function picture(product:ReviewProduct) {
    return product.image ? <button type="button" className="rank-picture" aria-label={product.name+'の写真を拡大'} aria-haspopup="dialog"
      onClick={event=>{photoTrigger.current=event.currentTarget;setPhoto(product);}}><ProductPicture product={product}/></button>
      : <span className="rank-picture" role="img" aria-label={product.name+'の写真なし'}><ProductPicture product={product}/></span>;
  }
  return <div className={'rank-list'+(focused?' focused-list':'')}>
    <div className="rank-controls">
      {focused ? <button type="button" className="focused-display" aria-label={'リストの表示: '+listDisplayLabel(display)} aria-haspopup="dialog" onClick={openDisplay}>
        <ListFilter size={17}/><span>{listDisplayLabel(display)}</span><ChevronDown size={14}/>
        {priorities.length>0&&<span className="focused-active-priorities">{priorities.map(level=>priorityNames[level]).join('・')}</span>}
      </button> : <div className="rank-tabs" role="group" aria-label="リストの見方">
        <button type="button" aria-pressed={scope==='all'} onClick={() => setScope('all')}>買いそうな順</button>
        <button type="button" aria-pressed={scope==='priority'} onClick={() => setScope('priority')}>優先度別</button>
      </div>}
    </div>
    {focused && <p className="focused-order-note">全体順位を表示<span>優先度と順位は別々に調整できます</span></p>}
    {focused && <div className="rank-desktop-head" aria-hidden="true"><span>写真 / 順位</span><span>商品</span><span>価格</span><span>優先度・買いどき / 予定日</span></div>}
    {error && <p className="rank-error" role="alert">{error}</p>}
    <p className="sr-only" role="status">{result}</p>
    {!visible.length ? empty : null}
    <PriorityDrag onMove={dropPeer}>{sections.map(({level,entries}) => {
      const shown = entries.filter(p => matches.has(p.key));
      if (!shown.length) return null;
      return <section key={level} className="rank-section" aria-label={level ? '優先度 '+priorityNames[level] : focused ? listDisplayLabel(display)+'の候補' : '買いそうな順'}>
        {level > 0 && <h3>優先度 <strong>{priorityNames[level]}</strong><small>{shown.length}件</small></h3>}
        <ol>{shown.map(product => {
          const item = rankItem(product);
          const guide = item.buy_guide ?? product.active.buy_guide;
          const caption = guide && monthCaption(guide.month,guide.timing);
          const date = product.active.planned_purchase_date;
          const place = entries.indexOf(product);
          const selectedIds = selection ? product.offers.filter(offer=>selection.matchingIds.has(offer.id)).map(offer=>offer.id) : [];
          const checked = !!selection && selectedIds.length>0 && selectedIds.every(id=>selection.ids.has(id));
          const partial = !!selection && !checked && selectedIds.some(id=>selection.ids.has(id));
          return <PriorityRow key={product.key} product={product} priority={item.priority} position={numbers.get(product.key)!}
            peers={visiblePeers.get(item.priority)!} busy={busy} disableDrag={(focused&&display!=='priority') || !!selection}
            rankInHandle={focused}
            leading={focused?picture(product):undefined}
            rank={selection ? <input type="checkbox" className="integrated-select-item" aria-label={product.name+'を選択'} checked={checked}
              ref={node=>{if(node)node.indeterminate=partial;}} onChange={()=>selection.toggle(selectedIds)}/> : <span className="rank-number" aria-label={!focused&&level ? 'この優先度で'+(place+1)+'位、全体'+numbers.get(product.key)+'位' : '全体'+numbers.get(product.key)+'位'}>
              {String(!focused&&level ? place+1 : numbers.get(product.key)).padStart(2,'0')}
              {!focused && level > 0 && <small>全体{numbers.get(product.key)}位</small>}
            </span>}>
            <div className="rank-body">
              <div className="rank-product-head">
                <button type="button" className="rank-product" aria-label={product.name+'の詳細'} onClick={() => openProduct(product)}>
                  <strong title={product.name}>{product.name}</strong><span className="rank-price">{amountText(product.active)}</span>
                </button>
                {!focused && picture(product)}
              </div>
              <div className="rank-meta" data-has-date={!!date}>
              <button type="button" className="rank-guide" aria-label={product.name+'の優先度・買いどきを編集'} onClick={() => openGuide(product)}>
                <span className="rank-guide-line">{showPriority && <span className={'rank-priority rank-level-'+item.priority}><i aria-hidden/>優先度 {priorityNames[item.priority]}</span>}
                  {caption && <span className="rank-month">{guide?.month.startsWith(currentYear+'-') && <span className="rank-month-year">{currentYear}年</span>}{caption}</span>}
                  {!caption && (focused&&!showPriority || !guide?.condition&&!date) && <span className="rank-no-guide">{focused&&!showPriority?'優先度と時期':guide?.condition?'買う条件':'買いどきを決める'}</span>}
                  <ChevronRight aria-hidden size={12}/></span>
                {!focused && guide?.condition && <span className="rank-condition"><CircleDollarSign aria-hidden size={14}/>{guide.condition}</span>}
              </button>
              {date && (focused ? <button type="button" className="rank-date focused-date" aria-label={product.name+'の予定日を変更'} onClick={event=>onDate(product.active,event.currentTarget)}>
                <CalendarCheck2 aria-hidden size={14}/><time className="focused-date-text" dateTime={date}><span className="focused-date-year" data-current-year={date.slice(0,4)===currentYear || undefined}>{date.slice(0,4)}年</span><span>{Number(date.slice(5,7))}月{Number(date.slice(8,10))}日</span></time><ChevronRight aria-hidden size={12}/>
              </button> : <span className="rank-date"><CalendarCheck2 aria-hidden size={13}/> 購入予定 {date.slice(0,4) === String(new Date().getFullYear()) ? '' : date.slice(0,4)+'年'}{Number(date.slice(5,7))}月{Number(date.slice(8,10))}日</span>)}
              </div>
              {focused && guide?.condition && <button type="button" className="rank-condition focused-condition"
                aria-label={product.name+'の買う条件を編集'} title={guide.condition} onClick={()=>openGuide(product)}>
                <CircleDollarSign aria-hidden size={14}/><span>{guide.condition}</span>
              </button>}
            </div>
          </PriorityRow>;
        })}</ol>
      </section>;
    })}</PriorityDrag>
    {photo?.image && <Lightbox isOpen hasZoom className="rank-photo-viewer" aria-label={photo.name+'の写真'}
      media={{src:photo.image,alt:photo.name,caption:<span className="rank-photo-caption">{photo.name}</span>}}
      onOpenChange={open => {
        if (!open) {
          setPhoto(null);
          requestAnimationFrame(() => {if (photoTrigger.current?.isConnected) photoTrigger.current.focus({preventScroll:true});});
        }
      }}/>}
  </div>;
}

export function GuideEditor({product,products,onSaved,onDate,onSavingChange}: {product:ReviewProduct;products:ReviewProduct[]; onSaved:() => Promise<void>;onDate?:(item:Item,trigger:HTMLButtonElement)=>void;onSavingChange?:(busy:boolean)=>void}) {
  const item = rankItem(product);
  const guide = item.buy_guide ?? product.active.buy_guide;
  const [priority,setPriority] = useState(item.priority);
  const [rankScope,setRankScope] = useState<RankScope>('all');
  const [positionKey,setPositionKey] = useState(product.key);
  const entries = rankedProducts(products).filter(entry=>rankScope==='all' || entry.key===product.key || rankItem(entry).priority===priority);
  const [year,setYear] = useState(guide?.month.slice(0,4) || String(new Date().getFullYear()));
  const [monthNumber,setMonthNumber] = useState(guide?.month.slice(5,7) || '');
  const month = monthNumber ? year+'-'+monthNumber : '';
  const [timing,setTiming] = useState<Timing>(guide?.timing || 'by');
  const [condition,setCondition] = useState(guide?.condition || '');
  const [busy,setBusy] = useState(false);
  const writing = useRef(false);
  const [error,setError] = useState('');
  async function save(e:React.FormEvent) {
    e.preventDefault();
    if (writing.current) return;
    writing.current=true;setBusy(true);onSavingChange?.(true);setError('');
    try {
      const target = entries.find(entry=>entry.key===positionKey);
      if (!target) throw new Error('商品が移動しました。順位を選び直してください。');
      const guide = {action:'guide' as const,itemId:item.id,priority,month,timing,condition};
      await writeRank(target.key===product.key ? guide : {...guide,targetId:rankItem(target).id,
        side:entries.indexOf(target)<entries.findIndex(entry=>entry.key===product.key)?'before':'after',scope:rankScope});
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '保存に失敗しました。'); }
    finally { writing.current=false;setBusy(false);onSavingChange?.(false); }
  }
  return <form className="rank-editor" onSubmit={save}>
    <h4>{product.name}</h4>
    <fieldset disabled={busy}><legend>優先度</legend>
      <div className="rank-levels">{priorityLevels.map(level =>
        <label key={level}><input type="radio" name="priority" value={level} checked={priority===level} onChange={() => {setPriority(level);if(rankScope==='priority')setPositionKey(product.key);}}/>
          <span>{priorityNames[level]}</span></label>)}</div>
    </fieldset>
    <fieldset disabled={busy}><legend>順位</legend>
      <div className="rank-position-input">
        <select aria-label="順位の範囲" value={rankScope} onChange={event=>{setRankScope(event.target.value as RankScope);setPositionKey(product.key);}}>
          <option value="all">全体</option><option value="priority">同じ優先度内</option>
        </select>
        <select aria-label="移動先の順位" value={positionKey} onChange={event=>setPositionKey(event.target.value)}>
          {entries.map((entry,index)=><option key={entry.key} value={entry.key}>{index+1}位</option>)}
        </select>
      </div>
    </fieldset>
    <fieldset disabled={busy}><legend>買いたい時期 <small>任意</small></legend>
      <div className="rank-month-input">
        <label className="rank-year"><input type="text" inputMode="numeric" aria-label="目安の年" maxLength={4}
          pattern={monthNumber ? '[1-9][0-9]{3}' : undefined} required={!!monthNumber} value={year} onChange={e => setYear(e.target.value)}/> 年</label>
        <select aria-label="目安の月" value={monthNumber} onChange={e => setMonthNumber(e.target.value)}>
          <option value="">時期未定</option>
          {Array.from({length:12},(_,i) => <option key={i} value={String(i+1).padStart(2,'0')}>{i+1}月</option>)}</select>
        <select aria-label="時期の表し方" disabled={!monthNumber} value={timing} onChange={e => setTiming(e.target.value as Timing)}>
          <option value="by">までに</option><option value="around">ごろに</option></select></div>
    </fieldset>
    <label className="rank-condition-input"><span>どんなときに買う？ <small>任意</small></span>
      <textarea rows={2} maxLength={240} disabled={busy} placeholder="例：状態のよい中古が7,000円以内で見つかったら" value={condition} onChange={e => setCondition(e.target.value)}/>
    </label>
    {onDate ? <button type="button" className="focused-editor-date" disabled={busy} onClick={event=>onDate(product.active,event.currentTarget)}>
      <CalendarCheck2 size={17}/><span>購入予定日<small>{product.active.planned_purchase_date || '日程未定'}</small></span><ChevronRight size={16}/>
    </button> : <p className="rank-date-info">購入日が決まったら、商品詳細の「購入予定日」に登録できます。</p>}
    {error && <p className="rank-error" role="alert">{error}</p>}
    <Button type="submit" variant="primary" label={busy ? '保存中…' : '保存'} isDisabled={busy} icon={<SlidersHorizontal size={16}/>}/>
  </form>;
}
