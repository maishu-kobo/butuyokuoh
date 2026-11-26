'use client';

import { useId, useState, type ReactNode } from 'react';
import { CalendarPlus, Check, CheckSquare, ChevronDown, ChevronRight, Square, SquareMinus } from 'lucide-react';
import type { Category, Item } from '@/types';
import { formatYen } from '@/lib/capture/list-card';
import { lineAmount } from '@/lib/photo-spend';
import { budgetSelectionState, scheduleBudgetRows, scheduleCalendarDate, toggleBudgetSelection, type ScheduleBudgetData, type ScheduleBudgetRow } from '@/lib/design-budget';
import './schedule-budget.css';
import { purchaseTiming, purchaseTimingLabel } from '@/lib/purchase-timing';

const weekday = new Intl.DateTimeFormat('ja-JP', {weekday:'short',timeZone:'UTC'});
interface Props {
  budget:ScheduleBudgetData; allItems:Item[]; categories:Category[]; period:string; query:string;
  total:number; selectedIds:Set<number>;
  savingSelection:boolean; onPeriod:(value:string)=>void; onSelect:(id:number)=>void;
  onReplaceSelection:(ids:number[])=>void;
  onChoose:(group:number,item:number|null)=>Promise<void>;
  onDate:(item:Item,trigger:HTMLButtonElement)=>void; onProduct:(item:Item)=>void;
  price:(item:Item)=>ReactNode;
}

function SelectionCheck({checked,label,onChange,disabled=false,children}: {
  checked:boolean|'mixed'; label:string; onChange:()=>void; disabled?:boolean; children?:ReactNode;
}) {
  return <button type="button" role="checkbox" className="spend-check" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange}>
    {checked==='mixed'?<SquareMinus size={19} aria-hidden/>:checked?<CheckSquare size={19} aria-hidden/>:<Square size={19} aria-hidden/>}{children}
  </button>;
}

const amount = (items:Item[]) => items.reduce((total,item)=>total+lineAmount(item.current_price,item.quantity),0);

export default function ScheduleBudget(props:Props) {
  const {budget,allItems,period,query,selectedIds,price}=props;
  const [breakdownOpen,setBreakdownOpen]=useState(false);
  const breakdownId=useId();
  const categoryName=(item:Item)=>item.category_name || props.categories.find(category=>category.id===item.category_id)?.name || '未分類';
  const months=Object.keys(budget).filter(key=>key!=='undated').sort();
  const periodKeys=period==='all' ? [...months,...(budget.undated ? ['undated']:[])] : [period];
  const term=query.trim().toLocaleLowerCase('ja-JP');
  const sections=periodKeys.map(month=>({month,rows:scheduleBudgetRows(budget[month]?.items ?? [],allItems).filter(row=>!term ||
    [row.name,...row.offers.flatMap(item=>[item.name,item.source_name,categoryName(item),item.notes])]
      .some(value=>value?.toLocaleLowerCase('ja-JP').includes(term)))})).filter(section=>section.rows.length);
  const displayed=sections.flatMap(section=>section.rows.flatMap(row=>row.monthItems));
  const selectedItems=displayed.filter(item=>selectedIds.has(item.id));
  const unknownCount=displayed.filter(item=>item.current_price==null).length;
  const selectScope=(items:Item[])=>props.onReplaceSelection([...toggleBudgetSelection(items,selectedIds)]);

  function rowView(row:ScheduleBudgetRow) {
    const {item}=row;
    const date=scheduleCalendarDate(item.planned_purchase_date);
    const timing=purchaseTiming(item);
    const override=row.offers.some(offer=>offer.budget_selected_item_id!=null);
    return <li key={row.key} className="spend-line">
      <div className="spend-line-date">
        <SelectionCheck checked={selectedIds.has(item.id)} label={row.name+'を選択'} onChange={()=>props.onSelect(item.id)}/>
        <button type="button" id={'agenda-date-'+item.id} className="review-day" data-timing={timing.kind} aria-label={row.name+'の購入時期を変更'} title={purchaseTimingLabel(timing)}
          onClick={event=>props.onDate(item,event.currentTarget)}>
          {date ? <><strong>{date.getUTCDate()}</strong><small>{weekday.format(date)}曜</small></>
            : timing.kind==='month'?<><strong>{timing.timing==='by'?'期限':'目安'}</strong><small>{timing.timing==='by'?'月末まで':'月ごろ'}</small></>
              : <><CalendarPlus size={20}/><small>決める</small></>}
        </button>
      </div>
      <div className="spend-line-main">
        <button type="button" className="spend-product" aria-label={row.name+'の詳細'} onClick={()=>props.onProduct(item)}>
          <strong>{row.name}</strong><span className="spend-price">{price(item)}</span><ChevronRight size={14} aria-hidden/>
          <small>{categoryName(item)}{row.offers.length>1 && ' · '+row.offers.length+'店で比較'}
            {(item.quantity||1)>1 && ' · 数量'+item.quantity}{item.countsInTotal===false && ' · 合計に含まない'}</small>
        </button>
        {row.chooseGroupId!=null && <details className="spend-offers">
          <summary>お店と価格を見る <ChevronDown size={14} aria-hidden/></summary>
          <div className="spend-store-list">{row.offers.map(offer=><div className="spend-store" key={offer.id}>
            <SelectionCheck checked={selectedIds.has(offer.id)} label={(offer.source_name || offer.name)+'を選択'} onChange={()=>props.onSelect(offer.id)}/>
            <div className="spend-store-content">
            <div className="spend-store-name"><strong>{offer.source_name || offer.source || '店舗未確認'}</strong><span>{price(offer)}</span></div>
            <div className="spend-store-actions">
              <button type="button" className="spend-count" aria-pressed={offer.countsInTotal===true} disabled={props.savingSelection}
                aria-label={(offer.source_name || offer.name)+'を合計に数える'} onClick={()=>void props.onChoose(row.chooseGroupId!,offer.id)}>
                {offer.countsInTotal===true && <Check size={14}/>} {offer.countsInTotal===true?'計上中':'合計に数える'}
              </button>
              <button type="button" onClick={event=>props.onDate(offer,event.currentTarget)}
                aria-label={(offer.source_name || offer.name)+'の購入時期を変更'}>時期を変更</button>
            </div>
            </div>
          </div>)}
          {override && <button type="button" className="spend-reset" disabled={props.savingSelection}
            aria-label={row.name+'を自動（最安）に戻す'} onClick={()=>void props.onChoose(row.chooseGroupId!,null)}>自動（最安）に戻す</button>}
          </div>
        </details>}
      </div>
    </li>;
  }

  return <div className="spend-view">
    <div className="spend-overview">
    <section className="spend-summary" aria-label="出費の概要" data-expanded={breakdownOpen}>
      <div className="spend-grand-total"><span>選択合計</span><strong role="status" aria-label="選択合計" data-testid="spend-selected-total">{formatYen(amount(selectedItems))}</strong>
        <span className="spend-selection-count">{selectedItems.length}件</span></div>
      <button type="button" className="spend-breakdown-toggle" aria-label="合計の内訳" aria-expanded={breakdownOpen}
        aria-controls={breakdownId+'-count '+breakdownId+'-amounts'} onClick={()=>setBreakdownOpen(!breakdownOpen)}>
        内訳<ChevronDown size={14} aria-hidden="true"/>
      </button>
      <dl id={breakdownId+'-amounts'}><div><dt>日付指定</dt><dd>{formatYen(amount(selectedItems.filter(item=>purchaseTiming(item).kind==='date')))}</dd></div>
        <div><dt>月の目安</dt><dd>{formatYen(amount(selectedItems.filter(item=>purchaseTiming(item).kind==='month')))}</dd></div>
        <div><dt>時期未定</dt><dd>{formatYen(amount(selectedItems.filter(item=>purchaseTiming(item).kind==='undated')))}</dd></div></dl>
      <div className="spend-reference" id={breakdownId+'-count'}><div><span>全体の合計</span><strong data-testid="spend-total">{formatYen(props.total)}</strong></div>
        <small>全期間 · 販売候補 {allItems.length}件</small></div>
      {unknownCount>0 && <p>価格未取得 {unknownCount}件</p>}
    </section>
    </div>
    <div className="spend-months">
    <div className="spend-tools">
      <SelectionCheck checked={budgetSelectionState(displayed,selectedIds)} label="表示中の商品を全選択" disabled={!displayed.length} onChange={()=>selectScope(displayed)}>全選択</SelectionCheck>
      <label><span className="spend-period-label">表示期間</span><select aria-label="表示期間" value={period} onChange={event=>props.onPeriod(event.target.value)}>
        <option value="all">全期間</option>{months.map(month=><option key={month} value={month}>{month.slice(0,4)}年{Number(month.slice(5))}月</option>)}
        {budget.undated && <option value="undated">時期未定</option>}
      </select></label>
    </div>
    {!sections.length && <p className="spend-empty">{term?'条件に合う予定はありません。':'この期間の出費予定はありません。'}</p>}
    {sections.map(({month,rows})=>{
      const undated=month==='undated';
      const monthName=undated?'時期未定':month.slice(0,4)+'年'+Number(month.slice(5))+'月';
      const entries=rows.flatMap(row=>row.monthItems);
      const checked=entries.filter(item=>selectedIds.has(item.id));
      const unknown=entries.filter(item=>item.current_price==null).length;
      return <section key={month} className="spend-month" aria-label={monthName}>
        <header>
          <div className="spend-month-heading"><SelectionCheck checked={budgetSelectionState(entries,selectedIds)} label={monthName+'の商品を全選択'} onChange={()=>selectScope(entries)}/>
            <h2>{undated?'時期未定':<><b>{Number(month.slice(5))}</b>月 <small>{month.slice(0,4)}</small></>}</h2></div>
          <div className="spend-month-amount"><span>{checked.length}件</span><strong aria-label={monthName+'の合計'}>{formatYen(amount(checked))}</strong></div>
        </header>
        {unknown>0 && <p className="spend-unknown">{unknown}件は価格未取得</p>}
        <ul>{rows.map(rowView)}</ul>
      </section>;
    })}
    </div>
  </div>;
}
