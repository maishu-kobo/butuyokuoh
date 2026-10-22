'use client';

import { CaptureMessages } from '@/lib/capture/contract';
import { photoForUpload } from '@/lib/capture/photo-pick';
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

export type CapturePhotoPick = {
  enabled: boolean;
  message: string;
  selected: boolean;
  acceptFiles: (files: File[]) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
};

export function useCapturePhotoPick(
  enabled: boolean,
  onAccepted?: (file: File) => void,
  upload: typeof photoForUpload = photoForUpload,
): CapturePhotoPick {
  const onAcceptedRef = useRef(onAccepted);
  const requestRef = useRef(0);
  useEffect(() => {
    onAcceptedRef.current = onAccepted;
  });
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState(false);
  const [shown, setShown] = useState(enabled);
  if (enabled !== shown) {
    setShown(enabled);
    if (!enabled) {
      setMessage('');
      setSelected(false);
    }
  }

  function acceptFiles(files: File[]) {
    if (!enabled) return;
    const request = requestRef.current + 1;
    requestRef.current = request;
    void upload(files).then(result => {
      if (requestRef.current !== request) return;
      if (!result.ok) {
        if (result.ignored) return;
        setSelected(false);
        setMessage(result.message);
        return;
      }
      setMessage('');
      setSelected(true);
      onAcceptedRef.current?.(result.file);
    }).catch(() => {
      if (requestRef.current !== request) return;
      setSelected(false);
      setMessage(CaptureMessages.photoUnreadable);
    });
  }

  return {
    enabled,
    message,
    selected,
    acceptFiles,
    onDragOver(event) {
      if (!enabled) return;
      event.preventDefault();
    },
    onDrop(event) {
      if (!enabled) return;
      event.preventDefault();
      acceptFiles([...event.dataTransfer.files]);
    },
  };
}

export function CapturePhotoControls({ pick }: { pick: CapturePhotoPick }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  if (!pick.enabled) return null;

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    pick.acceptFiles(files);
  }

  return (
    <div className="mb-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="写真ファイル"
        className="hidden"
        onChange={onChange}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        aria-label="写真を撮る"
        className="hidden"
        onChange={onChange}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="min-h-[24px] min-w-[24px] flex-1 px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm text-gray-700 dark:text-gray-200"
        >
          撮る
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="min-h-[24px] min-w-[24px] flex-1 px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm text-gray-700 dark:text-gray-200"
        >
          写真を選ぶ
        </button>
      </div>
      <div aria-live="polite">
        {pick.message && (
          <p role="alert" className="mt-2 rounded-md bg-red-50 dark:bg-red-950/40 p-3 text-red-700 dark:text-red-300 text-sm">
            {pick.message}
          </p>
        )}
        {pick.selected && !pick.message && (
          <p role="status" className="mt-2 text-sm text-gray-600 dark:text-gray-300">1枚の写真を選びました</p>
        )}
      </div>
    </div>
  );
}
