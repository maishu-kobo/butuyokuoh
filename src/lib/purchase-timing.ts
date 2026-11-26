export type PurchaseTiming = {kind:'undated'} | {kind:'month';month:string;timing:'by'|'around'} | {kind:'date';date:string};
type TimingItem = {planned_purchase_date?:string|null;buy_guide?:{month:string;timing:'by'|'around'}};

function validMonth(value:unknown):value is string {
  return typeof value==='string' && /^[1-9]\d{3}-(0[1-9]|1[012])$/.test(value);
}
export function validPurchaseDate(value:unknown):value is string {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}
export function parsePurchaseTiming(value:unknown):PurchaseTiming|null {
  if(!value || typeof value!=='object' || Array.isArray(value)) return null;
  const input=value as Record<string,unknown>;
  if(input.kind==='undated') return {kind:'undated'};
  if(input.kind==='date' && validPurchaseDate(input.date)) return {kind:'date',date:input.date};
  if(input.kind==='month' && validMonth(input.month) && (input.timing==='by'||input.timing==='around')) return {kind:'month',month:input.month,timing:input.timing};
  return null;
}
// Existing flat request validation remains in force; no nested input exception is needed.
export function purchaseTimingInput(value:PurchaseTiming) {
  return {purchaseMode:value.kind,...(value.kind==='date'?{purchaseDate:value.date}:value.kind==='month'?{purchaseMonth:value.month,purchaseRelation:value.timing}:{})};
}
export function parsePurchaseTimingInput(input:Record<string,unknown>):PurchaseTiming|null {
  return parsePurchaseTiming({kind:input.purchaseMode,date:input.purchaseDate,month:input.purchaseMonth,timing:input.purchaseRelation});
}
export function purchaseTiming(item:TimingItem):PurchaseTiming {
  if(validPurchaseDate(item.planned_purchase_date)) return {kind:'date',date:item.planned_purchase_date};
  if(item.buy_guide && validMonth(item.buy_guide.month)) return {kind:'month',month:item.buy_guide.month,timing:item.buy_guide.timing};
  return {kind:'undated'};
}
export function purchaseTimingMonth(item:TimingItem):string {
  const value=purchaseTiming(item);
  return value.kind==='date'?value.date.slice(0,7):value.kind==='month'?value.month:'';
}
export function purchaseTimingLabel(value:PurchaseTiming,currentYear=new Date().getFullYear()):string {
  if(value.kind==='undated') return '時期未定';
  const [year,month,day]=(value.kind==='date'?value.date:value.month).split('-').map(Number);
  return (year===currentYear?'':year+'年')+month+'月'+(value.kind==='date'?day+'日':value.timing==='by'?'まで':'ごろ');
}
export function comparePurchaseTiming(a:TimingItem,b:TimingItem,direction:1|-1=1):number {
  const key=(item:TimingItem)=>{const value=purchaseTiming(item);return value.kind==='date'?value.date:value.kind==='month'?value.month+'-99':'';};
  const av=key(a),bv=key(b);
  if(!av||!bv) return av?-1:bv?1:0;
  return av.localeCompare(bv)*direction;
}
