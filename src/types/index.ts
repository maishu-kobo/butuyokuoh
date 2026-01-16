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
  category_id: number | null;
  category_name?: string | null;
  category_color?: string | null;
  notes: string | null;
  is_purchased: boolean;
  purchased_at: string | null;
  target_price: number | null;
  target_currency: 'JPY' | 'USD' | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  user_id: number;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
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
  enabled: boolean;
}

export interface UserNotificationSettings {
  id: number;
  user_id: number;
  slack_webhook: string | null;
  line_notify_token: string | null;
  notify_on_price_drop: boolean;
  notify_on_target_price: boolean;
  created_at: string;
  updated_at: string;
}

export interface BudgetCalculation {
  items: Item[];
  total: number;
  plannedDate: string;
}
