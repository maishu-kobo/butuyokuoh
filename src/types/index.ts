export interface Item {
  id: number;
  name: string;
  url: string;
  image_url: string | null;
  current_price: number | null;
  original_price: number | null;
  source: string; // 'amazon', 'rakuten', 'other'
  source_name: string | null; // メーカー名など
  priority: number; // 1-5
  planned_purchase_date: string | null;
  comparison_group_id: number | null;
  notes: string | null;
  is_purchased: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriceHistory {
  id: number;
  item_id: number;
  price: number;
  recorded_at: string;
}

export interface ComparisonGroup {
  id: number;
  name: string;
  priority: number;
  created_at: string;
}

export interface NotificationSetting {
  id: number;
  item_id: number;
  target_price: number | null;
  notify_on_any_drop: boolean;
  slack_webhook: string | null;
  email: string | null;
  enabled: boolean;
}

export interface BudgetCalculation {
  items: Item[];
  total: number;
  plannedDate: string;
}
