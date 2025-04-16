import { ConflictResolutionData, StockInventory, SyncQueueItem, SyncStatus, UserStockResponse } from "src/types";
import { ExtensionContextManager } from "src/utilities/contextManager";
import { LogCategory, LoggerService } from "src/utilities/loggerService";
import { useStockDataStore } from "./stockDataStore";
import { useSessionStore } from "./sessionStore";
import axios from "axios";
import { urls } from "src/config";
import * as vscode from 'vscode';
import { get } from "node:http";
import { isTokenExpired } from "src/utilities/tokenUtils";
import { createNewStock } from "./stockDataActionUserStock";
import { subscribeStock } from "./stockDataStoreActionsSubscribe";



// 添加到同步隊列
export const addToSyncQueue = (item: Omit<SyncQueueItem, 'timestamp'>) => {
    const logger = LoggerService.getInstance();
    useStockDataStore.setState((state) => {
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
};
// 處理同步隊列
export const processSyncQueue = async () => {
    const logger = LoggerService.getInstance();
    const queue = [...useStockDataStore.getState().syncQueue];
    const sessionStore = useSessionStore.getState();

    try {
        if (queue.length === 0) {
            return;
        }

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
                useStockDataStore.setState((state) => {
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
                        await handleSyncConflict(item, error.response?.data);
                        continue; // 跳到下一個項目
                    }

                    // 處理 422 錯誤 - 資源不存在或不可處理
                    if (status === 422) {
                        logger.warning(LogCategory.SYNC, `Item ${item.symbol} cannot be processed (422): ${error.response?.data?.detail || error.response?.data?.error || 'Unknown error'}`);

                        // 從隊列中移除該項目，因為它無法處理（例如股票不存在或用戶不擁有此股票）
                        useStockDataStore.setState((state) => {
                            const updatedQueue = state.syncQueue.filter(
                                queueItem => !(queueItem.symbol === item.symbol && queueItem.action === item.action)
                            );

                            const context = ExtensionContextManager.getContext();
                            context.globalState.update('syncQueue', updatedQueue);

                            return { syncQueue: updatedQueue };
                        });

                        // 若是刪除操作，確保本地股票數據也已清理
                        if (item.action === 'delete') {
                            useStockDataStore.setState((state) => {
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
};

// 改進的檢查並執行同步方法，依賴伺服器端的衝突解決
export const checkAndSync = async () => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();

    try {
        // 檢查用戶是否已登入
        if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
            logger.log(LogCategory.SYNC, 'User not authenticated, skipping sync');
            stopAutoSync();
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
        if (syncStatus.pending_changes > 0 || useStockDataStore.getState().syncQueue.length > 0) {
            // 先處理同步隊列
            if (useStockDataStore.getState().syncQueue.length > 0) {
                logger.log(LogCategory.SYNC, 'Processing sync queue before server sync');
                await processSyncQueue();
            }

            // 處理服務器端的衝突
            if (syncStatus.pending_changes > 0) {
                logger.log(LogCategory.SYNC, `Processing ${syncStatus.pending_changes} server conflicts`);
                await syncUserStocksFromServer();
            }
        } else {
            // 即使沒有明確的同步需求，也檢查本地持股與伺服器的差異
            logger.log(LogCategory.SYNC, 'No pending changes detected, checking for local stocks not on server');

            // 從伺服器獲取股票列表
            const response = await axios.get<UserStockResponse[]>(urls.stocks.list, { headers });
            const serverSymbols = response.data.map((stock: UserStockResponse) => stock.stock_symbol);

            // 檢查本地是否有伺服器沒有的持股資料
            const currentStocks = useStockDataStore.getState().stocks;
            const localStocksWithCost = currentStocks.filter(stock =>
                stock.cost && !serverSymbols.includes(stock.symbol)
            );

            // 如果有本地持股但伺服器沒有，觸發上傳
            if (localStocksWithCost.length > 0) {
                logger.log(LogCategory.SYNC, `Found ${localStocksWithCost.length} local stocks not on server, uploading...`);

                // 將這些股票加入同步佇列
                for (const stock of localStocksWithCost) {
                    addToSyncQueue({
                        action: 'add',
                        symbol: stock.symbol,
                        quantity: stock.cost?.quantity || 0,
                        averageCost: stock.cost?.averageCost || 0
                    });
                }

                // 處理同步佇列
                await processSyncQueue();
            }
        }

        // 更新最後同步時間
        useStockDataStore.setState({ lastSyncTime: Date.now() });
        logger.log(LogCategory.SYNC, `Sync completed at ${new Date().toISOString()}`);
    } catch (error) {
        logger.logError(LogCategory.SYNC, error, 'Periodic sync failed');
    }
};

// 清除同步隊列
// export const clearSyncQueue = () => {
//     const context = ExtensionContextManager.getContext();
//     context.globalState.update('syncQueue', []);
//     useStockDataStore.setState((state) => ({ syncQueue: [] }));
// }
// 處理衝突
export const handleSyncConflict = async (queueItem: SyncQueueItem, conflictData: any) => {
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
            useStockDataStore.setState((state) => {
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
        useStockDataStore.setState((state) => {
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
};

// 改進的開始自動同步方法
export const startAutoSync = () => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();

    // 檢查用戶是否已登入
    if (!useSessionStore.getState().isAuthenticated || !useSessionStore.getState().authToken) {
        logger.log(LogCategory.SYNC, 'User not authenticated, not starting auto sync');
        return;
    }

    // 如果已經啟用，先停止
    if (useStockDataStore.getState().autoSyncEnabled) {
        stopAutoSync();
    }

    // 設置啟用狀態
    useStockDataStore.setState({ autoSyncEnabled: true });
    logger.log(LogCategory.SYNC, `Starting auto sync with interval ${useStockDataStore.getState().autoSyncInterval}ms`);

    // 立即執行一次同步，確保本地持股與伺服器同步
    (async () => {
        try {
            logger.log(LogCategory.SYNC, 'Performing initial sync check on auto sync start');
            await syncUserStocksFromServer();
        } catch (error) {
            logger.logError(LogCategory.SYNC, error, 'Error in initial sync check');
        }
    })();

    // 定義週期性檢查函數
    const periodicCheck = async () => {
        if (!useStockDataStore.getState().autoSyncEnabled) {
            logger.log(LogCategory.SYNC, 'Auto sync disabled, stopping periodic check');
            return;
        }

        // 檢查是否已登入
        if (!useSessionStore.getState().isAuthenticated || !useSessionStore.getState().authToken) {
            logger.log(LogCategory.SYNC, 'User not authenticated, stopping auto sync');
            stopAutoSync();
            return;
        }

        logger.log(LogCategory.SYNC, 'Running periodic sync check');
        await checkAndSync();

        // 設置下次檢查
        setTimeout(periodicCheck, useStockDataStore.getState().autoSyncInterval);
    };

    // 立即執行一次檢查，然後開始週期性檢查
    logger.log(LogCategory.SYNC, 'Executing initial sync check');
    periodicCheck().catch(error => {
        logger.logError(LogCategory.SYNC, error, 'Error in periodic check');
    });
};

// 改進的停止自動同步
export const stopAutoSync = () => {
    const logger = LoggerService.getInstance();
    useStockDataStore.setState({
        autoSyncEnabled: false,
        lastSyncTime: null
    });
    logger.log(LogCategory.SYNC, 'Auto sync stopped');
};

// 從服務器獲取並同步用戶股票，依賴伺服器端的衝突解決
export const syncUserStocksFromServer = async () => {
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
        const currentStocks = useStockDataStore.getState().stocks;
        const context = ExtensionContextManager.getContext();

        // 更新本地狀態
        useStockDataStore.setState((state) => {
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

            await subscribeStock(newSymbols);
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
                addToSyncQueue({
                    action: 'add',
                    symbol: stock.symbol,
                    quantity: stock.cost?.quantity || 0,
                    averageCost: stock.cost?.averageCost || 0
                });
            }

            // 處理同步佇列
            await processSyncQueue();
        }

        // 強制同步以確保所有更改都已同步
        await axios.post(urls.stocks.synchronize, {}, { headers });

        return useStockDataStore.getState().stocks;
    } catch (error) {
        logger.logError(LogCategory.SYNC, error instanceof Error ? error : new Error('Unknown error'), 'Error syncing user stocks');
        throw error;
    }
};



export const syncStockToServer = async (symbol: string, quantity = 0, averageCost = 0) => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();

    try {
        if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
            logger.log(LogCategory.SYNC, `User not authenticated, adding stock ${symbol} to sync queue`);
            addToSyncQueue({
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
            useStockDataStore.setState((state) => {
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
        useStockDataStore.setState((state) => {
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
        addToSyncQueue({
            action: 'add',
            symbol,
            quantity,
            averageCost
        });
        throw error;
    }
};


export const deleteStockFromServer = async (symbol: string) => {
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
        addToSyncQueue({
            action: 'delete',
            symbol
        });

        throw error;
    }
};


// 添加新方法實現
export const uploadLocalStocksToServer = async () => {
    const logger = LoggerService.getInstance();
    const sessionStore = useSessionStore.getState();

    try {
        // 檢查用戶是否已登入
        if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
            logger.warning(LogCategory.SYNC, '用戶未登入，無法上傳本地股票資料');
            return;
        }

        // 獲取本地股票列表
        const localStocks = useStockDataStore.getState().stocks.filter(stock => stock.cost);

        if (localStocks.length === 0) {
            logger.log(LogCategory.SYNC, '沒有本地持股資料需要上傳');
            return;
        }

        logger.log(LogCategory.SYNC, `Found ${localStocks.length} local stocks with cost, uploading...`);

        // 將這些股票加入同步佇列
        for (const stock of localStocks) {
            addToSyncQueue({
                action: 'add',
                symbol: stock.symbol,
                quantity: stock.cost?.quantity || 0,
                averageCost: stock.cost?.averageCost || 0
            });
        }

        // 處理同步佇列
        await processSyncQueue();
    } catch (error) {
        logger.logError(LogCategory.SYNC, error, 'Failed to upload local stocks to server');
        throw error;
    }
};


const showConflictResolutionDialog = async (
    symbol: string,
    serverData: { quantity: number; average_cost: number; last_sync_timestamp: number },
    clientData: { quantity: number; average_cost: number; last_sync_timestamp: number }
): Promise<string | undefined> => {
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
};

const showMergeDialog = async (
    symbol: string,
    serverData: { quantity: number; average_cost: number },
    clientData: { quantity: number; average_cost: number }
): Promise<{ quantity: number; averageCost: number } | undefined> => {
    // 顯示手動合併對話框
    const quantityInput = await vscode.window.showInputBox({
        prompt: `請輸入 ${symbol} 的股數`,
        value: clientData.quantity.toString(),
        validateInput: (value) => {
            const num = parseInt(value);
            return (!isNaN(num) && num >= 0) ? null : '請輸入有效的股數';
        }
    });

    if (quantityInput === undefined) {
        return undefined;
    }

    const averageCostInput = await vscode.window.showInputBox({
        prompt: `請輸入 ${symbol} 的平均成本`,
        value: clientData.average_cost.toString(),
        validateInput: (value) => {
            const num = parseFloat(value);
            return (!isNaN(num) && num >= 0) ? null : '請輸入有效的成本';
        }
    });

    if (averageCostInput === undefined) {
        return undefined;
    }

    return {
        quantity: parseInt(quantityInput),
        averageCost: parseFloat(averageCostInput)
    };
};
