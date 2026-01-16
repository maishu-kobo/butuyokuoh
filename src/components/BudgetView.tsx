'use client';

import { useEffect, useState } from 'react';
import { Item } from '@/types';
import { Calendar, Wallet } from 'lucide-react';

interface BudgetData {
  [month: string]: {
    items: Item[];
    total: number;
  };
}

export default function BudgetView() {
  const [budget, setBudget] = useState<BudgetData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/budget')
      .then((res) => res.json())
      .then((data) => {
        setBudget(data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="text-gray-500">読み込み中...</div>;
  }

  const months = Object.keys(budget).sort();

  if (months.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8">
        購入予定日が設定されたアイテムがありません
      </div>
    );
  }

  const totalBudget = months.reduce((sum, m) => sum + budget[m].total, 0);

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg p-4">
        <div className="flex items-center gap-2 mb-1">
          <Wallet size={20} />
          <span className="text-sm opacity-90">合計予定出費</span>
        </div>
        <div className="text-3xl font-bold">¥{totalBudget.toLocaleString()}</div>
      </div>

      {months.map((month) => {
        const data = budget[month];
        const [year, monthNum] = month.split('-');
        const monthName = `${year}年${parseInt(monthNum)}月`;

        return (
          <div key={month} className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="text-gray-400" />
                <span className="font-semibold">{monthName}</span>
              </div>
              <span className="text-lg font-bold text-blue-600">
                ¥{data.total.toLocaleString()}
              </span>
            </div>
            <div className="space-y-2">
              {data.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                  <span className="text-gray-700 truncate flex-1">{item.name}</span>
                  <span className="text-gray-600 ml-2">¥{item.current_price?.toLocaleString() || '---'}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
