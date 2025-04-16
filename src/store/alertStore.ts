import { create } from 'zustand';
import { PriceAlert, StockInventory } from '../types';
import { LoggerService, LogCategory } from '../utilities/loggerService';
import axios from 'axios';
import { urls } from '../config';
import { useSessionStore } from './sessionStore';

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

// 定義不同類型提醒所需的參數
export interface AlertParameters {
  [AlertTypeEnum.MA_CROSS_ABOVE]: { fast_period: number; slow_period: number };
  [AlertTypeEnum.MA_CROSS_BELOW]: { fast_period: number; slow_period: number };
  [AlertTypeEnum.RSI_ABOVE]: { period: number };
  [AlertTypeEnum.RSI_BELOW]: { period: number };
  [AlertTypeEnum.MACD_CROSS_ABOVE]: { fast_period: number; slow_period: number; signal_period: number };
  [AlertTypeEnum.MACD_CROSS_BELOW]: { fast_period: number; slow_period: number; signal_period: number };
  [AlertTypeEnum.BB_UPPER_TOUCH]: { period: number; std_dev: number };
  [AlertTypeEnum.BB_LOWER_TOUCH]: { period: number; std_dev: number };
  [AlertTypeEnum.VOLUME_MA_ABOVE]: { period: number };
}

// 定義與後端對應的提醒類型
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

// 獲取指定提醒類型所需的參數定義
export function getRequiredParameters(alertType: AlertTypeEnum): string[] {
  switch(alertType) {
    case AlertTypeEnum.MA_CROSS_ABOVE:
    case AlertTypeEnum.MA_CROSS_BELOW:
      return ['fast_period', 'slow_period'];
    case AlertTypeEnum.RSI_ABOVE:
    case AlertTypeEnum.RSI_BELOW:
    case AlertTypeEnum.VOLUME_MA_ABOVE:
      return ['period'];
    case AlertTypeEnum.MACD_CROSS_ABOVE:
    case AlertTypeEnum.MACD_CROSS_BELOW:
      return ['fast_period', 'slow_period', 'signal_period'];
    case AlertTypeEnum.BB_UPPER_TOUCH:
    case AlertTypeEnum.BB_LOWER_TOUCH:
      return ['period', 'std_dev'];
    default:
      return [];
  }
}

// 判斷是否為需要閾值的提醒類型
export function requiresThreshold(alertType: AlertTypeEnum): boolean {
  return [
    AlertTypeEnum.PRICE_ABOVE,
    AlertTypeEnum.PRICE_BELOW,
    AlertTypeEnum.CHANGE_ABOVE,
    AlertTypeEnum.CHANGE_BELOW,
    AlertTypeEnum.VOLUME_ABOVE
  ].includes(alertType);
}

// 獲取提醒類型的中文描述
export function getAlertTypeDescription(alertType: AlertTypeEnum): string {
  switch(alertType) {
    case AlertTypeEnum.PRICE_ABOVE:
      return '價格超過';
    case AlertTypeEnum.PRICE_BELOW:
      return '價格低於';
    case AlertTypeEnum.CHANGE_ABOVE:
      return '漲幅大於';
    case AlertTypeEnum.CHANGE_BELOW:
      return '跌幅大於';
    case AlertTypeEnum.VOLUME_ABOVE:
      return '成交量超過';
    case AlertTypeEnum.MA_CROSS_ABOVE:
      return '短期均線上穿長期均線';
    case AlertTypeEnum.MA_CROSS_BELOW:
      return '短期均線下穿長期均線';
    case AlertTypeEnum.VOLUME_MA_ABOVE:
      return '成交量超過均量線';
    case AlertTypeEnum.RSI_ABOVE:
      return 'RSI超過';
    case AlertTypeEnum.RSI_BELOW:
      return 'RSI低於';
    case AlertTypeEnum.MACD_CROSS_ABOVE:
      return 'MACD金叉';
    case AlertTypeEnum.MACD_CROSS_BELOW:
      return 'MACD死叉';
    case AlertTypeEnum.BB_UPPER_TOUCH:
      return '接觸布林上軌';
    case AlertTypeEnum.BB_LOWER_TOUCH:
      return '接觸布林下軌';
    default:
      return '未知提醒類型';
  }
}

// 獲取提醒類型的默認參數
export function getDefaultParameters(alertType: AlertTypeEnum): Record<string, any> {
  switch(alertType) {
    case AlertTypeEnum.MA_CROSS_ABOVE:
    case AlertTypeEnum.MA_CROSS_BELOW:
      return { fast_period: 5, slow_period: 20 };
    case AlertTypeEnum.RSI_ABOVE:
    case AlertTypeEnum.RSI_BELOW:
      return { period: 14 };
    case AlertTypeEnum.MACD_CROSS_ABOVE:
    case AlertTypeEnum.MACD_CROSS_BELOW:
      return { fast_period: 12, slow_period: 26, signal_period: 9 };
    case AlertTypeEnum.BB_UPPER_TOUCH:
    case AlertTypeEnum.BB_LOWER_TOUCH:
      return { period: 20, std_dev: 2 };
    case AlertTypeEnum.VOLUME_MA_ABOVE:
      return { period: 5 };
    default:
      return {};
  }
}

interface AlertState {
  // 原有的簡單提醒功能（保留向後兼容性）
  priceAlerts: Map<string, PriceAlert[]>;
  updatePriceAlert: (symbol: string, alerts: PriceAlert[]) => void;
  removePriceAlert: (symbol: string) => void;
  
  // 新增的提醒功能
  alerts: StockAlertItem[];
  alertHistory: AlertHistoryItem[];
  isLoading: boolean;
  error: string | null;
  
  // 新增的API功能
  fetchAlerts: () => Promise<void>;
  fetchAlertById: (alertId: number) => Promise<StockAlertItem | null>;
  createAlert: (alertData: AlertCreateRequest) => Promise<StockAlertItem | null>;
  updateAlert: (alertId: number, alertData: AlertUpdateRequest) => Promise<StockAlertItem | null>;
  deleteAlert: (alertId: number) => Promise<boolean>;
  resetAlert: (alertId: number) => Promise<StockAlertItem | null>;
  
  // 提醒歷史相關
  fetchAlertHistory: (filters?: Record<string, any>) => Promise<void>;
  fetchAlertHistoryById: (historyId: number) => Promise<AlertHistoryItem | null>;
  fetchAlertHistoryByAlertId: (alertId: number) => Promise<AlertHistoryItem[]>;
}

export const useAlertStore = create<AlertState>()((set, get) => ({
  // 原有的簡單提醒功能
  priceAlerts: new Map(),
  
  updatePriceAlert: (symbol, alerts) => set((state) => {
    const newPriceAlerts = new Map(state.priceAlerts);
    newPriceAlerts.set(symbol, alerts);
    return { priceAlerts: newPriceAlerts };
  }),

  removePriceAlert: (symbol) => set((state) => {
    const newPriceAlerts = new Map(state.priceAlerts);
    newPriceAlerts.delete(symbol);
    return { priceAlerts: newPriceAlerts };
  }),
  
  // 新增的提醒狀態
  alerts: [],
  alertHistory: [],
  isLoading: false,
  error: null,
  
  // 獲取所有提醒
  fetchAlerts: async () => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.API, '未登入狀態下無法獲取提醒');
      set({ error: '請先登入以獲取提醒' });
      return;
    }
    
    set({ isLoading: true, error: null });
    
    try {
      const response = await axios.get(urls.alerts.list, {
        headers: {
          'Authorization': `Bearer ${sessionStore.authToken}`,
          'Content-Type': 'application/json',
          'X-Client-UUID': sessionStore.clientUuid
        }
      });
      
      // 增加日誌，打印完整的 response 內容
      logger.debug(LogCategory.API, `提醒數據響應: ${JSON.stringify(response.data)}`);
      
      // 檢查響應格式並處理可能的分頁結構
      let alertsData = response.data;
      
      // 檢查是否為分頁結構 (items 字段)
      if (response.data && typeof response.data === 'object' && 'items' in response.data) {
        alertsData = response.data.items;
        logger.info(LogCategory.API, `檢測到分頁結構，使用 items 字段，共 ${alertsData.length} 個項目`);
      }
      
      // 確保 alertsData 是陣列
      if (alertsData && Array.isArray(alertsData)) {
        logger.info(LogCategory.API, `提醒數據合法，共 ${alertsData.length} 個提醒`);
        set({ alerts: alertsData, isLoading: false });
        logger.info(LogCategory.API, `成功獲取 ${alertsData.length} 個提醒`);
      } else {
        logger.warning(LogCategory.API, `提醒數據格式不正確: ${typeof alertsData}, 值為: ${JSON.stringify(alertsData)}`);
        if (!alertsData) {
          logger.warning(LogCategory.API, '提醒數據為空或 null/undefined');
          set({ alerts: [], isLoading: false });
          logger.info(LogCategory.API, '處理為空提醒列表');
        } else {
          set({ isLoading: false, error: '獲取提醒失敗：響應格式不正確' });
        }
      }
    } catch (error) {
      logger.logError(LogCategory.API, error, '獲取提醒時發生錯誤');
      set({ 
        isLoading: false, 
        error: error instanceof Error ? error.message : '獲取提醒時發生未知錯誤' 
      });
    }
  },
  
  // 獲取單個提醒
  fetchAlertById: async (alertId) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.API, '未登入狀態下無法獲取提醒');
      set({ error: '請先登入以獲取提醒' });
      return null;
    }
    
    set({ isLoading: true, error: null });
    
    try {
      const url = urls.alerts.detail(alertId);
      logger.debug(LogCategory.API, `獲取提醒詳情 URL: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${sessionStore.authToken}`,
          'Content-Type': 'application/json',
          'X-Client-UUID': sessionStore.clientUuid
        }
      });
      
      set({ isLoading: false });
      
      if (response.data) {
        logger.info(LogCategory.API, `成功獲取提醒 ID: ${alertId}`);
        return response.data;
      }
      
      return null;
    } catch (error) {
      logger.logError(LogCategory.API, error, `獲取提醒 ID: ${alertId} 時發生錯誤`);
      set({ 
        isLoading: false, 
        error: error instanceof Error ? error.message : '獲取提醒時發生未知錯誤' 
      });
      return null;
    }
  },
  
  // 創建提醒
  createAlert: async (alertData) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.API, '未登入狀態下無法創建提醒');
      set({ error: '請先登入以創建提醒' });
      return null;
    }
    
    set({ isLoading: true, error: null });
    
    try {
      const response = await axios.post(urls.alerts.create, alertData, {
        headers: {
          'Authorization': `Bearer ${sessionStore.authToken}`,
          'Content-Type': 'application/json',
          'X-Client-UUID': sessionStore.clientUuid
        }
      });
      
      set({ isLoading: false });
      
      if (response.data) {
        // 更新提醒列表
        const currentAlerts = get().alerts;
        set({ alerts: [...currentAlerts, response.data] });
        
        logger.info(LogCategory.API, `成功創建提醒 ID: ${response.data.id}`);
        return response.data;
      }
      
      return null;
    } catch (error) {
      logger.logError(LogCategory.API, error, '創建提醒時發生錯誤');
      set({ 
        isLoading: false, 
        error: error instanceof Error ? error.message : '創建提醒時發生未知錯誤' 
      });
      return null;
    }
  },
  
  // 更新提醒
  updateAlert: async (alertId, alertData) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.API, '未登入狀態下無法更新提醒');
      set({ error: '請先登入以更新提醒' });
      return null;
    }
    
    set({ isLoading: true, error: null });
    
    try {
      const response = await axios.put(urls.alerts.update(alertId), alertData, {
        headers: {
          'Authorization': `Bearer ${sessionStore.authToken}`,
          'Content-Type': 'application/json',
          'X-Client-UUID': sessionStore.clientUuid
        }
      });
      
      set({ isLoading: false });
      
      if (response.data) {
        // 更新提醒列表
        const currentAlerts = get().alerts;
        const updatedAlerts = currentAlerts.map(alert => 
          alert.id === alertId ? response.data : alert
        );
        
        set({ alerts: updatedAlerts });
        
        logger.info(LogCategory.API, `成功更新提醒 ID: ${alertId}`);
        return response.data;
      }
      
      return null;
    } catch (error) {
      logger.logError(LogCategory.API, error, `更新提醒 ID: ${alertId} 時發生錯誤`);
      set({ 
        isLoading: false, 
        error: error instanceof Error ? error.message : '更新提醒時發生未知錯誤' 
      });
      return null;
    }
  },
  
  // 刪除提醒
  deleteAlert: async (alertId) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.API, '未登入狀態下無法刪除提醒');
      set({ error: '請先登入以刪除提醒' });
      return false;
    }
    
    set({ isLoading: true, error: null });
    
    try {
      const url = urls.alerts.delete(alertId);
      logger.debug(LogCategory.API, `刪除提醒 URL: ${url}`);
      
      const response = await axios.delete(url, {
        headers: {
          'Authorization': `Bearer ${sessionStore.authToken}`,
          'Content-Type': 'application/json',
          'X-Client-UUID': sessionStore.clientUuid
        }
      });
      
      set({ isLoading: false });
      
      if (response.status === 200 || response.status === 204) {
        // 從列表中移除此提醒
        const currentAlerts = get().alerts;
        const updatedAlerts = currentAlerts.filter(alert => alert.id !== alertId);
        
        set({ alerts: updatedAlerts });
        
        logger.info(LogCategory.API, `成功刪除提醒 ID: ${alertId}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.logError(LogCategory.API, error, `刪除提醒 ID: ${alertId} 時發生錯誤`);
      set({ 
        isLoading: false, 
        error: error instanceof Error ? error.message : '刪除提醒時發生未知錯誤' 
      });
      return false;
    }
  },
  
  // 重置提醒
  resetAlert: async (alertId) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.API, '未登入狀態下無法重置提醒');
      set({ error: '請先登入以重置提醒' });
      return null;
    }
    
    set({ isLoading: true, error: null });
    
    try {
      const response = await axios.post(urls.alerts.reset(alertId), {}, {
        headers: {
          'Authorization': `Bearer ${sessionStore.authToken}`,
          'Content-Type': 'application/json',
          'X-Client-UUID': sessionStore.clientUuid
        }
      });
      
      set({ isLoading: false });
      
      if (response.data) {
        // 更新提醒列表
        const currentAlerts = get().alerts;
        const updatedAlerts = currentAlerts.map(alert => 
          alert.id === alertId ? response.data : alert
        );
        
        set({ alerts: updatedAlerts });
        
        logger.info(LogCategory.API, `成功重置提醒 ID: ${alertId}`);
        return response.data;
      }
      
      return null;
    } catch (error) {
      logger.logError(LogCategory.API, error, `重置提醒 ID: ${alertId} 時發生錯誤`);
      set({ 
        isLoading: false, 
        error: error instanceof Error ? error.message : '重置提醒時發生未知錯誤' 
      });
      return null;
    }
  },
  
  // 獲取提醒歷史
  fetchAlertHistory: async (filters = {}) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    // 如果已經在加載中，則不再發起新的請求
    if (get().isLoading) {
      logger.debug(LogCategory.API, '正在載入提醒歷史，忽略重複請求');
      return;
    }
    
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.API, '未登入狀態下無法獲取提醒歷史');
      set({ error: '請先登入以獲取提醒歷史' });
      return;
    }
    
    set({ isLoading: true, error: null });
    
    try {
      // 構建查詢參數
      const queryParams = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.append(key, String(value));
        }
      });
      
      const url = `${urls.alerts.history}?${queryParams.toString()}`;
      logger.debug(LogCategory.API, `請求提醒歷史 URL: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${sessionStore.authToken}`,
          'Content-Type': 'application/json',
          'X-Client-UUID': sessionStore.clientUuid
        }
      });
      
      if (response.data) {
        set({ alertHistory: response.data, isLoading: false });
        logger.info(LogCategory.API, `成功獲取 ${response.data.length} 條提醒歷史記錄`);
      } else {
        set({ isLoading: false, error: '獲取提醒歷史失敗' });
      }
    } catch (error) {
      logger.logError(LogCategory.API, error, '獲取提醒歷史時發生錯誤');
      set({ 
        isLoading: false, 
        error: error instanceof Error ? error.message : '獲取提醒歷史時發生未知錯誤' 
      });
    }
  },
  
  // 獲取特定提醒的歷史記錄
  fetchAlertHistoryByAlertId: async (alertId) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.API, '未登入狀態下無法獲取提醒歷史');
      set({ error: '請先登入以獲取提醒歷史' });
      return [];
    }
    
    try {
      const response = await axios.get(urls.alerts.alertHistory(alertId), {
        headers: {
          'Authorization': `Bearer ${sessionStore.authToken}`,
          'Content-Type': 'application/json',
          'X-Client-UUID': sessionStore.clientUuid
        }
      });
      
      if (response.data) {
        logger.info(LogCategory.API, `成功獲取提醒 ID: ${alertId} 的 ${response.data.length} 條歷史記錄`);
        return response.data;
      }
      
      return [];
    } catch (error) {
      logger.logError(LogCategory.API, error, `獲取提醒 ID: ${alertId} 的歷史記錄時發生錯誤`);
      set({ 
        error: error instanceof Error ? error.message : '獲取提醒歷史時發生未知錯誤' 
      });
      return [];
    }
  },
  
  // 獲取特定歷史記錄的詳細信息
  fetchAlertHistoryById: async (historyId) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.API, '未登入狀態下無法獲取提醒歷史詳情');
      set({ error: '請先登入以獲取提醒歷史詳情' });
      return null;
    }
    
    try {
      const response = await axios.get(urls.alerts.historyDetail(historyId), {
        headers: {
          'Authorization': `Bearer ${sessionStore.authToken}`,
          'Content-Type': 'application/json',
          'X-Client-UUID': sessionStore.clientUuid
        }
      });
      
      if (response.data) {
        logger.info(LogCategory.API, `成功獲取歷史記錄 ID: ${historyId} 的詳情`);
        return response.data;
      }
      
      return null;
    } catch (error) {
      logger.logError(LogCategory.API, error, `獲取歷史記錄 ID: ${historyId} 的詳情時發生錯誤`);
      set({ 
        error: error instanceof Error ? error.message : '獲取提醒歷史詳情時發生未知錯誤' 
      });
      return null;
    }
  }
})); 