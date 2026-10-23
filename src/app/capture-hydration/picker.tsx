'use client';

import { CapturePhotoControls, type CapturePhotoPick } from '@/components/CapturePhotoPicker';

const pick: CapturePhotoPick = {
  enabled: true,
  message: '',
  selected: false,
  acceptFiles() {},
  onDragOver() {},
  onDrop() {},
};

export function CaptureHydrationPicker() {
  return <CapturePhotoControls pick={pick} />;
}
