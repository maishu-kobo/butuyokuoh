'use client';

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core/Button';
import { BarChart3, Check, ChevronRight, Ellipsis, ListChecks, LogOut, Plus, Search, Settings, ShoppingBag, SlidersHorizontal, Trash2, Wallet, X } from 'lucide-react';
import type { Category, ComparisonGroup, Item } from '@/types';
import { buildReviewProducts, managedProducts, reviewHref, reviewSettingsHref, type ReviewTab, type ReviewView } from '@/lib/design-home';
import type { HomeSortBy } from '@/lib/home-wishlist';
import type { LightPalette, PreviewAppearance } from '@/lib/design-palettes';
import PurchaseTimingEditor from './PurchaseTimingEditor';
import SiteFooter from '../SiteFooter';
import ProductDetails from './ProductDetails';
import BudgetView from '../ScheduleBudgetView';
import ReviewSheet from './ReviewSheet';
import RankedList, { GuideEditor } from './RankedList';
import RegistrationSheet from './RegistrationSheet';
import UiVersionSwitch from './UiVersionSwitch';
import { ListDisplayOptions } from './ListPreviewControls';
import DesktopLayoutToggle from './DesktopPreviewControls';
import { useDesktopWorkspace, useDesktopPageActions } from './DesktopWorkspace';
import './focused-list.css';

interface Props {
  budgetRevision:number; view:ReviewView; palette:LightPalette|null; appearance:PreviewAppearance; items:Item[]; purchased:Item[]; groups:ComparisonGroup[]; categories:Category[];
  loading:boolean; loadError:boolean; isGuest:boolean;
  onRetry:() => void; onReload:() => Promise<void>; onDelete:(id:number) => Promise<void>; onLogout:() => Promise<void>;
  management: { search:string; onSearch:(value:string)=>void; matching:Item[]; priorityOptionsItems:Item[];
    sortBy:HomeSortBy; onSortBy:(value:HomeSortBy)=>void; priorities:number[]; onPriorities:(values:number[])=>void;
    filterOpen:boolean; onToggleFilter:()=>void;
    selection?:{ids:Set<number>;toggle:(ids:number[])=>void}; render:(list:ReactNode,visibleIds:number[],active:boolean)=>ReactNode; };
}
const menu: {tab:ReviewTab;label:string;Icon:typeof ListChecks}[] = [
  {tab:'purchased',label:'購入履歴',Icon:ShoppingBag},{tab:'stats',label:'統計',Icon:BarChart3},
  {tab:'trash',label:'ゴミ箱',Icon:Trash2},
];
type Panel = {kind:'menu'|'add'|'display'} | {kind:'product'|'guide';key:string};

export default function DesignWorkbench({budgetRevision,view,palette,appearance,items,purchased,groups,categories,loading,loadError,isGuest,onRetry,onReload,onDelete,onLogout,management}:Props) {
  const router=useRouter();
  const frame=useRef<HTMLDivElement>(null);
  const searchField=useRef<HTMLInputElement>(null);
  const invoker=useRef<HTMLElement|null>(null);
  const dateInvoker=useRef<HTMLElement|null>(null);
  const [panel,setPanel]=useState<Panel|null>(null);
  const [dateItem,setDateItem]=useState<Item|null>(null);
  const {search,onSearch:setSearch}=management;
  const [searchOpen,setSearchOpen]=useState(false);
  const [notice,setNotice]=useState('');
  const listDisplay=management.sortBy;
  const [panelBusy,setPanelBusy]=useState(false);
  const desktop=useDesktopWorkspace();
  const comparison=desktop.preview?<DesktopLayoutToggle value={desktop.layout} onChange={desktop.choose}/>:undefined;
  const isBudget=view==='plan';
  const integrated=desktop.active&&desktop.layout==='reading'&&!isBudget;
  useLayoutEffect(() => {
    const banner = document.querySelector<HTMLElement>('[data-app-banner]');
    const main = frame.current?.closest('main');
    if (!banner || !main) return;
    const fit = () => main.style.setProperty('--home-banner-height', banner.getBoundingClientRect().height + 'px');
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(banner);
    return () => observer.disconnect();
  }, []);
  const designHref=(view:Props['view'],tab?:ReviewTab)=>reviewHref(view,tab,palette,appearance);
  async function reload() { await onReload(); }
  const products=useMemo(()=>buildReviewProducts(items,groups,purchased),[items,groups,purchased]);
  const term=search.trim().toLocaleLowerCase('ja-JP');
  const visible=useMemo(()=>!isBudget ? managedProducts(products,management.matching,listDisplay) : !term?products:products.filter(p=>
    [p.name,p.active.category_name,p.active.notes,p.active.buy_guide?.condition,...p.offers.map(i=>i.source_name)]
      .some(value=>value?.toLocaleLowerCase('ja-JP').includes(term))),[products,term,isBudget,management.matching,listDisplay]);
  const ordered=useMemo(()=>managedProducts(products,items,listDisplay),[products,items,listDisplay]);
  const priorityOptions=useMemo(()=>managedProducts(products,management.priorityOptionsItems,'priority'),[products,management.priorityOptionsItems]);
  const selected=panel && 'key' in panel ? products.find(p=>p.key===panel.key) : undefined;
  const priorityFilter=!isBudget&&management.priorities.length>0;
  const visibleCount=visible.length;
  const matchingIds=new Set(management.matching.map(item=>item.id));
  const selectableIds=visible
    .flatMap(product=>product.offers.filter(item=>matchingIds.has(item.id)).map(item=>item.id));
  function openPanel(next:Panel) {
    if (panelBusy) return;
    const trigger=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!panel || !trigger?.closest('.review-sheet')) invoker.current=trigger;
    setNotice('');setPanel(next);
  }
  useDesktopPageActions(()=>openPanel({kind:'add'}), panelBusy);
  function restoreFocus(target:HTMLElement|null) {
    requestAnimationFrame(()=>(target?.isConnected&&target.getClientRects().length ? target : frame.current)?.focus({preventScroll:true}));
  }
  function closePanel() {setPanel(null);setPanelBusy(false);restoreFocus(invoker.current);}
  function closeDate() {setDateItem(null);restoreFocus(dateInvoker.current);}
  function openDate(item:Item,trigger:HTMLButtonElement) {dateInvoker.current=trigger;setDateItem(item);}
  function openSearch() {
    if (searchOpen) {setSearch('');setSearchOpen(false);}
    else {flushSync(()=>setSearchOpen(true));searchField.current?.focus();}
  }
  const empty=loading ? <p className="review-empty" role="status">読み込み中…</p> : loadError ?
    <div className="review-empty" role="alert">リストを読み込めませんでした。<Button label="再読み込み" onClick={onRetry}/></div> :
    !visible.length ? <div className="review-empty">{products.length?'条件に合う商品がありません。':'登録した商品がここに並びます。'}
      {priorityFilter && <button type="button" onClick={()=>management.onPriorities([])}>優先度の絞り込みを解除</button>}
      {term && <button type="button" onClick={()=>setSearch('')}>検索をクリア</button>}</div> : null;
  const ranked=loading||loadError||!products.length ? empty : <RankedList products={products} visible={visible} onReload={reload}
    focused display={listDisplay} priorities={management.priorities} openDisplay={()=>openPanel({kind:'display'})} onSort={management.onSortBy} empty={empty}
    orderedProducts={ordered}
    selection={integrated&&management.selection?{...management.selection,matchingIds}:undefined}
    openProduct={p=>openPanel({kind:'product',key:p.key})} openGuide={p=>openPanel({kind:'guide',key:p.key})}/>;
  return <main className="design-review combined-home" data-screen={isBudget?'budget':'list'} data-desktop-layout={desktop.active?'workspace':'current'}
    data-list-layout={desktop.active&&desktop.layout==='reading'?'reading':undefined}>
    <div className="review-frame" ref={frame} tabIndex={-1} data-panel-open={!!panel}>
      <div className="review-app-surface" inert={(panel!==null&&!desktop.active)||panelBusy}>
        <header className="review-app-bar"><div className="review-brand">
          <Image unoptimized alt="" src="/icons/icon-192.png" width={25} height={25}/><span>物欲王</span></div>
          <div className="review-app-actions">{!panel&&comparison}<UiVersionSwitch enabled /><button type="button" className="review-icon" aria-label="商品を検索" aria-expanded={searchOpen} onClick={openSearch}>
            {searchOpen?<X size={18}/>:<Search size={18}/>}</button>
            <button type="button" className="review-icon" aria-label="メニュー" onClick={()=>openPanel({kind:'menu'})}><Ellipsis size={21}/></button></div>
        </header>
        <header className="review-home-heading"><h1>{isBudget?'出費予定':'ほしいものリスト'}</h1><span>{loading?'':visibleCount+(priorityFilter?' / '+products.length:'')+'商品'}</span></header>
        {(searchOpen||desktop.active) && <div className="review-search"><label><Search aria-hidden size={16}/>
          <input aria-label="商品名・メモ・お店で検索" type="search" ref={searchField} placeholder="商品名・メモ・お店" value={search} onChange={e=>setSearch(e.target.value)}/></label>
          {desktop.active&&desktop.layout==='reading' ? <button type="button" aria-label="絞り込み・並べ替え" aria-expanded={integrated?management.filterOpen:undefined}
            onClick={()=>{if(integrated)management.onToggleFilter();else{if(!management.filterOpen)management.onToggleFilter();router.push(designHref('rank'));}}}><SlidersHorizontal size={18}/></button>
            : <Link href={designHref(view,'manage')} aria-label="絞り込み・並べ替え"><SlidersHorizontal size={18}/></Link>}</div>}
        {notice && <div className="review-notice" role="status"><Check size={14}/>{notice}</div>}
        <section aria-label="買う候補" className="review-scroll" tabIndex={0} hidden={isBudget}>
          <div className="agenda-home integrated-list-surface" data-integrated={integrated}>{management.render(ranked,selectableIds,integrated)}</div>
        </section>
        <section aria-label="出費予定" className="review-scroll" tabIndex={0} hidden={!isBudget}>
          <BudgetView presentation="schedule" query={search} revision={budgetRevision} categories={categories} onChanged={reload}
            onProduct={item=>{const product=products.find(p=>p.offers.some(offer=>offer.id===item.id));if(product)openPanel({kind:'product',key:product.key});}}/>
        </section>
        <nav className="review-dock" aria-label="主な操作">
          <Link href={designHref('rank')} aria-current={!isBudget?'page':undefined}>
            <ListChecks size={19}/><span>リスト</span></Link>
          <Button type="button" variant="primary" className="review-main-action" icon={<Plus size={19}/>} label="登録" onClick={()=>openPanel({kind:'add'})}/>
          <Link href={designHref('rank','budget')} aria-current={isBudget?'page':undefined}><Wallet size={19}/><span>出費予定</span></Link>
        </nav>
      </div>
      {panel?.kind==='add' && <RegistrationSheet groups={groups} categories={categories} isGuest={isGuest} onCancel={closePanel}
        presentation={desktop.active?'aside':'modal'} toolbar={comparison} onSavingChange={setPanelBusy}
        onSaved={message=>{closePanel();setNotice(message);void reload();}}
        onExisting={location=>{closePanel();if(location==='list'){setSearch('');void reload();router.push(designHref('rank'));}else router.push(designHref(view,location));}}/>}
      {panel && panel.kind!=='add' && <ReviewSheet key={panel.kind} title={panel.kind==='menu'?'メニュー':panel.kind==='display'?'リストの表示':panel.kind==='guide'?'優先度と購入時期':'商品と販売候補'} onClose={closePanel}
        presentation={desktop.active?'aside':'modal'} toolbar={comparison} lockDismiss={panelBusy}>
        {panel.kind==='display'&&<ListDisplayOptions value={listDisplay} products={priorityOptions} onChange={management.onSortBy}
          priorities={management.priorities} onPriorities={management.onPriorities} visibleCount={visibleCount} onDone={closePanel}/>}
        {panel.kind==='product' && (selected?<ProductDetails key={selected.key} product={selected} groups={groups} categories={categories} onReload={reload} onDelete={onDelete} onDate={openDate}/>:<p>この商品はリストから移動しました。</p>)}
        {panel.kind==='guide' && (selected?<GuideEditor key={selected.key} product={selected} products={products} onSavingChange={setPanelBusy} onSaved={async()=>{await reload();closePanel();setNotice('優先度・購入時期を保存しました');}}/>:<p>この商品はリストから移動しました。</p>)}
        {panel.kind==='menu' && <><div className="review-menu-list">
          {menu.map(({tab,label,Icon})=><Link href={designHref(view,tab)} key={tab} onClick={closePanel}><Icon size={19}/><span>{label}</span><ChevronRight size={15}/></Link>)}
          <Link href={reviewSettingsHref(view,palette,appearance)}><Settings size={19}/><span>設定</span><ChevronRight size={15}/></Link>
          <button type="button" onClick={async()=>{await onLogout();router.push('/');}}><LogOut size={19}/><span>ログアウト</span></button>
        </div><SiteFooter/></>}
      </ReviewSheet>}
      {dateItem && <PurchaseTimingEditor key={dateItem.id} item={dateItem} onClose={closeDate} onSaved={async()=>{await reload();closeDate();setNotice('購入時期を保存しました');}}/>}
    </div>
  </main>;
}
