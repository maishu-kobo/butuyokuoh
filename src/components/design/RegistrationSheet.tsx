'use client';

import { useState, type ReactNode } from 'react';
import RegistrationComposer, { type RegistrationProps } from '../RegistrationComposer';
import ReviewSheet from './ReviewSheet';

export default function RegistrationSheet({presentation,toolbar,onSavingChange,...props}:RegistrationProps & {presentation?:'modal'|'aside';toolbar?:ReactNode;onSavingChange?:(busy:boolean)=>void}) {
  const [saving,setSaving]=useState(false);
  return <ReviewSheet title="ほしいものを登録" onClose={props.onCancel} lockDismiss={saving} fitVisualViewport className="registration-sheet" presentation={presentation} toolbar={toolbar}>
    <RegistrationComposer {...props} compact onSavingChange={busy=>{setSaving(busy);onSavingChange?.(busy);}}/>
  </ReviewSheet>;
}
