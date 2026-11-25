'use client';

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function ReviewSheet({title,onClose,children,lockDismiss=false,fitVisualViewport=false,className='',presentation='modal',toolbar}: {
  title:string;onClose:() => void;children:ReactNode;lockDismiss?:boolean;fitVisualViewport?:boolean;className?:string;
  presentation?:'modal'|'aside';toolbar?:ReactNode;
}) {
  const ref=useRef<HTMLElement>(null);
  const layerRef=useRef<HTMLDivElement>(null);
  const heading=useId();
  useEffect(()=>{ref.current?.focus({preventScroll:true});},[]);
  useEffect(()=>{
    if (presentation==='modal' && !ref.current?.contains(document.activeElement)) ref.current?.focus({preventScroll:true});
  },[presentation]);
  useEffect(()=>{
    // Disabling a focused submit button can move focus to the document body.
    // Restore the dialog after a failed save so Escape and Tab keep working.
    if (!lockDismiss && document.activeElement===document.body) ref.current?.focus({preventScroll:true});
  },[lockDismiss]);
  useLayoutEffect(() => {
    if (!fitVisualViewport || presentation==='aside') return;
    const viewport = window.visualViewport;
    const layer = layerRef.current;
    const frame = layer?.offsetParent;
    if (!viewport || !layer || !(frame instanceof HTMLElement)) return;

    // An onscreen keyboard can cover the layout viewport while the outer frame keeps its height.
    const fit = () => {
      const frameTop = frame.getBoundingClientRect().top + frame.clientTop;
      const frameBottom = frameTop + frame.clientHeight;
      const unzoomed = Math.abs(viewport.scale - 1) < 0.01;
      const top = unzoomed ? Math.max(0, viewport.offsetTop - frameTop) : 0;
      const bottom = unzoomed ? Math.max(0, frameBottom - viewport.offsetTop - viewport.height) : 0;
      layer.style.top = top + 'px';
      layer.style.bottom = bottom + 'px';
      layer.toggleAttribute('data-viewport-clipped', top > 0 || bottom > 0);
    };
    fit();
    viewport.addEventListener('resize', fit);
    viewport.addEventListener('scroll', fit);
    const resize = new ResizeObserver(fit);
    resize.observe(frame);
    return () => {
      resize.disconnect();
      viewport.removeEventListener('resize', fit);
      viewport.removeEventListener('scroll', fit);
      layer.style.removeProperty('top');
      layer.style.removeProperty('bottom');
      layer.removeAttribute('data-viewport-clipped');
    };
  }, [fitVisualViewport,presentation]);
  return <div className="review-sheet-layer" data-presentation={presentation} ref={layerRef}>
    {presentation==='modal' && <button type="button" className="review-scrim" aria-label="パネルを閉じる" disabled={lockDismiss} tabIndex={-1} onClick={onClose}/>}
    <section className={'review-sheet '+className} ref={ref} role="dialog" aria-modal={presentation==='modal'?true:undefined} aria-labelledby={heading} tabIndex={-1}
      onKeyDown={event=>{
        if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest('[role=dialog]')!==ref.current) return;
        if (event.key==='Escape') {event.preventDefault();if(!lockDismiss) onClose();return;}
        if (event.key!=='Tab' || presentation==='aside') return;
        const stops=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,input,textarea,select,summary,a[href],[tabindex]'))
          .filter(el=>el.tabIndex>=0 && !el.matches(':disabled,[aria-disabled=true]') && !el.closest('[inert]') && el.getClientRects().length);
        const first=stops[0],last=stops[stops.length-1];
        if (!first) {event.preventDefault();return;}
        if (event.shiftKey && (event.target===first || event.target===ref.current)) {event.preventDefault();last.focus();}
        else if (!event.shiftKey && event.target===last) {event.preventDefault();first.focus();}
      }}>
      <header><h3 id={heading}>{title}</h3>
        <button type="button" className="review-icon" aria-label={title+'を閉じる'} disabled={lockDismiss} onClick={onClose}><X size={18}/></button></header>
      {toolbar && <div className="review-sheet-toolbar" inert={lockDismiss}>{toolbar}</div>}
      <div className="review-sheet-content">{children}</div>
    </section>
  </div>;
}
