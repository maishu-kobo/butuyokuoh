'use client';

import { useId, useRef, useState } from 'react';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Camera, Link2, PencilLine } from 'lucide-react';
import type { Category, ComparisonGroup } from '@/types';
import { AgendaPhotoEntry } from './AgendaPhotoEntry';
import AddItemForm from './AddItemForm';
import UrlRegistrationForm from './UrlRegistrationForm';
import { RegistrationActionOutlet } from './RegistrationActions';

const methods = [
  {key:'url',label:'URL',Icon:Link2},
  {key:'photo',label:'写真',Icon:Camera},
  {key:'manual',label:'手入力',Icon:PencilLine},
] as const;
export type RegistrationMethod = typeof methods[number]['key'];
export interface RegistrationProps {
  isGuest:boolean; categories:Category[]; groups:ComparisonGroup[];
  onSaved:(message:string,method:RegistrationMethod) => void;
  onCancel:() => void;
  onExisting:(location:'list'|'purchased'|'trash') => void;
}

export default function RegistrationComposer({isGuest,categories,groups,onSaved,onCancel,onExisting,initialMethod='url',initialUrl='',
  compact=false,onSavingChange}: RegistrationProps & {
  initialMethod?:RegistrationMethod; initialUrl?:string; compact?:boolean; onSavingChange?:(busy:boolean) => void;
}) {
  const [mode,setMode]=useState(initialMethod);
  const [manualUrl,setManualUrl]=useState(initialUrl);
  const [saving,setSaving]=useState(false);
  const [actionContainer,setActionContainer]=useState<HTMLDivElement|null>(null);
  const panels=useRef<HTMLDivElement>(null);
  const id=useId();
  function setBusy(value:boolean) {setSaving(value);onSavingChange?.(value);}
  function switchMode(next:string) {
    if (saving || !methods.some(m=>m.key===next)) return;
    setMode(next as RegistrationMethod);
    if (panels.current) panels.current.scrollTop=0;
  }
  return <div className={'agenda-add registration-composer'+(compact?' registration-compact':'')}>
    <div className="registration-method-bar" inert={saving}>
      <TabList role="tablist" aria-label="登録方法" className="registration-tabs" layout="fill" overflow="visible" value={mode} onChange={switchMode}>
        {methods.map(({key,label,Icon})=><Tab id={id+'-tab-'+key} key={key} value={key} label={label}
          icon={<Icon size={17} aria-hidden/>} panelId={id+'-panel-'+key}/>)}
      </TabList>
    </div>
    <div className="registration-panes" ref={panels} inert={saving}>
      <div role="tabpanel" id={id+'-panel-photo'} aria-labelledby={id+'-tab-photo'} hidden={mode!=='photo'}>
        <RegistrationActionOutlet.Provider value={compact?{container:actionContainer,active:mode==='photo'}:null}>
        <AgendaPhotoEntry isGuest={isGuest} compact={compact} onSaved={msg=>onSaved(msg,'photo')} onSavingChange={setBusy} onExisting={onExisting}/>
        </RegistrationActionOutlet.Provider>
      </div>
      <div role="tabpanel" id={id+'-panel-url'} aria-labelledby={id+'-tab-url'} hidden={mode!=='url'}>
        <RegistrationActionOutlet.Provider value={compact?{container:actionContainer,active:mode==='url'}:null}>
        <UrlRegistrationForm initialUrl={initialUrl} categories={categories} groups={groups} onSaved={msg=>onSaved(msg,'url')} onSavingChange={setBusy}
          onManual={url=>{setManualUrl(url);switchMode('manual');}}/>
        </RegistrationActionOutlet.Provider>
      </div>
      <div role="tabpanel" id={id+'-panel-manual'} aria-labelledby={id+'-tab-manual'} hidden={mode!=='manual'} className="ap-method registration-manual">
        <RegistrationActionOutlet.Provider value={compact?{container:actionContainer,active:mode==='manual'}:null}>
        <AddItemForm standaloneManual initialUrl={manualUrl} compact={compact} comparisonGroups={groups} categories={categories}
          onAdd={msg=>onSaved(msg || '商品を登録しました','manual')} onCancel={onCancel} onSavingChange={setBusy}/>
        </RegistrationActionOutlet.Provider>
      </div>
    </div>
    {compact && <div className="registration-footer" aria-label="登録操作" ref={setActionContainer}/>}
  </div>;
}
