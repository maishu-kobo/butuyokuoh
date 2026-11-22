'use client';

import { createContext, useContext, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection,
} from '@dnd-kit/core';
import { useCombinedRefs } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { ReviewProduct } from '@/lib/design-home';

const samePriority: CollisionDetection = args => {
  const peers = args.droppableContainers.filter(row => row.data.current?.priority === args.active.data.current?.priority);
  return pointerWithin({ ...args, droppableContainers: peers });
};

type KeyboardMove = {source: string; target: string; side: 'before' | 'after';priority:number};
const RankDragState = createContext<{
  id: string; move: KeyboardMove | null; pointerPosition: number | undefined;activePriority:number|undefined; cancel: () => void;
  onKey: (event: KeyboardEvent<HTMLButtonElement>, product: ReviewProduct, peers: ReviewProduct[],priority:number) => void;
} | null>(null);

export function PriorityDrag({ children, onMove }: {
  children: ReactNode; onMove: (source: string, target: string) => void;
}) {
  const id = useId();
  const [pointer, setPointer] = useState<{name:string; position:number;priority:number} | null>(null);
  const [move, setMove] = useState<KeyboardMove | null>(null);
  const [announcement, announce] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, {activationConstraint: {distance: 6}}));
  function cancel() { setMove(null); }
  function onKey(event: KeyboardEvent<HTMLButtonElement>, product: ReviewProduct, peers: ReviewProduct[],priority:number) {
    const key = product.key;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (event.repeat) return;
      if (move?.source === key) {
        if (key !== move.target) onMove(key,move.target);
        cancel();
      } else {
        setMove({source:key,target:key,side:'after',priority});
        announce(product.name+'の位置');
      }
    } else if (move?.source === key) {
      if (event.key === 'Escape') { event.preventDefault(); cancel(); announce('並べ替えをキャンセルしました。'); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const from = peers.findIndex(p => p.key === key);
      const index = peers.findIndex(p => p.key === move.target) + (event.key === 'ArrowDown' ? 1 : -1);
      const next = peers[index];
      if (!next) return;
      setMove({source:key,target:next.key,side:from < index ? 'after' : 'before',priority});
      document.getElementById(id+next.key)?.scrollIntoView({block:'nearest'});
      announce(next.name+'の位置');
    }
  }
  return <RankDragState.Provider value={{id,move,pointerPosition:pointer?.position,activePriority:pointer?.priority??move?.priority,cancel,onKey}}>
    <span className="sr-only" id={id+'-keys'}>スペースで選び、上下キーで同じ優先度の中を移動します。スペースで確定、Escapeでキャンセルします。</span>
    <span className="sr-only" aria-live="assertive">{announcement}</span>
    <DndContext id={id} sensors={sensors} collisionDetection={samePriority}
    accessibility={{
      screenReaderInstructions: {draggable:'スペースで商品を持ち上げ、上下キーで同じ優先度の中を移動します。スペースで確定、Escapeでキャンセルします。'},
      announcements: {
        onDragStart: ({active}) => active.data.current?.name+'を選びました。',
        onDragOver: ({over}) => over ? over.data.current?.name+'の位置' : '同じ優先度の商品を選んでください。',
        onDragEnd: () => undefined,
        onDragCancel: () => '並べ替えをキャンセルしました。',
      },
    }}
    onDragStart={({active}) => {
      cancel();
      const data = active.data.current;
      if (data) setPointer({name:data.name,position:data.position,priority:data.priority});
    }}
    onDragCancel={() => setPointer(null)}
    onDragEnd={({active,over}) => {
      setPointer(null);
      if (over && over.id !== active.id && over.data.current?.priority === active.data.current?.priority) {
        onMove(String(active.id), String(over.id));
      }
    }}>
    {children}
    <DragOverlay dropAnimation={null} style={{pointerEvents:'none'}}>
      {pointer && <div className="rank-drag-ghost" aria-hidden><GripVertical size={18}/><strong>{pointer.name}</strong></div>}
    </DragOverlay>
  </DndContext></RankDragState.Provider>;
}

export function PriorityRow({product,priority,position,peers,busy,rank,leading,rankInHandle=false,children}: {
  product:ReviewProduct; priority:number; position:number; peers:ReviewProduct[]; busy:boolean; rank:ReactNode;leading?:ReactNode;rankInHandle?:boolean; children:ReactNode;
}) {
  const keyboard = useContext(RankDragState)!;
  const canDrag = peers.length > 1;
  const data = {priority, position, name:product.name};
  const disabled = busy || !canDrag;
  const {attributes,listeners,isDragging,setNodeRef:setDragNode,setActivatorNodeRef} =
    useDraggable({id:product.key, data, disabled, attributes:{roleDescription:'並べ替えハンドル'}});
  const {isOver,setNodeRef:setDropNode} = useDroppable({id:product.key, data, disabled});
  const ref = useCombinedRefs(setDragNode, setDropNode);
  const pointerMarker = isOver && !isDragging && keyboard.pointerPosition !== undefined
    ? (keyboard.pointerPosition < position ? 'after' : 'before') : undefined;
  const picked = keyboard.move?.source === product.key;
  const keyMarker = !picked && keyboard.move?.target === product.key ? keyboard.move.side : undefined;
  return <li id={keyboard.id+product.key} ref={ref} className="rank-row" data-drop={pointerMarker ?? keyMarker} data-dragging={isDragging || picked || undefined}
    data-compatible={keyboard.activePriority===undefined?undefined:keyboard.activePriority===priority}>
    <div className="rank-position">{leading}<div className="rank-position-controls">{(!rankInHandle||!canDrag)&&rank}
      {canDrag && <button type="button" className="rank-grip" title="同じ優先度内で並べ替え"
        {...attributes} {...listeners} disabled={busy} ref={setActivatorNodeRef}
        aria-pressed={picked || isDragging} aria-describedby={keyboard.id+'-keys'}
        onKeyDown={e => keyboard.onKey(e,product,peers,priority)} onBlur={() => {if (picked) keyboard.cancel();}}
        aria-label={(rankInHandle?'全体'+position+'位、':'')+product.name+'を同じ優先度内で並べ替え'}>{rankInHandle&&rank}<GripVertical aria-hidden size={18}/></button>}
    </div></div>
    {children}
  </li>;
}
