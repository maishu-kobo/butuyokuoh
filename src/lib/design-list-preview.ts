import type { ReviewProduct } from './design-home';
import { priorityLevels, rankItem } from './design-rank';
import { isPrioritySort, type HomeSortBy } from './home-wishlist';

export type ListPreview = 'current' | 'focused';
export type ListDisplay = HomeSortBy;
export function readListPreview(value?:string|null):ListPreview|undefined {
  return value==='current' || value==='focused' ? value : undefined;
}
export function listDisplayLabel(display:ListDisplay):string {
  const labels:Record<ListDisplay,string>={priority:'優先度順',priority_desc:'優先度順',date_new:'登録順',date_old:'登録順',
    planned_date:'購入時期順',planned_date_desc:'購入時期順',price_asc:'価格順',price_desc:'価格順',name:'名前順',name_desc:'名前順'};
  return labels[display];
}
export function reverseListSort(display:ListDisplay):ListDisplay {
  const opposite:Record<ListDisplay,ListDisplay>={priority:'priority_desc',priority_desc:'priority',date_new:'date_old',date_old:'date_new',
    planned_date:'planned_date_desc',planned_date_desc:'planned_date',price_asc:'price_desc',price_desc:'price_asc',name:'name_desc',name_desc:'name'};
  return opposite[display];
}
export function listSortDirection(display:ListDisplay):{ascending:boolean;label:string} {
  const directions:Record<ListDisplay,{ascending:boolean;label:string}>={
    priority:{ascending:false,label:'優先度が高い順'},priority_desc:{ascending:true,label:'優先度が低い順'},
    date_new:{ascending:false,label:'登録が新しい順'},date_old:{ascending:true,label:'登録が古い順'},
    planned_date:{ascending:true,label:'購入時期が近い順'},planned_date_desc:{ascending:false,label:'購入時期が遠い順'},
    price_asc:{ascending:true,label:'価格が安い順'},price_desc:{ascending:false,label:'価格が高い順'},
    name:{ascending:true,label:'名前の昇順'},name_desc:{ascending:false,label:'名前の降順'},
  };
  return directions[display];
}
export interface FocusedListSection {
  level:number;
  entries:ReviewProduct[];
  rows:{product:ReviewProduct;rank:number|null}[];
}
export function focusedListSections(ordered:ReviewProduct[],visible:ReviewProduct[],display:ListDisplay):FocusedListSection[] {
  const matches=new Set(visible.map(p=>p.key));
  const levels=isPrioritySort(display) ? (display==='priority' ? priorityLevels : [...priorityLevels].reverse()) : [0];
  return levels.map(level=>{
    const entries=level ? ordered.filter(p=>rankItem(p).priority===level) : ordered;
    return {level,entries,
      rows:entries.filter(p=>matches.has(p.key)).map((product,index)=>({product,rank:level?index+1:null}))};
  }).filter(section=>section.rows.length>0);
}
