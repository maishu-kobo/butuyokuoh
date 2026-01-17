'use client';

import { useEffect, useState } from 'react';
import { Item } from '@/types';
import { Calendar, Wallet, Check, Square, CheckSquare, Calculator } from 'lucide-react';

interface BudgetData {
  [month: string]: {
    items: Item[];
    total: number;
  };
}

export default function BudgetView() {
  const [budget, setBudget] = useState<BudgetData>({});
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch('/api/budget')
      .then((res) => res.json())
      .then((data) => {
        setBudget(data);
        // 全アイテムをフラットに
        const items: Item[] = [];
        Object.values(data).forEach((monthData: any) => {
          items.push(...monthData.items);
        });
        setAllItems(items);
        setLoading(false);
      });
  }, []);

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === allItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allItems.map(i => i.id)));
    }
  };

  const toggleSelectMonth = (monthItems: Item[]) => {
    const monthIds = monthItems.map(i => i.id);
    const allSelected = monthIds.every(id => selectedIds.has(id));
    const newSet = new Set(selectedIds);
    
    if (allSelected) {
      monthIds.forEach(id => newSet.delete(id));
    } else {
      monthIds.forEach(id => newSet.add(id));
    }
    setSelectedIds(newSet);
  };

  if (loading) {
    return <div className="text-gray-500">読み込み中...</div>;
  }

  const months = Object.keys(budget).sort();
  const totalBudget = months.reduce((sum, m) => sum + budget[m].total, 0);
  
  // 選択したアイテムの合計（個数を考慮）
  const selectedTotal = allItems
    .filter(item => selectedIds.has(item.id))
    .reduce((sum, item) => sum + (item.current_price || 0) * (item.quantity || 1), 0);

  return (
    <div className="space-y-4">
      {/* 合計カード */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={20} />
            <span className="text-sm opacity-90">全体の合計</span>
          </div>
          <div className="text-3xl font-bold">¥{totalBudget.toLocaleString()}</div>
          <div className="text-sm opacity-75 mt-1">{allItems.length}件</div>
        </div>
        
        <div className={`rounded-lg p-4 transition-all ${
          selectedIds.size > 0 
            ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white' 
            : 'bg-gray-100 text-gray-400'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <Calculator size={20} />
            <span className="text-sm opacity-90">選択中の合計</span>
          </div>
          <div className="text-3xl font-bold">
            {selectedIds.size > 0 ? `¥${selectedTotal.toLocaleString()}` : '—'}
          </div>
          <div className="text-sm opacity-75 mt-1">
            {selectedIds.size > 0 ? `${selectedIds.size}件選択中` : 'アイテムを選択してください'}
          </div>
        </div>
      </div>

      {months.length === 0 ? (
        <div className="text-gray-500 text-center py-8">
          購入予定日が設定されたアイテムがありません
        </div>
      ) : (
        <>
          {/* 全選択ボタン */}
          <div className="flex justify-end">
            <button
              onClick={toggleSelectAll}
              className="text-sm text-gray-600 hover:text-blue-600 flex items-center gap-1"
            >
              {selectedIds.size === allItems.length ? (
                <><CheckSquare size={16} /> 全て解除</>
              ) : (
                <><Square size={16} /> 全て選択</>
              )}
            </button>
          </div>

          {months.map((month) => {
            const data = budget[month];
            const [year, monthNum] = month.split('-');
            const monthName = `${year}年${parseInt(monthNum)}月`;
            const monthIds = data.items.map(i => i.id);
            const allMonthSelected = monthIds.every(id => selectedIds.has(id));
            const someMonthSelected = monthIds.some(id => selectedIds.has(id));

            return (
              <div key={month} className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleSelectMonth(data.items)}
                      className={`p-1 rounded hover:bg-gray-100 ${
                        allMonthSelected ? 'text-blue-600' : someMonthSelected ? 'text-blue-400' : 'text-gray-300'
                      }`}
                    >
                      {allMonthSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                    <Calendar size={18} className="text-gray-400" />
                    <span className="font-semibold">{monthName}</span>
                  </div>
                  <span className="text-lg font-bold text-blue-600">
                    ¥{data.total.toLocaleString()}
                  </span>
                </div>
                <div className="space-y-1">
                  {data.items.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleSelect(item.id)}
                        className={`flex items-center gap-2 text-sm py-2 px-2 rounded cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <span className={isSelected ? 'text-blue-600' : 'text-gray-300'}>
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                        </span>
                        <span className={`flex-1 truncate ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
                          {item.name}
                          {(item.quantity || 1) > 1 && (
                            <span className="text-xs text-gray-400 ml-1">×{item.quantity}</span>
                          )}
                        </span>
                        <span className={`ml-2 whitespace-nowrap ${isSelected ? 'text-blue-600 font-medium' : 'text-gray-600'}`}>
                          {(item.quantity || 1) > 1 
                            ? `¥${((item.current_price || 0) * (item.quantity || 1)).toLocaleString()}`
                            : `¥${item.current_price?.toLocaleString() || '---'}`
                          }
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
