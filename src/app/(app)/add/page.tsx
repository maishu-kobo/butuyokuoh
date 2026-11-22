'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { readReviewView, reviewHref } from '@/lib/design-home';
import type { Category, ComparisonGroup } from '@/types';
import { useAuth } from '@/components/AuthProvider';
import RegistrationComposer, {type RegistrationMethod} from '@/components/RegistrationComposer';
import { useTheme } from '@/components/ThemeProvider';
import LegacyAddPage from './LegacyAddPage';

function AddPageContent() {
  const params=useSearchParams();
  const router=useRouter();
  const {user,isGuest,loading}=useAuth();
  const origin=params.get('from');
  const review=true;
  const view=readReviewView(origin);
  const back=review ? reviewHref(view) : '/';
  const other=(tab:'budget'|'trash'|'purchased')=>review ? reviewHref(view,tab) : '/?tab='+tab;
  const url=params.get('url') || params.get('text')?.match(/https?:\/\/[^\s]+/)?.[0] || '';
  const supplied=params.has('url') || params.has('text');
  const requestedMode = params.get('mode');
  const mode:RegistrationMethod = !supplied && (requestedMode === 'photo' || requestedMode === 'manual') ? requestedMode : 'url';
  const [categories,setCategories]=useState<Category[]>([]);
  const [groups,setGroups]=useState<ComparisonGroup[]>([]);
  const [message,setMessage]=useState('');
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{
    if(!user) return;
    let active=true;
    void apiFetch('/api/comparison-groups').then(r=>r.ok?r.json():[]).then(data=>{if(active && Array.isArray(data))setGroups(data);}).catch(()=>{});
    void apiFetch('/api/categories').then(r=>r.ok?r.json():[]).then(data=>{if(active && Array.isArray(data))setCategories(data);}).catch(()=>{});
    return ()=>{active=false;};
  },[user]);
  if(loading) return <main className="agenda-add"><p role="status">読み込み中…</p></main>;
  if(!user) return <main className="agenda-add"><section className="ap-success"><h1>ログインしてください</h1>
    <p>ほしいものを登録するには、会員またはゲストで入ってください。</p><div className="ap-success-nav"><Link href={back}>ログイン画面へ</Link></div></section></main>;
  if(message) return <main className="agenda-add"><div className="ap-success" role="status"><Check size={35}/><h1>{message}</h1>
    <p>ほしいものリストに保存しました。</p><div className="ap-success-nav"><Link href={back}>ほしいものリストを見る</Link><Link href={other('budget')}>出費計画を見る</Link></div></div></main>;
  return <main className="agenda-add">
    <nav className="ap-back" aria-label="一覧へ"><Link href={back}><ArrowLeft size={16}/> ほしいものリスト</Link></nav>
    <header className="ap-heading"><h1>ほしいものを追加</h1></header>
    <RegistrationComposer key={mode+'-'+url} initialMethod={mode} initialUrl={url} isGuest={isGuest} categories={categories} groups={groups}
      onCancel={()=>router.push(back)} onExisting={place=>router.push(place==='list'?back:other(place))}
      onSaved={(msg,method)=>{setMessage(msg);if(supplied && method==='url') timer.current=setTimeout(()=>router.push(back),2000);}}/>
  </main>;
}

export default function AddPage() {
  const { isNewUi } = useTheme();
  if (!isNewUi) return <LegacyAddPage />;
  return <Suspense fallback={<main className="agenda-add"><p role="status">読み込み中…</p></main>}><AddPageContent/></Suspense>;
}
