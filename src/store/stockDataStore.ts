import { create } from 'zustand';
import { StockInventory, StockCostData, PriceAlert, StockSearchResult, SyncStatus, UserStockResponse, ConflictResolutionData, CandleData } from '../types';
import { useWebSocketStore } from './websocketStore';
import axios from 'axios';
import { useSessionStore } from './sessionStore';
import { WebSocketState } from '../types';
import { urls } from 'src/config';
import { ExtensionContextManager } from '../utilities/contextManager';
import * as vscode from 'vscode';
import { LoggerService, LogCategory } from '../utilities/loggerService';
import { isTokenExpired } from '../utilities/tokenUtils';
import { config } from 'src/config';

// Add new interfaces for API responses
// interface UserStockResponse {
//   stock_symbol: string;
//   stock_name: string;
//   quantity: number;
//   average_cost: number;
//   created_at: string;
//   updated_at: string;
//   is_cost_set: boolean;
//   is_quantity_set: boolean;
//   version: number;
//   last_sync_timestamp: number;
//   client_uuid: string | null;
//   has_conflict: boolean;
//   conflict_resolution?: string;
// }

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

  // 添加處理同步衝突的方法
  handleSyncConflict: (queueItem: SyncQueueItem, conflictData: any) => Promise<void>;

  // 添加新方法用於上傳本地股票到雲端
  uploadLocalStocksToServer: () => Promise<void>;
  
  // 添加獲取 5 分鐘 K 線資料的方法
  getStock5mCandles: (symbol: string) => Promise<CandleData[]>;

  // 添加同時獲取多支股票 5 分鐘 K 線資料的方法
  getMultipleStock5mCandles: (symbols: string[]) => Promise<Record<string, CandleData[]>>;
}

// 添加衝突處理的輔助函數
async function showConflictResolutionDialog(
  symbol: string,
  serverData: { quantity: number; average_cost: number; last_sync_timestamp: number },
  clientData: { quantity: number; average_cost: number; last_sync_timestamp: number }
): Promise<string | undefined> {
  const serverValue = `服務器版本：${serverData.quantity} 股 @ ${serverData.average_cost} 元`;
  const clientValue = `本地版本：${clientData.quantity} 股 @ ${clientData.average_cost} 元`;
  
  // 顯示詳細的衝突信息
  const message = `檢測到股票 ${symbol} 的數據同步衝突：\n\n` +
    `${serverValue}\n` +
    `最後更新：${new Date(serverData.last_sync_timestamp).toLocaleString()}\n\n` +
    `${clientValue}\n` +
    `最後更新：${new Date(clientData.last_sync_timestamp).toLocaleString()}\n\n` +
    `請選擇如何解決此衝突：`;

  const result = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    { title: '使用服務器版本', value: 'use_server' },
    { title: '使用本地版本', value: 'use_client' },
    { title: '手動合併', value: 'merge' }
  );

  return result?.value;
}

async function showMergeDialog(
  symbol: string,
  serverData: { quantity: number; average_cost: number },
  clientData: { quantity: number; average_cost: number }
): Promise<{ quantity: number; averageCost: number } | undefined> {
  // 顯示手動合併對話框
  const quantityInput = await vscode.window.showInputBox({
    prompt: `請輸入 ${symbol} 的股數`,
    value: clientData.quantity.toString(),
    validateInput: (value) => {
      const num = parseInt(value);
      return (!isNaN(num) && num >= 0) ? null : '請輸入有效的股數';
    }
  });

  if (quantityInput === undefined) return undefined;

  const averageCostInput = await vscode.window.showInputBox({
    prompt: `請輸入 ${symbol} 的平均成本`,
    value: clientData.average_cost.toString(),
    validateInput: (value) => {
      const num = parseFloat(value);
      return (!isNaN(num) && num >= 0) ? null : '請輸入有效的成本';
    }
  });

  if (averageCostInput === undefined) return undefined;

  return {
    quantity: parseInt(quantityInput),
    averageCost: parseFloat(averageCostInput)
  };
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

      // 檢查是否有保存的股票
      const symbolsList = savedStocks.map(stock => stock.symbol);
      
      // 如果沒有股票，則直接返回，避免發送空訂閱請求
      if (symbolsList.length === 0) {
        logger.log(LogCategory.STOCK_DATA, 'No stocks to subscribe, skipping subscription');
        return;
      }

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
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        
        // 處理 422 錯誤 - 股票不存在或使用者未擁有此股票
        if (status === 422) {
          logger.warning(LogCategory.STOCK_DATA, `Stock delete failed: ${error.response?.data?.detail || 'Stock does not exist in database or user does not own this stock'}`);
          
          // 還是更新本地狀態，移除成本信息
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
          
          return; // 不拋出錯誤，因為本地操作已完成
        }
        
        // 處理 404 錯誤 - API 路徑錯誤
        if (status === 404) {
          logger.logError(LogCategory.STOCK_DATA, error, `API endpoint not found: ${urls.stocks.delete(symbol)}`);
          throw new Error(`API endpoint not found: ${error.message}`);
        }
      }
      
      if (error instanceof Error && (
        error.message.includes('Network Error') ||
        error.message.includes('Failed to fetch')
      )) {
        get().addToSyncQueue({
          action: 'delete',
          symbol
        });
      }
      logger.logError(LogCategory.STOCK_DATA, error instanceof Error ? error : new Error('Unknown error'), `Failed to delete user stock: ${symbol}`);
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

      if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
        logger.log(LogCategory.SYNC, 'User not authenticated, skipping sync queue processing');
        return;
      }

      logger.log(LogCategory.SYNC, `Processing ${queue.length} items in sync queue`);

      const sortedQueue = [...queue].sort((a, b) => a.timestamp - b.timestamp);

      for (const item of sortedQueue) {
        try {
          logger.log(LogCategory.SYNC, `Processing item: ${JSON.stringify(item)}`);

          const headers = {
            'Authorization': `Bearer ${sessionStore.authToken}`,
            'Content-Type': 'application/json',
            'X-Client-UUID': sessionStore.clientUuid
          };

          switch (item.action) {
            case 'add':
            case 'update':
              await axios.put(
                urls.stocks.update(item.symbol),
                {
                  stock_id: item.symbol,
                  quantity: item.quantity || 0,
                  average_cost: item.averageCost || 0,
                  version: item.version,
                  last_sync_timestamp: item.last_sync_timestamp
                },
                { headers }
              );
              break;

            case 'delete':
              await axios.delete(
                urls.stocks.delete(item.symbol),
                {
                  headers,
                  data: {
                    version: item.version,
                    last_sync_timestamp: item.last_sync_timestamp
                  }
                }
              );
              break;
          }

          // 處理成功後，從隊列中移除該項目
          set((state) => {
            const updatedQueue = state.syncQueue.filter(
              queueItem => !(queueItem.symbol === item.symbol && queueItem.action === item.action)
            );
            
            const context = ExtensionContextManager.getContext();
            context.globalState.update('syncQueue', updatedQueue);
            
            return { syncQueue: updatedQueue };
          });
        } catch (error) {
          if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            
            // 處理 409 錯誤 - 數據衝突
            if (status === 409) {
              logger.warning(LogCategory.SYNC, `Conflict detected for ${item.symbol}`);
              await get().handleSyncConflict(item, error.response?.data);
              continue; // 跳到下一個項目
            }
            
            // 處理 422 錯誤 - 資源不存在或不可處理
            if (status === 422) {
              logger.warning(LogCategory.SYNC, `Item ${item.symbol} cannot be processed (422): ${error.response?.data?.detail || error.response?.data?.error || 'Unknown error'}`);
              
              // 從隊列中移除該項目，因為它無法處理（例如股票不存在或用戶不擁有此股票）
              set((state) => {
                const updatedQueue = state.syncQueue.filter(
                  queueItem => !(queueItem.symbol === item.symbol && queueItem.action === item.action)
                );
                
                const context = ExtensionContextManager.getContext();
                context.globalState.update('syncQueue', updatedQueue);
                
                return { syncQueue: updatedQueue };
              });
              
              // 若是刪除操作，確保本地股票數據也已清理
              if (item.action === 'delete') {
                set((state) => {
                  const updatedStocks = state.stocks.map(stock => {
                    if (stock.symbol === item.symbol) {
                      const { cost, syncVersion, lastSyncTimestamp, clientUuid, ...stockWithoutCost } = stock;
                      return stockWithoutCost as StockInventory;
                    }
                    return stock;
                  });
                  
                  const context = ExtensionContextManager.getContext();
                  context.globalState.update('stocks', updatedStocks);
                  
                  return { stocks: updatedStocks };
                });
              }
              
              // 記錄詳細錯誤信息但不拋出錯誤
              const errorCode = error.response?.data?.code;
              const errorDetail = error.response?.data?.detail || error.response?.data?.error;
              
              if (errorCode === 'stock_not_found') {
                logger.warning(LogCategory.SYNC, `Stock ${item.symbol} not found in database`);
              } else if (errorCode === 'user_stock_not_found') {
                logger.warning(LogCategory.SYNC, `User does not own stock ${item.symbol}`);
              } else {
                logger.warning(LogCategory.SYNC, `Unprocessable entity for stock ${item.symbol}: ${errorDetail}`);
              }
              
              continue; // 跳到下一個項目
            }
            
            // 處理 401/403 錯誤 - 身份驗證/授權問題
            if (status === 401 || status === 403) {
              logger.warning(LogCategory.SYNC, `Authentication/Authorization error (${status}) while processing ${item.symbol}`);
              // 不移除項目，等待下次登入後再處理
              break; // 中斷整個佇列處理，等待重新登入
            }
          }
          
          // 處理網絡錯誤
          if (error instanceof Error && (
            error.message.includes('Network Error') ||
            error.message.includes('Failed to fetch') ||
            error.message.includes('timeout')
          )) {
            logger.warning(LogCategory.SYNC, `Network error while processing ${item.symbol}, will retry later`);
            // 不移除項目，等待下次網絡恢復後再處理
            break; // 中斷整個佇列處理，等待網絡恢復
          }
          
          // 處理其他錯誤
          logger.logError(LogCategory.SYNC, error instanceof Error ? error : new Error('Unknown error'), `Error processing item ${item.symbol}`);
          
          // 如果連續失敗次數超過閾值，可以考慮從隊列中移除
          // 目前先保留在隊列中，等待下次處理
        }
      }
    } catch (error) {
      logger.logError(LogCategory.SYNC, error instanceof Error ? error : new Error('Unknown error'), 'Failed to process sync queue');
      // 不拋出錯誤，避免中斷外層的同步處理邏輯
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
      // 檢查是否提供了有效的股票代碼
      if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        logger.warning(LogCategory.STOCK_DATA, '訂閱請求未提供有效的股票代碼');
        return { type: 'warning', message: '未提供股票代碼' };
      }

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
    const isAuthenticated = useSessionStore.getState().isAuthenticated;
    const authToken = useSessionStore.getState().authToken;

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

      // 3. 處理後端同步 (只有在已登入狀態下才執行)
      if (isAuthenticated && authToken) {
        try {
          await Promise.all(newSymbols.map(symbol => 
            get().syncStockToServer(symbol)
          ));
        } catch (error) {
          logger.logError(LogCategory.STOCK_DATA, error, 'Failed to sync stocks to server, adding to sync queue');
          // 將失敗的同步加入隊列
          newSymbols.forEach(symbol => {
            get().addToSyncQueue({
              action: 'add',
              symbol
            });
          });
        }
      } else {
        // 未登入狀態，只加入同步隊列，等待之後登入時同步
        logger.log(LogCategory.STOCK_DATA, `User not authenticated, adding ${newSymbols.length} stocks to sync queue`);
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
    
    try {
      // 檢查用戶是否已登入
      if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
        logger.log(LogCategory.SYNC, 'User not authenticated, skipping sync');
        get().stopAutoSync();
        return;
      }

      const headers = {
        'Authorization': `Bearer ${sessionStore.authToken}`,
        'Content-Type': 'application/json',
        'X-Client-UUID': sessionStore.clientUuid
      };

      // 獲取同步狀態
      const syncStatusResponse = await axios.get(urls.stocks.syncStatus, { headers });
      const syncStatus = syncStatusResponse.data;

      // 檢查是否需要同步
      if (syncStatus.pending_changes > 0 || get().syncQueue.length > 0) {
        // 先處理同步隊列
        if (get().syncQueue.length > 0) {
          logger.log(LogCategory.SYNC, 'Processing sync queue before server sync');
          await get().processSyncQueue();
        }

        // 處理服務器端的衝突
        if (syncStatus.pending_changes > 0) {
          logger.log(LogCategory.SYNC, `Processing ${syncStatus.pending_changes} server conflicts`);
          await get().syncUserStocksFromServer();
        }
      } else {
        // 即使沒有明確的同步需求，也檢查本地持股與伺服器的差異
        logger.log(LogCategory.SYNC, 'No pending changes detected, checking for local stocks not on server');
        
        // 從伺服器獲取股票列表
        const response = await axios.get<UserStockResponse[]>(urls.stocks.list, { headers });
        const serverSymbols = response.data.map((stock: UserStockResponse) => stock.stock_symbol);
        
        // 檢查本地是否有伺服器沒有的持股資料
        const currentStocks = get().stocks;
        const localStocksWithCost = currentStocks.filter(stock => 
          stock.cost && !serverSymbols.includes(stock.symbol)
        );
        
        // 如果有本地持股但伺服器沒有，觸發上傳
        if (localStocksWithCost.length > 0) {
          logger.log(LogCategory.SYNC, `Found ${localStocksWithCost.length} local stocks not on server, uploading...`);
          
          // 將這些股票加入同步佇列
          for (const stock of localStocksWithCost) {
            get().addToSyncQueue({
              action: 'add',
              symbol: stock.symbol,
              quantity: stock.cost?.quantity || 0,
              averageCost: stock.cost?.averageCost || 0
            });
          }
          
          // 處理同步佇列
          await get().processSyncQueue();
        }
      }

      // 更新最後同步時間
      set({ lastSyncTime: Date.now() });
      logger.log(LogCategory.SYNC, `Sync completed at ${new Date().toISOString()}`);
    } catch (error) {
      logger.logError(LogCategory.SYNC, error, 'Periodic sync failed');
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

    // 立即執行一次同步，確保本地持股與伺服器同步
    (async () => {
      try {
        logger.log(LogCategory.SYNC, 'Performing initial sync check on auto sync start');
        await get().syncUserStocksFromServer();
      } catch (error) {
        logger.logError(LogCategory.SYNC, error, 'Error in initial sync check');
      }
    })();

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
    const isAuthenticated = useSessionStore.getState().isAuthenticated;
    const authToken = useSessionStore.getState().authToken;

    try {
      // 1. 先取消 WebSocket 訂閱
      await get().unsubscribeStock(symbol);

      // 2. 更新本地狀態
      set((state) => {
        const newStocks = state.stocks.filter(s => s.symbol !== symbol);
        context.globalState.update('stocks', newStocks);
        return { stocks: newStocks };
      });

      // 3. 同步到服務器 (只有在已登入狀態下才執行)
      if (isAuthenticated && authToken) {
        try {
          await get().deleteStockFromServer(symbol);
        } catch (error) {
          logger.logError(LogCategory.STOCK_DATA, error, 'Failed to delete stock from server, adding to sync queue');
          get().addToSyncQueue({
            action: 'delete',
            symbol
          });
        }
      } else {
        // 未登入狀態，只加入同步隊列，等待之後登入時同步
        logger.log(LogCategory.STOCK_DATA, `User not authenticated, adding delete operation to sync queue: ${symbol}`);
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
    const logger = LoggerService.getInstance();
    try {
      const headers = {
        'Authorization': `Bearer ${useSessionStore.getState().authToken}`,
        'Content-Type': 'application/json',
        'X-Client-UUID': useSessionStore.getState().clientUuid || '',
      };

      const response = await axios.delete(urls.stocks.delete(symbol), { headers });
      logger.info(LogCategory.STOCK_DATA, `Successfully deleted stock ${symbol} from server`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          const status = error.response.status;
          const data = error.response.data;
          
          // 處理 422 錯誤 - 股票在資料庫中不存在或用戶沒有此股票
          if (status === 422) {
            if (data.code === 'stock_not_found') {
              logger.warning(LogCategory.STOCK_DATA, `Stock ${symbol} does not exist in database`);
              // 本地刪除就好，不需要再同步
              return { message: `Stock ${symbol} not found in database, removed locally` };
            } else if (data.code === 'user_stock_not_found') {
              logger.warning(LogCategory.STOCK_DATA, `User does not own stock ${symbol}`);
              // 本地刪除就好，不需要再同步
              return { message: `User does not own stock ${symbol}, removed locally` };
            }
          }
          
          // 處理 404 錯誤 - API 路徑錯誤
          if (status === 404) {
            logger.logError(LogCategory.STOCK_DATA, error, `API endpoint not found: ${urls.stocks.delete(symbol)}`);
            throw new Error(`API endpoint not found: ${error.message}`);
          }
          
          // 處理其他錯誤
          logger.warning(LogCategory.STOCK_DATA, `Failed to delete stock ${symbol}: ${status} ${JSON.stringify(data)}`);
        }
      }
      
      // 將刪除操作加入同步佇列，等待下次同步
      logger.info(LogCategory.STOCK_DATA, `Adding delete operation for ${symbol} to sync queue`);
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
      logger.log(LogCategory.SYNC, '=== Syncing user stocks from server ===');
      
      // 檢查是否有 token
      const authToken = useSessionStore.getState().authToken;
      const clientUuid = useSessionStore.getState().clientUuid;
      const isAuthenticated = useSessionStore.getState().isAuthenticated;
      
      if (!authToken || !isAuthenticated) {
        logger.warning(LogCategory.SYNC, 'No auth token or not authenticated, skipping sync');
        return;
      }
      
      // 檢查 token 是否過期
      if (sessionStore.authToken && isTokenExpired(sessionStore.authToken)) {
        logger.info(LogCategory.STOCK_DATA, '認證令牌已過期，嘗試重新獲取令牌');
        // 無法直接刷新令牌，需要重新登入
        return [];
      }
      
      // 構建請求頭
      const headers = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'X-Client-UUID': clientUuid
      };
      
      // 先獲取同步狀態
      const syncStatusResponse = await axios.get<SyncStatus>(urls.stocks.syncStatus, { headers });
      logger.info(LogCategory.SYNC, `Sync status: ${JSON.stringify(syncStatusResponse.data)}`);

      // 檢查是否有待處理的衝突
      if (syncStatusResponse.data.pending_changes > 0) {
        logger.warning(LogCategory.SYNC, `Found ${syncStatusResponse.data.pending_changes} pending conflicts`);
        // 獲取衝突列表
        const conflictsResponse = await axios.get<UserStockResponse[]>(urls.stocks.conflicts, { headers });
        const conflicts = conflictsResponse.data;

        // 處理每個衝突
        for (const conflict of conflicts) {
          // 顯示衝突解決對話框
          const resolution = await vscode.window.showQuickPick(
            [
              { label: '使用服務器版本', value: 'use_server' },
              { label: '使用本地版本', value: 'use_client' },
              { label: '手動合併', value: 'merge' }
            ],
            {
              placeHolder: `請選擇如何解決 ${conflict.stock_symbol} 的衝突`
            }
          );

          if (resolution) {
            // 發送衝突解決請求
            const resolutionData: ConflictResolutionData = {
              symbol: conflict.stock_symbol,
              resolution_method: resolution.value as 'use_server' | 'use_client' | 'merge',
              client_uuid: useSessionStore.getState().clientUuid,
              quantity: conflict.quantity || 0,
              average_cost: conflict.average_cost || 0
            };

            await axios.post(
              urls.stocks.resolveConflict,
              resolutionData,
              { headers }
            );
          }
        }
      }

      // 從服務器獲取股票列表
      const response = await axios.get<UserStockResponse[]>(urls.stocks.list, { headers });
      
      // 獲取當前本地股票列表
      const currentStocks = get().stocks;
      const context = ExtensionContextManager.getContext();

      // 更新本地狀態
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
              } : undefined,
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
            syncVersion: serverStock.version,
            lastSyncTimestamp: serverStock.last_sync_timestamp,
            clientUuid: serverStock.client_uuid || undefined
          }));

        const finalStocks = [...updatedStocks, ...newStocks];
        
        // 保存到全局狀態
        context.globalState.update('stocks', finalStocks);
        
        return { stocks: finalStocks };
      });

      // 訂閱新增的股票
      const newSymbols = response.data
        .filter((serverStock: UserStockResponse) => 
          !currentStocks.some(localStock => localStock.symbol === serverStock.stock_symbol)
        )
        .map((stock: UserStockResponse) => stock.stock_symbol);

      if (newSymbols.length > 0) {
        await get().subscribeStock(newSymbols);
      }

      // 檢查本地是否有伺服器沒有的持股資料
      const serverSymbols = response.data.map((stock: UserStockResponse) => stock.stock_symbol);
      const localStocksWithCost = currentStocks.filter(stock => 
        stock.cost && !serverSymbols.includes(stock.symbol)
      );

      // 如果有本地持股但伺服器沒有，觸發上傳
      if (localStocksWithCost.length > 0) {
        logger.log(LogCategory.SYNC, `Found ${localStocksWithCost.length} local stocks not on server, uploading...`);
        
        // 將這些股票加入同步佇列
        for (const stock of localStocksWithCost) {
          get().addToSyncQueue({
            action: 'add',
            symbol: stock.symbol,
            quantity: stock.cost?.quantity || 0,
            averageCost: stock.cost?.averageCost || 0
          });
        }
        
        // 處理同步佇列
        await get().processSyncQueue();
      }

      // 強制同步以確保所有更改都已同步
      await axios.post(urls.stocks.synchronize, {}, { headers });

      return get().stocks;
    } catch (error) {
      logger.logError(LogCategory.SYNC, error instanceof Error ? error : new Error('Unknown error'), 'Error syncing user stocks');
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

  // 修改 handleSyncConflict 方法
  handleSyncConflict: async (queueItem: SyncQueueItem, conflictData: any) => {
    const logger = LoggerService.getInstance();
    
    try {
      // 從衝突數據中提取服務器和客戶端版本
      const serverVersion = conflictData.server_version || conflictData;
      const clientVersion = conflictData.client_version || {
        quantity: queueItem.quantity,
        average_cost: queueItem.averageCost,
        last_sync_timestamp: queueItem.last_sync_timestamp
      };

      // 顯示衝突解決對話框
      const resolution = await showConflictResolutionDialog(
        queueItem.symbol,
        serverVersion,
        clientVersion
      );

      if (!resolution) {
        logger.warning(LogCategory.SYNC, `User cancelled conflict resolution for ${queueItem.symbol}`);
        // 將項目保留在同步隊列中
        return;
      }

      const headers = {
        'Authorization': `Bearer ${useSessionStore.getState().authToken}`,
        'Content-Type': 'application/json',
        'X-Client-UUID': useSessionStore.getState().clientUuid
      };

      // 準備衝突解決數據
      const resolutionData: ConflictResolutionData = {
        symbol: queueItem.symbol,
        resolution_method: resolution as 'use_server' | 'use_client' | 'merge',
        client_uuid: useSessionStore.getState().clientUuid
      };

      // 如果選擇手動合併，添加合併後的數據
      if (resolution === 'merge') {
        const mergeResult = await showMergeDialog(
          queueItem.symbol,
          serverVersion,
          clientVersion
        );

        if (!mergeResult) {
          logger.warning(LogCategory.SYNC, `User cancelled merge for ${queueItem.symbol}`);
          return;
        }

        resolutionData.quantity = mergeResult.quantity;
        resolutionData.average_cost = mergeResult.averageCost;
      } else if (resolution === 'use_client') {
        // 使用客戶端數據
        resolutionData.quantity = clientVersion.quantity;
        resolutionData.average_cost = clientVersion.average_cost;
      }

      // 發送衝突解決請求
      const response = await axios.post(
        urls.stocks.resolveConflict,
        resolutionData,
        { headers }
      );

      // 更新本地狀態
      if (response.data) {
        set((state) => {
          const updatedStocks = state.stocks.map(stock => {
            if (stock.symbol === queueItem.symbol) {
              return {
                ...stock,
                cost: response.data.average_cost !== null ? {
                  averageCost: response.data.average_cost,
                  quantity: response.data.quantity,
                  cost: response.data.average_cost
                } : undefined,
                syncVersion: response.data.version,
                lastSyncTimestamp: response.data.last_sync_timestamp,
                clientUuid: response.data.client_uuid,
                hasConflict: false,
                conflictData: undefined
              };
            }
            return stock;
          });

          const context = ExtensionContextManager.getContext();
          context.globalState.update('stocks', updatedStocks);
          return { stocks: updatedStocks };
        });
      }

      // 從隊列中移除已解決的項目
      set((state) => {
        const updatedQueue = state.syncQueue.filter(
          item => !(item.symbol === queueItem.symbol && item.action === item.action)
        );
        
        const context = ExtensionContextManager.getContext();
        context.globalState.update('syncQueue', updatedQueue);
        
        return { syncQueue: updatedQueue };
      });

      // 顯示成功消息
      vscode.window.showInformationMessage(
        `已成功解決 ${queueItem.symbol} 的數據衝突`
      );

      logger.log(LogCategory.SYNC, `Conflict resolved for ${queueItem.symbol}`);
    } catch (error) {
      logger.logError(LogCategory.SYNC, error instanceof Error ? error : new Error('Unknown error'), `Failed to resolve conflict for ${queueItem.symbol}`);
      
      // 顯示錯誤消息
      vscode.window.showErrorMessage(
        `解決 ${queueItem.symbol} 的數據衝突時發生錯誤：${error instanceof Error ? error.message : '未知錯誤'}`
      );
      
      throw error;
    }
  },

  // 添加新方法實現
  uploadLocalStocksToServer: async () => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    try {
      // 檢查用戶是否已登入
      if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
        logger.warning(LogCategory.SYNC, '用戶未登入，無法上傳本地股票資料');
        return;
      }

      // 獲取本地股票列表
      const localStocks = get().stocks.filter(stock => stock.cost);
      
      if (localStocks.length === 0) {
        logger.log(LogCategory.SYNC, '沒有本地持股資料需要上傳');
        return;
      }
      
      logger.log(LogCategory.SYNC, `Found ${localStocks.length} local stocks with cost, uploading...`);
      
      // 將這些股票加入同步佇列
      for (const stock of localStocks) {
        get().addToSyncQueue({
          action: 'add',
          symbol: stock.symbol,
          quantity: stock.cost?.quantity || 0,
          averageCost: stock.cost?.averageCost || 0
        });
      }
      
      // 處理同步佇列
      await get().processSyncQueue();
    } catch (error) {
      logger.logError(LogCategory.SYNC, error, 'Failed to upload local stocks to server');
      throw error;
    }
  },

  // 添加獲取 5 分鐘 K 線資料的方法
  getStock5mCandles: async (symbol: string) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    try {
      // 檢查用戶是否已登入
      if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
        logger.warning(LogCategory.STOCK_DATA, '用戶未登入，無法獲取股票 5 分鐘 K 線資料');
        return [];
      }

      // 檢查 token 是否過期
      if (sessionStore.authToken && isTokenExpired(sessionStore.authToken)) {
        logger.info(LogCategory.STOCK_DATA, '認證令牌已過期，需要重新登入');
        return [];
      }

      // 構建請求頭
      const headers = {
        'Authorization': `Bearer ${sessionStore.authToken}`,
        'Content-Type': 'application/json',
        'X-Client-UUID': sessionStore.clientUuid
      };
      
      // 獲取股票 5 分鐘 K 線資料
      const response = await axios.get<CandleData[]>(urls.stocks.candles5m(symbol), { headers });
      
      // 檢查響應數據的格式
      logger.debug(LogCategory.STOCK_DATA, `5 分鐘 K 線數據響應格式樣例: ${response.data.length > 0 ? JSON.stringify(response.data[0]) : 'Empty data'}`);
      
      // 確保響應數據符合 CandleData 介面格式
      let processedData = response.data;
      
      // 如果發現數據不符合我們的 CandleData 介面，嘗試轉換
      if (response.data.length > 0) {
        const firstItem = response.data[0] as any;
        
        // 檢查是否需要字段映射
        if (
          firstItem.hasOwnProperty('date') && 
          !firstItem.hasOwnProperty('timestamp')
        ) {
          // 使用舊格式轉換為新格式
          processedData = response.data.map(item => {
            const oldItem = item as any;
            return {
              timestamp: oldItem.date || new Date().toISOString(),
              timeframe: '5min',
              open_price: oldItem.open || 0,
              high_price: oldItem.high || 0,
              low_price: oldItem.low || 0,
              close_price: oldItem.close || 0,
              volume: oldItem.volume || 0,
              amount: oldItem.value || 0
            } as CandleData;
          });
          logger.info(LogCategory.STOCK_DATA, '已將舊格式 K 線數據轉換為新格式');
        }
      }
      
      logger.info(LogCategory.STOCK_DATA, `成功獲取 ${symbol} 的 5 分鐘 K 線資料，共 ${processedData.length} 筆`);
      return processedData;
    } catch (error: any) {
      // 處理特定錯誤碼
      if (error.response) {
        const status = error.response.status;
        
        // 如果是未認證 (401)
        if (status === 401) {
          logger.warning(LogCategory.STOCK_DATA, '認證失敗 (401)，需要重新登入');
          return [];
        } else if (status === 202) {
          // 處理 202 狀態（正在處理中）
          logger.info(LogCategory.STOCK_DATA, `服務器正在處理 ${symbol} 的 K 線資料，稍後再試`);
          return [];
        } else if (status === 404) {
          // 處理 404 狀態（找不到資源）
          logger.warning(LogCategory.STOCK_DATA, `找不到 ${symbol} 的 K 線資料`);
          return [];
        }
      }
      
      logger.logError(LogCategory.STOCK_DATA, error, `獲取 ${symbol} 的 5 分鐘 K 線資料時發生錯誤`);
      return [];
    }
  },

  // 添加同時獲取多支股票 5 分鐘 K 線資料的方法
  getMultipleStock5mCandles: async (symbols: string[]): Promise<Record<string, CandleData[]>> => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    
    try {
      // 檢查參數
      if (!symbols || symbols.length === 0) {
        logger.warning(LogCategory.STOCK_DATA, '未提供股票代號，無法獲取 K 線資料');
        return {};
      }
      
      // 限制請求數量，避免過載
      if (symbols.length > 20) {
        logger.warning(LogCategory.STOCK_DATA, `請求股票數量過多，最多同時請求 20 支股票，當前請求 ${symbols.length} 支`);
        symbols = symbols.slice(0, 20);
      }
      
      // 檢查用戶是否已登入
      if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
        logger.warning(LogCategory.STOCK_DATA, '用戶未登入，無法獲取股票 5 分鐘 K 線資料');
        return {};
      }

      // 檢查 token 是否過期
      if (sessionStore.authToken && isTokenExpired(sessionStore.authToken)) {
        logger.info(LogCategory.STOCK_DATA, '認證令牌已過期，需要重新登入');
        return {};
      }

      // 構建請求頭
      const headers = {
        'Authorization': `Bearer ${sessionStore.authToken}`,
        'Content-Type': 'application/json',
        'X-Client-UUID': sessionStore.clientUuid
      };
      
      logger.info(LogCategory.STOCK_DATA, `開始獲取多支股票的 5 分鐘 K 線資料: ${symbols.join(', ')}`);
      
      // 確保 symbols 是一個陣列
      if (!Array.isArray(symbols)) {
        logger.logError(LogCategory.STOCK_DATA, new Error(`symbols 不是有效的陣列: ${JSON.stringify(symbols)}`), 'Invalid symbols format');
        return {};
      }
      const requestBody = { symbols: symbols };
      logger.info(LogCategory.STOCK_DATA, `完整的請求體: ${JSON.stringify(requestBody)}`);
      
      // 使用 POST 方法獲取多支股票的 K 線資料
      const response = await axios.post(
        urls.stocks.multiCandles5m,
        symbols,
        { headers }
      );
      
      // 添加請求體的詳細日誌，用於調試
      logger.info(LogCategory.STOCK_DATA, `發送的請求數據: ${JSON.stringify({ symbols: symbols })}`);
      
      if (!response.data || !response.data.data) {
        logger.warning(LogCategory.STOCK_DATA, '伺服器回應數據格式不正確');
        return {};
      }
      
      const { data, status } = response.data;
      
      // 處理每支股票的狀態
      Object.entries(status).forEach(([symbol, statusInfo]: [string, any]) => {
        if (statusInfo.status !== 'success') {
          logger.warning(
            LogCategory.STOCK_DATA, 
            `獲取 ${symbol} K 線資料狀態: ${statusInfo.status}, 訊息: ${statusInfo.message || '無'}`
          );
        } else {
          logger.info(
            LogCategory.STOCK_DATA, 
            `成功獲取 ${symbol} K 線資料，共 ${statusInfo.count || 0} 筆`
          );
        }
      });
      
      return data;
    } catch (error: any) {
      // 處理特定錯誤碼
      if (error.response) {
        const status = error.response.status;
        
        // 如果是未認證 (401)
        if (status === 401) {
          logger.warning(LogCategory.STOCK_DATA, '認證失敗 (401)，需要重新登入');
          return {};
        } else if (status === 202) {
          // 處理 202 狀態（正在處理中）
          logger.info(LogCategory.STOCK_DATA, '服務器正在處理 K 線資料，稍後再試');
          return {};
        } else if (status === 404) {
          // 處理 404 狀態（找不到資源）
          logger.warning(LogCategory.STOCK_DATA, '找不到請求的 K 線資料');
          return {};
        }
      }
      
      logger.logError(LogCategory.STOCK_DATA, error, '獲取多支股票的 5 分鐘 K 線資料時發生錯誤');
      return {};
    }
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