import type { ReviewProduct } from './design-home';
import { priorityLevels, rankedProducts, rankItem } from './design-rank';
import type { HomeSortBy } from './home-wishlist';

export type ListPreview = 'current' | 'focused';
export type ListDisplay = HomeSortBy;
export function readListPreview(value?:string|null):ListPreview|undefined {
  return value==='current' || value==='focused' ? value : undefined;
}
export function listDisplayLabel(display:ListDisplay):string {
  const labels:Record<ListDisplay,string>={priority:'優先度順',date_new:'登録順',planned_date:'購入日順',
    price_asc:'価格が安い順',price_desc:'価格が高い順',date_old:'登録が古い順',name:'名前順'};
  return labels[display];
}
export interface FocusedListSection {
  level:number;
  entries:ReviewProduct[];
  rows:{product:ReviewProduct;rank:number}[];
}
export function focusedListSections(ordered:ReviewProduct[],visible:ReviewProduct[],display:ListDisplay):FocusedListSection[] {
  const matches=new Set(visible.map(p=>p.key));
  const ranks=new Map(rankedProducts(ordered).map((p,index)=>[p.key,index+1]));
  const levels=display==='priority' ? priorityLevels : [0];
  return levels.map(level=>{
    const entries=level ? ordered.filter(p=>rankItem(p).priority===level) : ordered;
    return {level,entries,
      rows:entries.filter(p=>matches.has(p.key)).map(product=>({product,rank:ranks.get(product.key)!}))};
  }).filter(section=>section.rows.length>0);
}
