import { LoggerService, LogCategory } from '../utilities/loggerService';
import { ExtensionContextManager } from '../utilities/contextManager';
import { useSessionStore } from './sessionStore';
import { useStockDataStore } from './stockDataStore';
import { StockCostData, StockInventory, UserStockResponse } from 'src/types';
import axios from 'axios';
import { urls } from 'src/config';
import * as vscode from 'vscode';
import { subscribeStock, unsubscribeStock } from './stockDataStoreActionsSubscribe';
import { addToSyncQueue, deleteStockFromServer, syncStockToServer } from './stockDataActionUserSync';

export const removeStock = async (symbol: string): Promise<void> => {
    const logger = LoggerService.getInstance();
    const context = ExtensionContextManager.getContext();
    const isAuthenticated = useSessionStore.getState().isAuthenticated;
    const authToken = useSessionStore.getState().authToken;
    try {
      // 1. 先取消 WebSocket 訂閱
      await unsubscribeStock(symbol);
      // 2. 更新本地狀態
      useStockDataStore.setState((state) => {
        const newStocks = state.stocks.filter(s => s.symbol !== symbol);
        context.globalState.update('stocks', newStocks);
        return { stocks: newStocks };
      });
      // 3. 同步到服務器 (只有在已登入狀態下才執行)
      if (isAuthenticated && authToken) {
        try {
          await deleteStockFromServer(symbol);
        } catch (error) {
          logger.logError(LogCategory.STOCK_DATA, error, 'Failed to delete stock from server, adding to sync queue');
          addToSyncQueue({
            action: 'delete',
            symbol
          });
        }
      } else {
        // 未登入狀態，只加入同步隊列，等待之後登入時同步
        logger.log(LogCategory.STOCK_DATA, `User not authenticated, adding delete operation to sync queue: ${symbol}`);
        addToSyncQueue({
          action: 'delete',
          symbol
        });
      }
      logger.log(LogCategory.STOCK_DATA, `Successfully removed stock: ${symbol}`);
    } catch (error) {
      logger.logError(LogCategory.STOCK_DATA, error, 'Failed to remove stock');
      throw error;
    }
  };

export const updateUserStock = async (symbol: string, quantity: number, averageCost: number) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();
    try {
        if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
            logger.log(LogCategory.SYNC, `User not authenticated, adding stock ${symbol} to sync queue`);
            addToSyncQueue({
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
        const stock = useStockDataStore.getState().stocks.find(s => s.symbol === symbol);
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
            useStockDataStore.setState((state) => {
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
        useStockDataStore.setState((state) => {
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
            addToSyncQueue({
                action: 'update',
                symbol,
                quantity,
                averageCost
            });
        }
        logger.logError(LogCategory.STOCK_DATA, error, 'Failed to update user stock');
        throw error;
    }
};


export const updateStockCost = async (symbol: string, cost: StockCostData) => {
    const logger = LoggerService.getInstance();
    const context = ExtensionContextManager.getContext();
    const sessionStore = useSessionStore.getState();

    try {
        // 檢查股票是否存在
        const stockExists = useStockDataStore.getState().stocks.some(s => s.symbol === symbol);
        if (!stockExists) {
            const error = new Error(`Stock ${symbol} not found in current stocks list`);
            logger.logError(LogCategory.STOCK_DATA, error, error.message);
            throw error;
        }

        // 更新本地狀態
        useStockDataStore.setState((state) => ({
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
        context.globalState.update('stocks', useStockDataStore.getState().stocks);

        // 同步到服務器 - 只有在用戶已登入時才直接同步
        if (sessionStore.isAuthenticated && sessionStore.authToken) {
            logger.log(LogCategory.SYNC, `User authenticated, syncing stock ${symbol} directly to server`);
            await syncStockToServer(symbol, cost.quantity, cost.averageCost);
        } else {
            logger.log(LogCategory.SYNC, `User not authenticated, adding stock ${symbol} to sync queue`);
                addToSyncQueue({
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
        addToSyncQueue({
            action: 'update',
            symbol,
            quantity: cost.quantity,
            averageCost: cost.averageCost
        });
        throw error;
    }
};

export const removeStockCost = (symbol: string) => useStockDataStore.setState((state) => ({
    stocks: state.stocks.map(s => {
        if (s.symbol === symbol) {
            const { cost, ...stockWithoutCost } = s;
            return stockWithoutCost;
        }
        return s;
    })
}));

//Protential useless. Should be removed.
export const deleteUserStock = async (symbol: string) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();

    try {
        if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
            logger.log(LogCategory.SYNC, `User not authenticated, adding stock ${symbol} to sync queue for deletion`);
            addToSyncQueue({
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
        useStockDataStore.setState((state) => {
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
                useStockDataStore.setState((state) => {
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
            addToSyncQueue({
                action: 'delete',
                symbol
            });
        }
        logger.logError(LogCategory.STOCK_DATA, error instanceof Error ? error : new Error('Unknown error'), `Failed to delete user stock: ${symbol}`);
        throw error;
    }
};


export const addStock = async (symbols: string[]) => {
    const logger = LoggerService.getInstance();
    const context = ExtensionContextManager.getContext();
    const isAuthenticated = useSessionStore.getState().isAuthenticated;
    const authToken = useSessionStore.getState().authToken;

    try {
        // 檢查是否已存在
        const existingStocks = useStockDataStore.getState().stocks;
        const newSymbols = symbols.filter(symbol =>
            !existingStocks.some(stock => stock.symbol === symbol)
        );

        if (newSymbols.length === 0) {
            logger.log(LogCategory.STOCK_DATA, 'All stocks already exist in the list');
            return;
        }

        // 1. 先添加到本地狀態
        useStockDataStore.setState((state) => {
            const newStocks = newSymbols.map(symbol => createNewStock(symbol));
            const updatedStocks = [...state.stocks, ...newStocks];
            context.globalState.update('stocks', updatedStocks);
            return { stocks: updatedStocks };
        });

        // 2. 建立 WebSocket 訂閱
        await subscribeStock(newSymbols);

        // 3. 處理後端同步 (只有在已登入狀態下才執行)
        if (isAuthenticated && authToken) {
            try {
                await Promise.all(newSymbols.map(symbol =>
                    syncStockToServer(symbol)
                ));
            } catch (error) {
                logger.logError(LogCategory.STOCK_DATA, error, 'Failed to sync stocks to server, adding to sync queue');
                // 將失敗的同步加入隊列
                newSymbols.forEach(symbol => {
                    addToSyncQueue({
                        action: 'add',
                        symbol
                    });
                });
            }
        } else {
            // 未登入狀態，只加入同步隊列，等待之後登入時同步
            logger.log(LogCategory.STOCK_DATA, `User not authenticated, adding ${newSymbols.length} stocks to sync queue`);
            newSymbols.forEach(symbol => {
                addToSyncQueue({
                    action: 'add',
                    symbol
                });
            });
        }
    } catch (error) {
        logger.logError(LogCategory.STOCK_DATA, error, 'Failed to add stock');
        throw error;
    }
};

// Helper function for creating new stock
export function createNewStock(symbol: string): StockInventory {
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