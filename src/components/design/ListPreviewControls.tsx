'use client';

import { Check, ListFilter, ListOrdered, Rows3 } from 'lucide-react';
import type { ReviewProduct } from '@/lib/design-home';
import { priorityLevels, priorityNames, rankItem } from '@/lib/design-rank';
import type { ListDisplay } from '@/lib/design-list-preview';

export function ListDisplayOptions({value,products,onChange}:{value:ListDisplay;products:ReviewProduct[];onChange:(value:ListDisplay)=>void}) {
  const choices:{value:ListDisplay;label:string;count:number;Icon:typeof ListFilter;hint?:string}[]=[
    {value:'all',label:'すべて',count:products.length,Icon:ListOrdered,hint:'自分で決めた全体順位で表示'},
    {value:'grouped',label:'優先度でまとめる',count:products.length,Icon:Rows3,hint:'すべての優先度を見出しで区切る'},
    ...priorityLevels.map(level=>({value:('priority-'+level) as ListDisplay,label:'優先度 '+priorityNames[level]+'のみ',count:products.filter(p=>rankItem(p).priority===level).length,Icon:ListFilter})),
  ];
  return <div className="focused-display-options" role="group" aria-label="表示する候補">
    {choices.map(choice=><button type="button" key={choice.value} aria-pressed={value===choice.value} onClick={()=>onChange(choice.value)}>
      <choice.Icon size={19} aria-hidden/><span><strong>{choice.label}</strong>{choice.hint&&<small>{choice.hint}</small>}</span>
      <small>{choice.count}商品</small><span className="focused-choice-check">{value===choice.value&&<Check size={18}/>}</span>
    </button>)}
  </div>;
}
