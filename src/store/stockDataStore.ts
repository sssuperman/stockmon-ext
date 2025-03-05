import { create } from 'zustand';
import { StockInventory, StockCostData, PriceAlert, StockSearchResult } from '../types';
import { useWebSocketStore } from './websocketStore';
import axios from 'axios';
import { useSessionStore } from './sessionStore';
import { WebSocketState } from '../types';
import { urls } from 'src/config';
import { ExtensionContextManager } from '../utilities/contextManager';
import * as vscode from 'vscode';
import { LoggerService, LogCategory } from '../utilities/loggerService';

// Add new interfaces for API responses
interface UserStockResponse {
  stock_symbol: string;
  stock_name: string;
  quantity: number;
  average_cost: number;
  created_at: string;
  updated_at: string;
}

// Add new interfaces
interface SyncQueueItem {
  action: 'add' | 'update' | 'delete';
  symbol: string;
  quantity?: number;
  averageCost?: number;
  timestamp: number;
}

interface StockDataState {
  // 已訂閱的股票資料列表
  stocks: StockInventory[]
  updateStock: (stock: StockInventory) => void
  
  // 清除所有訂閱
  updateStockCost: (symbol: string, cost: StockCostData) => Promise<void>
  removeStockCost: (symbol: string) => void
  addPriceAlert: (symbol: string, alert: PriceAlert) => void
  removePriceAlert: (symbol: string, alert: PriceAlert) => void
  subscribeToAllStocks: () => Promise<void>
  loadFromGlobalState: () => void
  saveToGlobalState: () => void
  searchStocks: (query: string) => Promise<StockSearchResult[]>
  // clearAll: () => void
  // 新增台股指數相關
  twseIndex?: StockInventory;  // 用於存放台股指數資料
  updateTwseIndex: (data: StockInventory) => void;

  // Add new methods for stock portfolio sync
  syncUserStocks: () => Promise<void>;
  updateUserStock: (symbol: string, quantity: number, averageCost: number) => Promise<void>;
  deleteUserStock: (symbol: string) => Promise<void>;

  // Add sync queue related properties and methods
  syncQueue: SyncQueueItem[];
  addToSyncQueue: (item: Omit<SyncQueueItem, 'timestamp'>) => void;
  processSyncQueue: () => Promise<void>;
  clearSyncQueue: () => void;

  // 重新定義這些方法
  subscribeStock: (symbols: string[]) => Promise<void>     // WebSocket 訂閱
  addStock: (symbols: string[]) => Promise<void>          // 高層流程控制
  syncStockToServer: (symbol: string, quantity?: number, averageCost?: number) => Promise<void>  // 後端同步

  // 添加自動同步相關的屬性和方法
  autoSyncEnabled: boolean;
  autoSyncInterval: number;
  lastSyncTime: number | null;
  startAutoSync: () => void;
  stopAutoSync: () => void;
  checkAndSync: () => Promise<void>;

  // 修改移除相關的方法定義
  unsubscribeStock: (symbol: string) => Promise<void>;     // WebSocket 取消訂閱
  removeStock: (symbol: string) => Promise<void>;          // 高層流程控制
  deleteStockFromServer: (symbol: string) => Promise<void>;  // 後端同步刪除

  // 添加同步用戶股票的方法
  syncUserStocksFromServer: () => Promise<StockInventory[] | void>;  // 從服務器獲取並同步用戶股票

  // 添加計算總損益的方法
  calculateTotalProfit: () => { totalProfit: number; hasPositions: boolean };
}

export const useStockDataStore = create<StockDataState>()((set, get) => ({
  // 已訂閱的股票資料陣列
  stocks: Array<StockInventory>(),

  // 新增台股指數相關的實作
  twseIndex: undefined,

  updateTwseIndex: (indexData: StockInventory) => set((state) => ({
    twseIndex: {
      ...indexData,
      symbol: 'IX0001',
      name: '發行量加權股價指數',
      type: 'index',
      isRealtime: true,
    }
  })),

  updateStock: (stockData: StockInventory) => set((state) => {
    // 如果是台股指數的更新
    if (stockData.symbol === 'IX0001') {
      return {
        ...state,
        twseIndex: {
          ...stockData,
          name: '發行量加權股價指數',
          type: 'index',
          isRealtime: true,
        }
      };
    }

    // 原有的股票更新邏輯
    return {
      stocks: state.stocks.map((stock: StockInventory) =>
        stock.symbol === stockData.symbol
          ? {
            ...stock,
            ...stockData,
            cost: stock.cost,
            alerts: stock.alerts,
            profit: stock.cost
              ? (stockData.price - stock.cost.averageCost) * stock.cost.quantity
              : undefined,
            profitPercent: stock.cost
              ? ((stockData.price - stock.cost.averageCost) / stock.cost.averageCost) * 100
              : undefined,
          }
          : stock
      )
    };
  }),

  updateStockCost: async (symbol: string, cost: StockCostData) => {
    const logger = LoggerService.getInstance();
    const context = ExtensionContextManager.getContext();
    
    try {
      // 檢查股票是否存在
      const stockExists = get().stocks.some(s => s.symbol === symbol);
      if (!stockExists) {
        const error = new Error(`Stock ${symbol} not found in current stocks list`);
        logger.logError(LogCategory.STOCK_DATA, error, error.message);
        throw error;
      }

      // 更新本地狀態
      set((state) => ({
        stocks: state.stocks.map(s =>
          s.symbol === symbol ? {
            ...s,
            cost,
            // 更新獲利資訊
            profit: (s.price - cost.averageCost) * cost.quantity,
            profitPercent: ((s.price - cost.averageCost) / cost.averageCost) * 100
          } : s
        )
      }));

      // 保存到全局狀態
      context.globalState.update('stocks', get().stocks);

      // 同步到服務器
      if (useSessionStore.getState().authToken) {
        await get().syncStockToServer(symbol, cost.quantity, cost.averageCost);
      } else {
        get().addToSyncQueue({
          action: 'update',
          symbol,
          quantity: cost.quantity,
          averageCost: cost.averageCost
        });
      }

      logger.log(LogCategory.STOCK_DATA, `Successfully updated cost for ${symbol}`);
    } catch (error) {
      logger.logError(LogCategory.STOCK_DATA, error, 'Failed to update stock cost');
      throw error;
    }
  },

  removeStockCost: (symbol) => set((state) => ({
    stocks: state.stocks.map(s => {
      if (s.symbol === symbol) {
        const { cost, ...stockWithoutCost } = s;
        return stockWithoutCost;
      }
      return s;
    })
  })),

  addPriceAlert: (symbol, alert) => set((state) => ({
    stocks: state.stocks.map(s =>
      s.symbol === symbol ? { ...s, alerts: [...s.alerts, alert] } : s
    )
  })),

  removePriceAlert: (symbol, alert) => set((state) => ({
    stocks: state.stocks.map(s =>
      s.symbol === symbol ? {
        ...s,
        alerts: s.alerts.filter(a =>
          !(a.price === alert.price && a.type === alert.type)
        )
      } : s
    )
  })),

  subscribeToAllStocks: async () => {
    const logger = LoggerService.getInstance();
    const { wsState } = useWebSocketStore.getState();
    
    try {
      const savedStocks = ExtensionContextManager.getContext().globalState.get<StockInventory[]>('stocks', []);
      logger.debug(LogCategory.STOCK_DATA, `Local Saved stocks: ${JSON.stringify(savedStocks)}`);

      // Subscribe to each stock individually
      const symbolsList = savedStocks.map(stock => stock.symbol);

      try {
        await useStockDataStore.getState().subscribeStock(symbolsList);
      } catch (error) {
        logger.logError(LogCategory.STOCK_DATA, error, `Failed to subscribe to ${symbolsList}`);
        // Continue with next stock even if one fails

      }

    } catch (error) {
      logger.logError(LogCategory.STOCK_DATA, error, 'Failed to subscribe to all stocks');
      throw error;
    }
  },

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

  syncUserStocks: async () => {
    try {
      const headers = {
        'Authorization': `Bearer ${useSessionStore.getState().authToken}`,
        'Content-Type': 'application/json',
      };

      const response = await axios.get<UserStockResponse[]>(`${urls.stocks.list}`, { headers });

      set((state) => {
        const updatedStocks = state.stocks.map(stock => {
          const userStock = response.data.find(us => us.stock_symbol === stock.symbol);
          if (userStock) {
            return {
              ...stock,
              cost: {
                cost: userStock.average_cost,  // 確保符合 StockCostData 介面
                quantity: userStock.quantity,
                averageCost: userStock.average_cost
              }
            } as StockInventory;
          }
          return stock;
        });

        const context = ExtensionContextManager.getContext();
        context.globalState.update('stocks', updatedStocks);

        return { stocks: updatedStocks };
      });
    } catch (error) {
      console.error('Failed to sync user stocks:', error);
      throw error;
    }
  },

  updateUserStock: async (symbol: string, quantity: number, averageCost: number) => {
    try {
      const headers = {
        'Authorization': `Bearer ${useSessionStore.getState().authToken}`,
        'Content-Type': 'application/json',
      };

      const response = await axios.put<UserStockResponse>(
        `${urls.stocks.update(symbol)}`,
        {
          stock_id: symbol,
          quantity,
          average_cost: averageCost
        },
        { headers }
      );

      set((state) => {
        const updatedStocks = state.stocks.map(stock => {
          if (stock.symbol === symbol) {
            return {
              ...stock,
              cost: {
                cost: response.data.average_cost,  // 確保符合 StockCostData 介面
                quantity: response.data.quantity,
                averageCost: response.data.average_cost
              }
            } as StockInventory;
          }
          return stock;
        });

        const context = ExtensionContextManager.getContext();
        context.globalState.update('stocks', updatedStocks);

        return { stocks: updatedStocks };
      });
    } catch (error) {
      if (error instanceof Error && (
        error.message.includes('Network Error') ||
        error.message.includes('Failed to fetch')
      )) {
        get().addToSyncQueue({
          action: 'update',
          symbol,
          quantity,
          averageCost
        });
      }
      console.error('Failed to update user stock:', error);
      throw error;
    }
  },

  deleteUserStock: async (symbol: string) => {
    try {
      const headers = {
        'Authorization': `Bearer ${useSessionStore.getState().authToken}`,
        'Content-Type': 'application/json',
      };

      await axios.delete(
        `${urls.stocks.delete(symbol)}`,
        { headers }
      );

      set((state) => {
        const updatedStocks = state.stocks.map(stock => {
          if (stock.symbol === symbol) {
            const { cost, ...stockWithoutCost } = stock;
            return stockWithoutCost;
          }
          return stock;
        });

        const context = ExtensionContextManager.getContext();
        context.globalState.update('stocks', updatedStocks);

        return { stocks: updatedStocks };
      });
    } catch (error) {
      if (error instanceof Error && (
        error.message.includes('Network Error') ||
        error.message.includes('Failed to fetch')
      )) {
        get().addToSyncQueue({
          action: 'delete',
          symbol
        });
      }
      console.error('Failed to delete user stock:', error);
      throw error;
    }
  },

  syncQueue: [],

  addToSyncQueue: (item: Omit<SyncQueueItem, 'timestamp'>) => {
    set((state) => {
      const newQueue = [...state.syncQueue, { ...item, timestamp: Date.now() }];

      // Save to global state
      const context = ExtensionContextManager.getContext();
      context.globalState.update('syncQueue', newQueue);

      return { syncQueue: newQueue };
    });
  },

  processSyncQueue: async () => {
    const logger = LoggerService.getInstance();
    const queue = [...get().syncQueue];
    
    try {
      if (queue.length === 0) return;

      logger.log(LogCategory.SYNC, `Processing ${queue.length} items in sync queue`);

      for (const item of queue) {
        try {
          logger.log(LogCategory.SYNC, `Processing item: ${JSON.stringify(item)}`);

          switch (item.action) {
            case 'add':
              logger.log(LogCategory.SYNC, `Adding stock ${item.symbol}`);
              await get().syncStockToServer(
                item.symbol,
                item.quantity || 0,
                item.averageCost || 0
              );
              break;

            case 'update':
              logger.log(LogCategory.SYNC, `Updating stock ${item.symbol}`);
              await get().updateUserStock(
                item.symbol,
                item.quantity || 0,
                item.averageCost || 0
              );
              break;

            case 'delete':
              logger.log(LogCategory.SYNC, `Deleting stock ${item.symbol}`);
              await get().deleteUserStock(item.symbol);
              break;
          }
          logger.log(LogCategory.SYNC, `Successfully processed item for ${item.symbol}`);
        } catch (error) {
          logger.logError(LogCategory.SYNC, error, `Error processing item ${item.symbol}`);
        }
      }

      // 清除已處理的隊列
      get().clearSyncQueue();
      logger.log(LogCategory.SYNC, 'Sync queue processing completed successfully');
    } catch (error) {
      logger.logError(LogCategory.SYNC, error, 'Failed to process sync queue');
      throw error;
    }
  },

  clearSyncQueue: () => {
    const context = ExtensionContextManager.getContext();
    context.globalState.update('syncQueue', []);
    set({ syncQueue: [] });
  },

  // 1. WebSocket 訂閱專用方法
  subscribeStock: async (symbols: string[]) => {
    const logger = LoggerService.getInstance();
    const { wsState } = useWebSocketStore.getState();
    
    try {
      const response = await useWebSocketStore.getState().sendAndWait(
        { action: 'subscribe', symbols },
        (message) => message.type === 'subscription_success',
        5000
      );

      set((state) => ({
        stocks: state.stocks.map(stock => 
          symbols.includes(stock.symbol) 
            ? { ...stock, isSubscribed: true }
            : stock
        )
      }));

      return response;
    } catch (error) {
      logger.logError(LogCategory.STOCK_DATA, error, 'WebSocket subscription failed');
      throw error;
    }
  },

  // 2. 整體添加股票的流程控制
  addStock: async (symbols: string[]) => {
    const logger = LoggerService.getInstance();
    const context = ExtensionContextManager.getContext();

    try {
      // 檢查是否已存在
      const existingStocks = get().stocks;
      const newSymbols = symbols.filter(symbol => 
        !existingStocks.some(stock => stock.symbol === symbol)
      );

      if (newSymbols.length === 0) {
        logger.log(LogCategory.STOCK_DATA, 'All stocks already exist in the list');
        return;
      }

      // 1. 先添加到本地狀態
      set((state) => {
        const newStocks = newSymbols.map(symbol => createNewStock(symbol));
        const updatedStocks = [...state.stocks, ...newStocks];
        context.globalState.update('stocks', updatedStocks);
        return { stocks: updatedStocks };
      });

      // 2. 建立 WebSocket 訂閱
      await get().subscribeStock(newSymbols);

      // 3. 處理後端同步
      if (useSessionStore.getState().authToken) {
        await Promise.all(newSymbols.map(symbol => 
          get().syncStockToServer(symbol)
        ));
      } else {
        newSymbols.forEach(symbol => {
          get().addToSyncQueue({
            action: 'add',
            symbol
          });
        });
      }
    } catch (error) {
      logger.logError(LogCategory.STOCK_DATA, error, 'Failed to add stock');
      throw error;
    }
  },

  // 3. 同步到服務器的專用方法
  syncStockToServer: async (symbol: string, quantity = 0, averageCost = 0) => {
    try {
      const headers = {
        'Authorization': `Bearer ${useSessionStore.getState().authToken}`,
        'Content-Type': 'application/json',
      };

      await axios.post(
        urls.stocks.create,
        {
          stock_id: symbol,
          quantity,
          average_cost: averageCost
        },
        { headers }
      );
    } catch (error) {
      get().addToSyncQueue({
        action: 'add',
        symbol,
        quantity,
        averageCost
      });
      throw error;
    }
  },

  // 自動同步相關的狀態
  autoSyncEnabled: false,
  autoSyncInterval: 1 * 60 * 1000, // 預設 1 分鐘
  lastSyncTime: null,

  // 檢查並執行同步
  checkAndSync: async () => {
    const logger = LoggerService.getInstance();
    const queue = get().syncQueue;
    const now = Date.now();
    const lastSync = get().lastSyncTime;

    // 如果隊列為空，只更新最後同步時間
    if (queue.length === 0) {
      set({ lastSyncTime: now });
      return;
    }

    try {
      logger.log(LogCategory.SYNC, 'Periodic sync: processing queue...');
      await get().processSyncQueue();
      set({ lastSyncTime: now });
      logger.log(LogCategory.SYNC, 'Periodic sync completed successfully');
    } catch (error) {
      logger.logError(LogCategory.SYNC, error, 'Periodic sync failed');
      // 不更新 lastSyncTime，這樣下次檢查時會重試
    }
  },

  // 改進的開始自動同步
  startAutoSync: () => {
    const logger = LoggerService.getInstance();
    
    // 如果已經啟用，先停止
    if (get().autoSyncEnabled) {
      get().stopAutoSync();
    }

    // 設置啟用狀態
    set({ autoSyncEnabled: true });

    // 定義週期性檢查函數
    const periodicCheck = async () => {
      if (!get().autoSyncEnabled) {
        return;
      }

      // 檢查是否已登入
      if (!useSessionStore.getState().authToken) {
        logger.log(LogCategory.SYNC, 'Auto sync: User not logged in, stopping sync');
        get().stopAutoSync();
        return;
      }

      await get().checkAndSync();

      // 設置下次檢查
      setTimeout(periodicCheck, get().autoSyncInterval);
    };

    // 立即執行一次檢查，然後開始週期性檢查
    logger.log(LogCategory.SYNC, 'Starting auto sync...');
    periodicCheck().catch(error => {
      logger.logError(LogCategory.SYNC, error, 'Error in periodic check');
    });
  },

  // 改進的停止自動同步
  stopAutoSync: () => {
    const logger = LoggerService.getInstance();
    set({ 
      autoSyncEnabled: false,
      lastSyncTime: null 
    });
    logger.log(LogCategory.SYNC, 'Auto sync stopped');
  },

  // 1. WebSocket 取消訂閱專用方法
  unsubscribeStock: async (symbol: string) => {
    const logger = LoggerService.getInstance();
    const { wsState } = useWebSocketStore.getState();

    if (wsState !== WebSocketState.CONNECTED) {
      throw new Error('WebSocket not connected');
    }

    try {
      const response = await useWebSocketStore.getState().sendAndWait(
        {
          action: 'unsubscribe',
          symbols: [symbol],
        },
        (message) => message.type === 'unsubscription_success',
        5000
      );

      set((state) => ({
        stocks: state.stocks.map(stock => 
          stock.symbol === symbol 
            ? { ...stock, isSubscribed: false }
            : stock
        )
      }));

      logger.log(LogCategory.STOCK_DATA, `Unsubscription confirmed for ${symbol}`);
      return response;
    } catch (error) {
      logger.logError(LogCategory.STOCK_DATA, error, 'Unsubscription error');
      throw error;
    }
  },

  // 2. 整體移除股票的流程控制
  removeStock: async (symbol: string): Promise<void> => {
    const logger = LoggerService.getInstance();
    const context = ExtensionContextManager.getContext();

    try {
      // 1. 先取消 WebSocket 訂閱
      await get().unsubscribeStock(symbol);

      // 2. 更新本地狀態
      set((state) => {
        const newStocks = state.stocks.filter(s => s.symbol !== symbol);
        context.globalState.update('stocks', newStocks);
        return { stocks: newStocks };
      });

      // 3. 同步到服務器
      if (useSessionStore.getState().authToken) {
        await get().deleteStockFromServer(symbol);
      } else {
        get().addToSyncQueue({
          action: 'delete',
          symbol
        });
      }

      logger.log(LogCategory.STOCK_DATA, `Successfully removed stock: ${symbol}`);
    } catch (error) {
      logger.logError(LogCategory.STOCK_DATA, error, 'Failed to remove stock');
      throw error;
    }
  },

  // 3. 從服務器刪除股票
  deleteStockFromServer: async (symbol: string) => {
    try {
      const headers = {
        'Authorization': `Bearer ${useSessionStore.getState().authToken}`,
        'Content-Type': 'application/json',
      };

      await axios.delete(urls.stocks.delete(symbol), { headers });
    } catch (error) {
      get().addToSyncQueue({
        action: 'delete',
        symbol
      });
      throw error;
    }
  },

  // 從服務器獲取並同步用戶股票
  syncUserStocksFromServer: async () => {
    const logger = LoggerService.getInstance();
    
    try {
      logger.log(LogCategory.SYNC, 'Syncing user stocks from server...');
      
      // 檢查是否有 token
      const authToken = useSessionStore.getState().authToken;
      if (!authToken) {
        logger.log(LogCategory.SYNC, 'No auth token found, skipping sync');
        return;
      }
      
      // 從服務器獲取股票列表
      const response = await axios.get<UserStockResponse[]>(`${urls.stocks.list}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      logger.log(LogCategory.SYNC, `Received ${response.data.length} stocks from server`);
      
      // 獲取當前本地股票列表
      const currentStocks = get().stocks;
      const context = ExtensionContextManager.getContext();

      // 更新本地狀態
      let updatedStockList: StockInventory[] = [];
      
      set((state) => {
        // 更新現有股票的成本信息
        const updatedStocks = currentStocks.map(stock => {
          const serverStock = response.data.find((s: UserStockResponse) => s.stock_symbol === stock.symbol);
          if (serverStock) {
            return {
              ...stock,
              cost: serverStock.average_cost !== null ? {
                averageCost: serverStock.average_cost,
                quantity: serverStock.quantity,
                cost: serverStock.average_cost
              } : undefined
            };
          }
          return stock;
        });

        // 添加本地不存在但服務器有的股票
        const newStocks = response.data
          .filter((serverStock: UserStockResponse) => 
            !currentStocks.some(localStock => localStock.symbol === serverStock.stock_symbol)
          )
          .map((serverStock: UserStockResponse) => ({
            ...createNewStock(serverStock.stock_symbol),
            cost: serverStock.average_cost !== null ? {
              averageCost: serverStock.average_cost,
              quantity: serverStock.quantity,
              cost: serverStock.average_cost
            } : undefined
          }));

        const finalStocks = [...updatedStocks, ...newStocks];
        
        // 保存到全局狀態
        context.globalState.update('stocks', finalStocks);
        logger.log(LogCategory.SYNC, `Updated store with ${finalStocks.length} stocks (${newStocks.length} new)`);
        
        updatedStockList = finalStocks;
        return { stocks: finalStocks };
      });

      // 訂閱新增的股票
      const newSymbols = response.data
        .filter((serverStock: UserStockResponse) => 
          !currentStocks.some(localStock => localStock.symbol === serverStock.stock_symbol)
        )
        .map((stock: UserStockResponse) => stock.stock_symbol);

      if (newSymbols.length > 0) {
        logger.log(LogCategory.SYNC, `Subscribing to ${newSymbols.length} new stocks`);
        await get().subscribeStock(newSymbols);
      }

      return updatedStockList;
    } catch (error) {
      logger.logError(LogCategory.SYNC, error, 'Error syncing user stocks');
      throw error;
    }
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
}));

// Helper function for creating new stock
function createNewStock(symbol: string): StockInventory {
  return {
    symbol,
    name: symbol,
    price: 0,
    change: 0,
    changePercent: 0,
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    volume: 0,
    value: 0,
    avgPrice: 0,
    amplitude: 0,
    date: new Date().toISOString().split('T')[0],
    time: new Date().toLocaleString(),
    serial: Date.now(),
    isRealtime: false,
    type: 'stock',
    exchange: '',
    market: '',
    isSubscribed: true,
    alerts: [],
    cost: undefined
  };
}