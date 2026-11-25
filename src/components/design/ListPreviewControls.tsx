'use client';

import { useId } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import type { ReviewProduct } from '@/lib/design-home';
import { priorityLevels, priorityNames, rankItem } from '@/lib/design-rank';
import { listDisplayLabel, type ListDisplay } from '@/lib/design-list-preview';

export function ListDisplayOptions({value,products,onChange,priorities,onPriorities,visibleCount,onDone}:{
  value:ListDisplay;products:ReviewProduct[];onChange:(value:ListDisplay)=>void;
  priorities:number[];onPriorities:(values:number[])=>void;visibleCount:number;onDone:()=>void;
}) {
  const id=useId();
  const choices:ListDisplay[]=['priority','date_new','planned_date'];
  // 既存の価格順・名前順を選んだ場合も、現在の並び順を正しく示す。
  if(!choices.includes(value)) choices.push(value);
  return <div className="focused-display-options">
    <RadioList label="並び順" value={value} onChange={next=>onChange(next as ListDisplay)} containerClassName="focused-sort-options">
      {choices.map(choice=><RadioListItem key={choice} value={choice} label={listDisplayLabel(choice)}
        endContent={<small>{products.length}商品</small>}/>)}
    </RadioList>
    <fieldset className="focused-priority-options">
      <legend>優先度</legend>
      {priorities.length>0&&<button type="button" className="focused-priority-reset" onClick={()=>onPriorities([])}>解除</button>}
      <div className="focused-priority-grid">
        {priorityLevels.map(level=><div key={level} className="focused-priority-option" data-selected={priorities.includes(level)}>
          <CheckboxInput label={priorityNames[level]} value={priorities.includes(level)} aria-describedby={id+'-'+level}
            onChange={checked=>onPriorities(priorityLevels.filter(entry=>entry===level?checked:priorities.includes(entry)))}/>
          <small id={id+'-'+level}>{products.filter(p=>rankItem(p).priority===level).length}商品</small>
        </div>)}
      </div>
    </fieldset>
    <div className="focused-display-done"><Button variant="primary" label={visibleCount+'商品を表示'} onClick={onDone}/></div>
  </div>;
}
