'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Check } from 'lucide-react';
import ItemCard from './ItemCard';
import { Item, Category, ComparisonGroup } from '@/types';

interface SortableItemCardProps {
  item: Item;
  onUpdate: () => void;
  onDelete: (id: number) => void;
  categories?: Category[];
  comparisonGroups?: ComparisonGroup[];
  isLowestPrice?: boolean;
  isDragEnabled?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
}

export default function SortableItemCard({
  item,
  onUpdate,
  onDelete,
  categories,
  comparisonGroups,
  isLowestPrice,
  isDragEnabled = true,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}: SortableItemCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: item.id,
    disabled: !isDragEnabled || selectionMode,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  };

  const handleClick = () => {
    if (selectionMode && onToggleSelect) {
      onToggleSelect(item.id);
    }
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className={`relative ${selectionMode ? 'cursor-pointer' : ''} ${isSelected ? 'ring-2 ring-orange-500 rounded-lg' : ''}`}
      onClick={handleClick}
    >
      {/* 選択モード時のチェックボックス */}
      {selectionMode && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-10 flex items-center justify-center rounded-l-lg z-10 ${
            isSelected 
              ? 'bg-orange-500' 
              : 'bg-slate-100 dark:bg-slate-700'
          }`}
        >
          {isSelected ? (
            <Check size={20} className="text-white" />
          ) : (
            <div className="w-5 h-5 border-2 border-slate-300 dark:border-slate-500 rounded" />
          )}
        </div>
      )}
      {/* ドラッグハンドル（選択モード以外） */}
      {!selectionMode && isDragEnabled && (
        <button
          {...attributes}
          {...listeners}
          className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 cursor-grab active:cursor-grabbing rounded-l-lg z-10 touch-none"
          title="ドラッグして並び替え"
        >
          <GripVertical size={18} className="text-slate-400" />
        </button>
      )}
      <div className={selectionMode ? 'ml-10' : (isDragEnabled ? 'ml-8' : '')}>
        <ItemCard
          item={item}
          onUpdate={onUpdate}
          onDelete={onDelete}
          categories={categories}
          comparisonGroups={comparisonGroups}
          isLowestPrice={isLowestPrice}
        />
      </div>
    </div>
  );
}
