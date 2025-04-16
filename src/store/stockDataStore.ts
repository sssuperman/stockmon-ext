import { create } from 'zustand';
import { StockInventory, StockSearchResult, StockAlert } from '../types';
import axios from 'axios';
import { useSessionStore } from './sessionStore';
import { urls } from 'src/config';
import { ExtensionContextManager } from '../utilities/contextManager';

// Add new interfaces
interface SyncQueueItem {
  action: 'add' | 'update' | 'delete';
  symbol: string;
  quantity?: number;
  averageCost?: number;
  timestamp: number;
  version?: number;
  last_sync_timestamp?: number;
}

interface StockDataState {
  // 已訂閱的股票資料列表
  stocks: StockInventory[]
  // 清除所有訂閱
  loadFromGlobalState: () => void
  saveToGlobalState: () => void
  searchStocks: (query: string) => Promise<StockSearchResult[]>
  twseIndex?: StockInventory;  // 用於存放台股指數資料
  // Add sync queue related properties and methods
  syncQueue: SyncQueueItem[];
  // 添加自動同步相關的屬性和方法
  autoSyncEnabled: boolean;
  autoSyncInterval: number;
  lastSyncTime: number | null;
  // 修改移除相關的方法定義     // WebSocket 取消訂閱
  calculateTotalProfit: () => { totalProfit: number; hasPositions: boolean };
  // 添加警報相關方法
  addAlertToStock: (symbol: string, alert: StockAlert) => void;
}


export const useStockDataStore = create<StockDataState>()((set, get) => ({
  // 已訂閱的股票資料陣列
  stocks: Array<StockInventory>(),
  // 自動同步相關的狀態
  autoSyncEnabled: false,
  autoSyncInterval: 5 * 60 * 1000,
  lastSyncTime: null,
  twseIndex: undefined,
  syncQueue: [],
  loadFromGlobalState: () => {
    const context = ExtensionContextManager.getContext();
    try {
      const savedData = context.globalState.get<StockInventory[]>('stocks', []);
      const savedQueue = context.globalState.get<SyncQueueItem[]>('syncQueue', []);

      if (savedData && Array.isArray(savedData)) {
        set({ stocks: savedData });
      }

      if (savedQueue && Array.isArray(savedQueue)) {
        set({ syncQueue: savedQueue });
      }

      console.log('Loaded from global state:', { stocks: savedData, syncQueue: savedQueue });
    } catch (error) {
      console.error('Error loading data from global state:', error);
    }
  },
  saveToGlobalState: () => {
    const context = ExtensionContextManager.getContext();
    try {
      const currentStocks = get().stocks;
      context.globalState.update('stocks', currentStocks);
      console.log('Saved data to global state:', { stocks: currentStocks });
    } catch (error) {
      console.error('Error saving data to global state:', error);
    }
  },
  searchStocks: async (query: string): Promise<StockSearchResult[]> => {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-UUID': useSessionStore.getState().clientUuid
    };

    if (useSessionStore.getState().authToken) {
      headers['Authorization'] = `Bearer ${useSessionStore.getState().authToken}`;
    }

    const response = await axios.get(urls.stocks.search, {
      params: { query: query.trim() },
      headers,
      timeout: 10000
    });

    return response.data?.items || [];
  },
  // 實現計算總損益的方法
  calculateTotalProfit: () => {
    const stocks = get().stocks;
    let totalProfit = 0;
    let hasPositions = false;

    stocks.forEach(stock => {
      if (stock.cost && stock.profit !== undefined) {
        totalProfit += stock.profit;
        hasPositions = true;
      }
    });
    return { totalProfit, hasPositions };
  },
  // 添加股票警報
  addAlertToStock: (symbol: string, alert: StockAlert) => {
    const { stocks } = get();
    const stockIndex = stocks.findIndex(stock => stock.symbol === symbol);
    
    if (stockIndex >= 0) {
      const updatedStocks = [...stocks];
      
      // 確保 alerts 數組存在
      if (!updatedStocks[stockIndex].alerts) {
        updatedStocks[stockIndex].alerts = [];
      }
      
      // 檢查是否已存在相同 ID 的警報，如果存在則更新
      const existingAlertIndex = updatedStocks[stockIndex].alerts.findIndex(
        existingAlert => 'id' in existingAlert && existingAlert.id === alert.id
      );
      
      if (existingAlertIndex >= 0) {
        // 更新現有警報
        updatedStocks[stockIndex].alerts[existingAlertIndex] = alert;
      } else {
        // 添加新警報到數組
        updatedStocks[stockIndex].alerts.push(alert);
      }
      
      set({ stocks: updatedStocks });
      get().saveToGlobalState();
      
      console.log(`Alert added/updated for ${symbol}:`, alert);
    } else {
      console.warn(`Cannot add alert: Stock ${symbol} not found in store`);
    }
  }
}));

