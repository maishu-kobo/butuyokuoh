import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

interface ExportItem {
  name: string;
  url: string;
  current_price: number | null;
  target_price: number | null;
  target_currency: string | null;
  category_name: string | null;
  priority: number;
  planned_purchase_date: string | null;
  notes: string | null;
  created_at: string;
  is_purchased: number;
  purchased_at: string | null;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter') || 'all'; // 'all', 'wishlist', 'purchased'

  const db = getDb();

  let whereClause = 'WHERE i.user_id = ?';
  if (filter === 'wishlist') {
    whereClause += ' AND i.is_purchased = 0';
  } else if (filter === 'purchased') {
    whereClause += ' AND i.is_purchased = 1';
  }

  const items = db.prepare(`
    SELECT 
      i.name,
      i.url,
      i.current_price,
      i.target_price,
      i.target_currency,
      cat.name as category_name,
      i.priority,
      i.planned_purchase_date,
      i.notes,
      i.created_at,
      i.is_purchased,
      i.purchased_at
    FROM items i
    LEFT JOIN categories cat ON i.category_id = cat.id
    ${whereClause}
    ORDER BY i.created_at DESC
  `).all(user.id) as ExportItem[];

  // CSV作成
  const headers = [
    '商品名',
    'URL',
    '現在価格',
    '目標価格',
    '通貨',
    'カテゴリ',
    '優先度',
    '購入予定日',
    'メモ',
    '登録日',
    'ステータス',
    '購入日',
  ];

  const priorityLabels: Record<number, string> = {
    1: '最高',
    2: '高',
    3: '普通',
    4: '低',
    5: '最低',
  };

  const rows = items.map((item) => [
    item.name,
    item.url,
    item.current_price?.toString() || '',
    item.target_price?.toString() || '',
    item.target_currency || 'JPY',
    item.category_name || '',
    priorityLabels[item.priority] || item.priority.toString(),
    item.planned_purchase_date || '',
    item.notes || '',
    item.created_at,
    item.is_purchased ? '購入済み' : '未購入',
    item.purchased_at || '',
  ]);

  // CSVエスケープ処理
  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const csvContent = [
    headers.map(escapeCSV).join(','),
    ...rows.map((row) => row.map(escapeCSV).join(',')),
  ].join('\n');

  // BOM付きUTF-8でExcel対応
  const bom = '\uFEFF';
  const csvWithBom = bom + csvContent;

  const filename = `butuyokuoh_${filter}_${new Date().toISOString().split('T')[0]}.csv`;

  return new NextResponse(csvWithBom, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
