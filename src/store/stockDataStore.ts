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
  is_cost_set: boolean;
  is_quantity_set: boolean;
  version: number;
  last_sync_timestamp: number;
  client_uuid: string | null;
  has_conflict: boolean;
  conflict_resolution?: string;
}

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
    const sessionStore = useSessionStore.getState();
    
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

      // 同步到服務器 - 只有在用戶已登入時才直接同步
      if (sessionStore.isAuthenticated && sessionStore.authToken) {
        logger.log(LogCategory.SYNC, `User authenticated, syncing stock ${symbol} directly to server`);
        await get().syncStockToServer(symbol, cost.quantity, cost.averageCost);
      } else {
        logger.log(LogCategory.SYNC, `User not authenticated, adding stock ${symbol} to sync queue`);
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
      // 如果同步失敗，添加到同步隊列
      get().addToSyncQueue({
        action: 'update',
        symbol,
        quantity: cost.quantity,
        averageCost: cost.averageCost
      });
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
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    try {
      if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
        logger.log(LogCategory.SYNC, `User not authenticated, adding stock ${symbol} to sync queue`);
        get().addToSyncQueue({
          action: 'update',
          symbol,
          quantity,
          averageCost
        });
        return;
      }

      // 獲取當前時間戳和客戶端UUID
      const currentTimestamp = Date.now();
      const clientUuid = sessionStore.clientUuid;
      
      // 查找本地股票數據，獲取版本信息
      const stock = get().stocks.find(s => s.symbol === symbol);
      const version = stock?.syncVersion || 1;
      const lastSyncTimestamp = stock?.lastSyncTimestamp || 0;

      // 處理台灣股票代號 - 不需要在客戶端進行格式化，因為伺服器端會處理
      // 保持原始代號，讓伺服器端根據規則處理
      const stockId = symbol;

      const headers = {
        'Authorization': `Bearer ${useSessionStore.getState().authToken}`,
        'Content-Type': 'application/json',
        'X-Client-UUID': clientUuid
      };

      logger.log(LogCategory.SYNC, `Updating stock ${symbol} with version ${version} and timestamp ${lastSyncTimestamp}`);

      const response = await axios.put<UserStockResponse>(
        `${urls.stocks.update(stockId)}`,
        {
          stock_id: stockId,
          quantity,
          average_cost: averageCost,
          version,
          last_sync_timestamp: lastSyncTimestamp,
          client_uuid: clientUuid
        },
        { headers }
      );

      // 檢查是否有衝突
      if (response.status === 409 && response.data.has_conflict) {
        logger.log(LogCategory.SYNC, `Conflict detected for ${symbol}: ${response.data.conflict_resolution}`);
        
        // 使用伺服器數據更新本地狀態
        set((state) => {
          const updatedStocks = state.stocks.map(stock => {
            if (stock.symbol === symbol) {
              return {
                ...stock,
                cost: {
                  cost: response.data.average_cost,
                  quantity: response.data.quantity,
                  averageCost: response.data.average_cost
                },
                syncVersion: response.data.version,
                lastSyncTimestamp: response.data.last_sync_timestamp
              } as StockInventory;
            }
            return stock;
          });

          const context = ExtensionContextManager.getContext();
          context.globalState.update('stocks', updatedStocks);

          return { stocks: updatedStocks };
        });
        
        // 通知用戶衝突已解決
        vscode.window.showInformationMessage(`股票 ${symbol} 資料已從伺服器更新，解決了資料衝突`);
        return;
      }

      // 正常更新
      set((state) => {
        const updatedStocks = state.stocks.map(stock => {
          if (stock.symbol === symbol) {
            return {
              ...stock,
              cost: {
                cost: response.data.average_cost,
                quantity: response.data.quantity,
                averageCost: response.data.average_cost
              },
              syncVersion: response.data.version,
              lastSyncTimestamp: response.data.last_sync_timestamp
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
        // 添加到同步隊列，但不包含 timestamp 欄位，因為 addToSyncQueue 會自動添加
        get().addToSyncQueue({
          action: 'update',
          symbol,
          quantity,
          averageCost
        });
      }
      logger.logError(LogCategory.STOCK_DATA, error, 'Failed to update user stock');
      throw error;
    }
  },

  deleteUserStock: async (symbol: string) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    try {
      if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
        logger.log(LogCategory.SYNC, `User not authenticated, adding stock ${symbol} to sync queue for deletion`);
        get().addToSyncQueue({
          action: 'delete',
          symbol
        });
        return;
      }

      // 處理台灣股票代號 - 不需要在客戶端進行格式化，因為伺服器端會處理
      // 保持原始代號，讓伺服器端根據規則處理
      const stockId = symbol;

      const headers = {
        'Authorization': `Bearer ${useSessionStore.getState().authToken}`,
        'Content-Type': 'application/json',
        'X-Client-UUID': sessionStore.clientUuid
      };

      await axios.delete(
        `${urls.stocks.delete(stockId)}`,
        { headers }
      );

      // 更新本地狀態，移除成本信息
      set((state) => {
        const updatedStocks = state.stocks.map(stock => {
          if (stock.symbol === symbol) {
            const { cost, syncVersion, lastSyncTimestamp, clientUuid, ...stockWithoutCost } = stock;
            return stockWithoutCost as StockInventory;
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
      logger.logError(LogCategory.STOCK_DATA, error, `Failed to delete user stock: ${symbol}`);
      throw error;
    }
  },

  syncQueue: [],

  addToSyncQueue: (item: Omit<SyncQueueItem, 'timestamp'>) => {
    const logger = LoggerService.getInstance();
    
    set((state) => {
      // 檢查是否已有相同股票的操作在隊列中
      const existingItemIndex = state.syncQueue.findIndex(
        queueItem => queueItem.symbol === item.symbol && queueItem.action === item.action
      );
      
      let newQueue: SyncQueueItem[];
      
      if (existingItemIndex >= 0) {
        // 如果已存在，更新該項目
        logger.log(LogCategory.SYNC, `Updating existing queue item for ${item.symbol}`);
        newQueue = [...state.syncQueue];
        newQueue[existingItemIndex] = { 
          ...item, 
          timestamp: Date.now() 
        };
      } else {
        // 如果不存在，添加新項目
        logger.log(LogCategory.SYNC, `Adding new queue item for ${item.symbol}`);
        newQueue = [...state.syncQueue, { ...item, timestamp: Date.now() }];
      }

      // 保存到全局狀態
      const context = ExtensionContextManager.getContext();
      context.globalState.update('syncQueue', newQueue);

      return { syncQueue: newQueue };
    });
  },

  processSyncQueue: async () => {
    const logger = LoggerService.getInstance();
    const queue = [...get().syncQueue];
    const sessionStore = useSessionStore.getState();
    
    try {
      if (queue.length === 0) return;

      // 檢查用戶是否已登入
      if (!useSessionStore.getState().isAuthenticated || !useSessionStore.getState().authToken) {
        logger.log(LogCategory.SYNC, 'User not authenticated, skipping sync queue processing');
        return;
      }

      logger.log(LogCategory.SYNC, `Processing ${queue.length} items in sync queue`);

      // 按時間戳排序，確保按正確順序處理
      const sortedQueue = [...queue].sort((a, b) => a.timestamp - b.timestamp);

      for (const item of sortedQueue) {
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
          
          // 處理成功後，從隊列中移除該項目
          set((state) => {
            const updatedQueue = state.syncQueue.filter(
              queueItem => !(queueItem.symbol === item.symbol && queueItem.action === item.action)
            );
            
            // 更新全局狀態
            const context = ExtensionContextManager.getContext();
            context.globalState.update('syncQueue', updatedQueue);
            
            return { syncQueue: updatedQueue };
          });
        } catch (error) {
          logger.logError(LogCategory.SYNC, error, `Error processing item ${item.symbol}`);
          // 失敗的項目保留在隊列中，下次再嘗試
        }
      }

      logger.log(LogCategory.SYNC, 'Sync queue processing completed');
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
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    try {
      if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
        logger.log(LogCategory.SYNC, `User not authenticated, adding stock ${symbol} to sync queue`);
        get().addToSyncQueue({
          action: 'add',
          symbol,
          quantity,
          averageCost
        });
        return;
      }

      // 獲取當前時間戳和客戶端UUID
      const currentTimestamp = Date.now();
      const clientUuid = sessionStore.clientUuid;
      
      // 查找本地股票數據，獲取版本信息
      const stock = get().stocks.find(s => s.symbol === symbol);
      const version = stock?.syncVersion || 1;
      const lastSyncTimestamp = stock?.lastSyncTimestamp || 0;

      // 處理台灣股票代號 - 不需要在客戶端進行格式化，因為伺服器端會處理
      // 保持原始代號，讓伺服器端根據規則處理
      const stockId = symbol;

      const headers = {
        'Authorization': `Bearer ${useSessionStore.getState().authToken}`,
        'Content-Type': 'application/json',
        'X-Client-UUID': clientUuid
      };

      logger.log(LogCategory.SYNC, `Syncing stock ${symbol} with version ${version} and timestamp ${lastSyncTimestamp}`);

      const response = await axios.post<UserStockResponse>(
        urls.stocks.create,
        {
          stock_id: stockId,
          quantity,
          average_cost: averageCost,
          version,
          last_sync_timestamp: lastSyncTimestamp,
          client_uuid: clientUuid
        },
        { headers }
      );

      // 檢查是否有衝突
      if (response.status === 409 && response.data.has_conflict) {
        logger.log(LogCategory.SYNC, `Conflict detected for ${symbol}: ${response.data.conflict_resolution}`);
        
        // 使用伺服器數據更新本地狀態
        set((state) => {
          const updatedStocks = state.stocks.map(stock => {
            if (stock.symbol === symbol) {
              return {
                ...stock,
                cost: response.data.average_cost !== null ? {
                  cost: response.data.average_cost,
                  quantity: response.data.quantity,
                  averageCost: response.data.average_cost
                } : undefined,
                syncVersion: response.data.version,
                lastSyncTimestamp: response.data.last_sync_timestamp
              } as StockInventory;
            }
            return stock;
          });

          const context = ExtensionContextManager.getContext();
          context.globalState.update('stocks', updatedStocks);

          return { stocks: updatedStocks };
        });
        
        // 通知用戶衝突已解決
        vscode.window.showInformationMessage(`股票 ${symbol} 資料已從伺服器更新，解決了資料衝突`);
        return;
      }

      // 正常更新本地狀態
      set((state) => {
        const updatedStocks = state.stocks.map(stock => {
          if (stock.symbol === symbol) {
            return {
              ...stock,
              syncVersion: response.data.version,
              lastSyncTimestamp: response.data.last_sync_timestamp,
              cost: response.data.average_cost !== null ? {
                cost: response.data.average_cost,
                quantity: response.data.quantity,
                averageCost: response.data.average_cost
              } : stock.cost
            };
          }
          return stock;
        });

        const context = ExtensionContextManager.getContext();
        context.globalState.update('stocks', updatedStocks);

        return { stocks: updatedStocks };
      });
    } catch (error) {
      logger.logError(LogCategory.STOCK_DATA, error, `Failed to sync stock ${symbol} to server`);
      // 添加到同步隊列，但不包含 timestamp 欄位，因為 addToSyncQueue 會自動添加
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
  autoSyncInterval: 5 * 60 * 1000, // 預設 5 分鐘
  lastSyncTime: null,

  // 改進的檢查並執行同步方法，依賴伺服器端的衝突解決
  checkAndSync: async () => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    const now = Date.now();
    const lastSync = get().lastSyncTime;
    
    // 檢查用戶是否已登入
    if (!useSessionStore.getState().isAuthenticated || !useSessionStore.getState().authToken) {
      logger.log(LogCategory.SYNC, 'User not authenticated, skipping sync');
      get().stopAutoSync(); // 如果用戶未登入，停止自動同步
      return;
    }

    try {
      // 先處理同步隊列
      const queue = get().syncQueue;
      if (queue.length > 0) {
        logger.log(LogCategory.SYNC, 'Processing sync queue before server sync');
        await get().processSyncQueue();
      }

      // 然後從服務器同步最新數據
      logger.log(LogCategory.SYNC, 'Syncing data from server');
      await get().syncUserStocksFromServer();
      
      // 更新最後同步時間
      set({ lastSyncTime: now });
      logger.log(LogCategory.SYNC, `Sync completed, updated lastSyncTime to ${new Date(now).toISOString()}`);
    } catch (error) {
      logger.logError(LogCategory.SYNC, error, 'Periodic sync failed');
      // 不更新 lastSyncTime，這樣下次檢查時會重試
    }
  },

  // 改進的開始自動同步方法
  startAutoSync: () => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    // 檢查用戶是否已登入
    if (!useSessionStore.getState().isAuthenticated || !useSessionStore.getState().authToken) {
      logger.log(LogCategory.SYNC, 'User not authenticated, not starting auto sync');
      return;
    }
    
    // 如果已經啟用，先停止
    if (get().autoSyncEnabled) {
      get().stopAutoSync();
    }

    // 設置啟用狀態
    set({ autoSyncEnabled: true });
    logger.log(LogCategory.SYNC, `Starting auto sync with interval ${get().autoSyncInterval}ms`);

    // 定義週期性檢查函數
    const periodicCheck = async () => {
      if (!get().autoSyncEnabled) {
        logger.log(LogCategory.SYNC, 'Auto sync disabled, stopping periodic check');
        return;
      }

      // 檢查是否已登入
      if (!useSessionStore.getState().isAuthenticated || !useSessionStore.getState().authToken) {
        logger.log(LogCategory.SYNC, 'User not authenticated, stopping auto sync');
        get().stopAutoSync();
        return;
      }

      logger.log(LogCategory.SYNC, 'Running periodic sync check');
      await get().checkAndSync();

      // 設置下次檢查
      setTimeout(periodicCheck, get().autoSyncInterval);
    };

    // 立即執行一次檢查，然後開始週期性檢查
    logger.log(LogCategory.SYNC, 'Executing initial sync check');
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

  // 從服務器獲取並同步用戶股票，依賴伺服器端的衝突解決
  syncUserStocksFromServer: async () => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    try {
      logger.log(LogCategory.SYNC, 'Syncing user stocks from server...');
      
      // 檢查是否有 token
      const authToken = useSessionStore.getState().authToken;
      if (!authToken || !sessionStore.isAuthenticated) {
        logger.log(LogCategory.SYNC, 'No auth token or not authenticated, skipping sync');
        return;
      }
      
      // 從服務器獲取股票列表
      const response = await axios.get<UserStockResponse[]>(`${urls.stocks.list}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-Client-UUID': sessionStore.clientUuid
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
            // 使用伺服器數據更新本地狀態
            return {
              ...stock,
              cost: serverStock.average_cost !== null ? {
                averageCost: serverStock.average_cost,
                quantity: serverStock.quantity,
                cost: serverStock.average_cost
              } : undefined,
              // 更新同步相關欄位
              syncVersion: serverStock.version,
              lastSyncTimestamp: serverStock.last_sync_timestamp,
              clientUuid: serverStock.client_uuid || undefined
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
            } : undefined,
            // 添加同步相關欄位
            syncVersion: serverStock.version,
            lastSyncTimestamp: serverStock.last_sync_timestamp,
            clientUuid: serverStock.client_uuid || undefined
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