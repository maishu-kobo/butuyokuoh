'use client';

import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import type { Item } from '@/types';
import { purchaseTiming, type PurchaseTiming } from '@/lib/purchase-timing';
import './purchase-timing.css';

export interface TimingDraft {mode:PurchaseTiming['kind'];year:string;month:string;relation:'by'|'around';date:string}
export function timingDraft(item:Item):TimingDraft {
  const value=purchaseTiming(item);
  const month=item.buy_guide?.month || item.planned_purchase_date?.slice(0,7) || '';
  return {mode:value.kind,year:month.slice(0,4)||String(new Date().getFullYear()),month:month.slice(5,7),
    relation:item.buy_guide?.timing||'around',date:item.planned_purchase_date||''};
}
export function timingValue(draft:TimingDraft):PurchaseTiming {
  return draft.mode==='date'?{kind:'date',date:draft.date}:draft.mode==='month'?{kind:'month',month:draft.year+'-'+draft.month,timing:draft.relation}:{kind:'undated'};
}
export default function PurchaseTimingFields({value,onChange,disabled=false}:{value:TimingDraft;onChange:(value:TimingDraft)=>void;disabled?:boolean}) {
  return <fieldset className="purchase-timing-fields" disabled={disabled}>
    <RadioList label="購入時期" isDisabled={disabled} value={value.mode} onChange={mode=>onChange({...value,mode:mode as TimingDraft['mode']})} containerClassName="purchase-mode-options">
      <RadioListItem className="purchase-mode-option" value="undated" label="未定"/><RadioListItem className="purchase-mode-option" value="month" label="月"/><RadioListItem className="purchase-mode-option" value="date" label="日付"/>
    </RadioList>
    {value.mode==='month' && <div className="purchase-month-fields">
      <label className="purchase-year"><input type="text" inputMode="numeric" aria-label="購入する年" maxLength={4} pattern="[1-9][0-9]{3}" required
        value={value.year} onChange={e=>onChange({...value,year:e.target.value})}/>年</label>
      <select aria-label="購入する月" required value={value.month} onChange={e=>onChange({...value,month:e.target.value})}>
        <option value="">月を選ぶ</option>{Array.from({length:12},(_,i)=><option key={i} value={String(i+1).padStart(2,'0')}>{i+1}月</option>)}
      </select>
      <select aria-label="時期の表し方" value={value.relation} onChange={e=>onChange({...value,relation:e.target.value as TimingDraft['relation']})}>
        <option value="around">ごろ</option><option value="by">まで</option>
      </select>
    </div>}
    {value.mode==='date' && <label className="purchase-day-field"><span>購入する日</span><input aria-label="購入する日" type="date" required min="0001-01-01" max="9999-12-31"
      value={value.date} onChange={e=>onChange({...value,date:e.target.value})}/></label>}
  </fieldset>;
}
