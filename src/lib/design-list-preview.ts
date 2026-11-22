import type { ReviewProduct } from './design-home';
import { priorityLevels, priorityNames, rankItem } from './design-rank';

export type ListPreview = 'current' | 'focused';
export type ListDisplay = 'all' | 'grouped' | `priority-${1|2|3|4|5}`;
export function readListPreview(value?:string|null):ListPreview|undefined {
  return value==='current' || value==='focused' ? value : undefined;
}
export function listDisplayLabel(display:ListDisplay):string {
  return display==='all' ? 'すべて' : display==='grouped' ? '優先度でまとめる' : '優先度 '+priorityNames[Number(display.slice(-1))]+'のみ';
}
export interface FocusedListSection {
  level:number;
  entries:ReviewProduct[];
  rows:{product:ReviewProduct;rank:number}[];
}
export function focusedListSections(ordered:ReviewProduct[],visible:ReviewProduct[],display:ListDisplay):FocusedListSection[] {
  const matches=new Set(visible.map(p=>p.key));
  const ranks=new Map(ordered.map((p,index)=>[p.key,index+1]));
  const levels=display==='grouped' ? priorityLevels : [display==='all' ? 0 : Number(display.slice(-1))];
  return levels.map(level=>{
    const entries=level ? ordered.filter(p=>rankItem(p).priority===level) : ordered;
    return {level:display==='grouped' ? level : 0,entries,
      rows:entries.filter(p=>matches.has(p.key)).map(product=>({product,rank:ranks.get(product.key)!}))};
  }).filter(section=>section.rows.length>0);
}
