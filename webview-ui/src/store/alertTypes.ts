// 與後端AlertTypeEnum保持一致的枚舉
export enum AlertTypeEnum {
  // 簡單價格提醒
  PRICE_ABOVE = 'PRICE_ABOVE',
  PRICE_BELOW = 'PRICE_BELOW',
  CHANGE_ABOVE = 'CHANGE_ABOVE',
  CHANGE_BELOW = 'CHANGE_BELOW',
  VOLUME_ABOVE = 'VOLUME_ABOVE',
  // 技術分析提醒
  MA_CROSS_ABOVE = 'MA_CROSS_ABOVE',
  MA_CROSS_BELOW = 'MA_CROSS_BELOW',
  VOLUME_MA_ABOVE = 'VOLUME_MA_ABOVE',
  RSI_ABOVE = 'RSI_ABOVE',
  RSI_BELOW = 'RSI_BELOW',
  MACD_CROSS_ABOVE = 'MACD_CROSS_ABOVE',
  MACD_CROSS_BELOW = 'MACD_CROSS_BELOW',
  BB_UPPER_TOUCH = 'BB_UPPER_TOUCH',
  BB_LOWER_TOUCH = 'BB_LOWER_TOUCH'
}

// 定義與後端對應的提醒規則類型
export interface AlertRule {
  id: number;
  name: string;
  description: string;
  alert_type: AlertTypeEnum;
  threshold: number;
  parameters: Record<string, any>;
  is_premium: boolean;
  created_at: string;
}

// 定義與後端對應的股票提醒類型
export interface StockAlertItem {
  id: number;
  stock: {
    symbol: string;
    name: string;
  };
  alert_rule: AlertRule;
  is_active: boolean;
  repeat_notification: boolean;
  last_triggered: string | null;
  created_at: string;
}

// 定義與後端對應的提醒歷史類型
export interface AlertHistoryItem {
  id: number;
  symbol: string;
  name: string;
  alert_type: AlertTypeEnum;
  threshold: number;
  current_value: number;
  price: number;
  change_percent: number;
  triggered_at: string;
  parameters: Record<string, any>;
  stock_alert_id: number;
  time?: string;              // ISO 格式時間戳
  timestamp?: number;         // Unix 時間戳（毫秒）
  timezone?: string;          // 時區信息
  formatted_time?: string;    // 格式化的時間字符串
}

export interface AlertCreateRequest {
  stock_symbol: string;
  name: string;
  description: string;
  alert_type: AlertTypeEnum;
  threshold: number | null;
  parameters: Record<string, any>;
  is_premium: boolean;
  is_active: boolean;
  repeat_notification: boolean;
}

export interface AlertUpdateRequest {
  name?: string;
  description?: string;
  alert_type?: AlertTypeEnum;
  threshold?: number | null;
  parameters?: Record<string, any>;
  is_premium?: boolean;
  is_active?: boolean;
  repeat_notification?: boolean;
} 