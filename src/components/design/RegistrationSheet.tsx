'use client';

import { useState } from 'react';
import RegistrationComposer, { type RegistrationProps } from '../RegistrationComposer';
import ReviewSheet from './ReviewSheet';

export default function RegistrationSheet(props:RegistrationProps) {
  const [saving,setSaving]=useState(false);
  return <ReviewSheet title="ほしいものを登録" onClose={props.onCancel} lockDismiss={saving} fitVisualViewport className="registration-sheet">
    <RegistrationComposer {...props} compact onSavingChange={setSaving}/>
  </ReviewSheet>;
}
