'use client';

import { CaptureMessages } from '@/lib/capture/contract';
import { capturePhotoActions, photoForUpload } from '@/lib/capture/photo-pick';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export type CapturePhotoPick = {
  enabled: boolean;
  message: string;
  selected: boolean;
  acceptFiles: (files: File[]) => void;
  clear: () => void;
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
  useLayoutEffect(() => {
    if (!enabled) requestRef.current += 1;
  }, [enabled]);
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
    clear() {
      requestRef.current += 1;
      setSelected(false);
      setMessage('');
    },
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

const MENU_ITEM_CLASS = 'flex min-h-[24px] w-full items-center px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-slate-700';

function useCoarsePointer(): boolean | null {
  const [coarse, setCoarse] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    let alive = true;
    function onChange() {
      if (!alive) return;
      setCoarse(media.matches);
    }
    // 最初の描画はサーバと同じくメニュー属性を出さない。ポインタの判定はマウントのあと。
    queueMicrotask(onChange);
    media.addEventListener('change', onChange);
    return () => {
      alive = false;
      media.removeEventListener('change', onChange);
    };
  }, []);
  return coarse;
}

export function CapturePhotoControls({ pick }: { pick: CapturePhotoPick }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const coarse = useCoarsePointer();
  const menu = coarse === false;
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);
  if (!pick.enabled && open) setOpen(false);
  if (!pick.enabled) return null;

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    pick.acceptFiles(files);
  }

  function chooseFile() {
    setOpen(false);
    inputRef.current?.click();
  }

  function chooseCamera() {
    setOpen(false);
    cameraRef.current?.click();
  }

  function onRegister() {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const available = window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
    const actions = capturePhotoActions({ coarsePointer: coarse, camera: available });
    if (actions === 'sheet') {
      setOpen(false);
      inputRef.current?.click();
      return;
    }
    setCamera(actions.includes('camera'));
    setOpen(value => !value);
  }

  return (
    <div className="relative mb-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,image/heic,image/heif,.heic,.heif"
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
      <button
        ref={buttonRef}
        type="button"
        data-pointer={coarse === null ? 'pending' : coarse ? 'coarse' : 'fine'}
        aria-haspopup={menu ? 'menu' : undefined}
        aria-expanded={menu ? open : undefined}
        aria-controls={menu ? menuId : undefined}
        onClick={onRegister}
        className="min-h-[24px] min-w-[24px] w-full px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm text-gray-700 dark:text-gray-200"
      >
        写真から登録
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="写真の取り込み"
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-gray-300 bg-white py-1 shadow-md dark:border-slate-600 dark:bg-slate-800"
        >
          {camera && (
            <button type="button" role="menuitem" onClick={chooseCamera} className={MENU_ITEM_CLASS}>
              カメラで撮る
            </button>
          )}
          <button type="button" role="menuitem" onClick={chooseFile} className={MENU_ITEM_CLASS}>
            ファイル/写真を選ぶ
          </button>
        </div>
      )}
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

function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next = index < 0 ? 0 : (index + delta + items.length) % items.length;
    items[next]?.focus();
  } else if (event.key === 'Home') {
    event.preventDefault();
    items[0]?.focus();
  } else if (event.key === 'End') {
    event.preventDefault();
    items[items.length - 1]?.focus();
  }
}
