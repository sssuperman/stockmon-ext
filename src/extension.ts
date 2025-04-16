import * as vscode from 'vscode';
import { LanguageManager } from './i18n/languageManager';
import { useWebSocketStore, WebSocketEvents } from './store/websocketStore';
import { useStockDataStore } from './store/stockDataStore';
import { useSessionStore } from './store/sessionStore';
import { StockPanel } from './stockPanel';
import { ExtensionContextManager } from './utilities/contextManager';
import { LoggerService, LogCategory, LogLevel } from './utilities/loggerService';
import { PortfolioViewProvider } from './views/portfolioView';
import { subscribeToAllStocks } from './store/stockDataStoreActionsSubscribe';
import { startAutoSync, stopAutoSync, syncUserStocksFromServer } from './store/stockDataActionUserSync';
import { StatusBarManager } from './statusBar';
import { StockmonUriHandler } from './uriHandler';
import { registerCommands } from './commandRegistry';
import { useAlertStore } from './store/alertStore';

export async function activate(context: vscode.ExtensionContext) {
    // Initialize the context manager first
    ExtensionContextManager.initialize(context);
    // Initialize and register the logger service
    const logger = LoggerService.getInstance();
    logger.register(context);
    // 記錄啟動信息
    logger.info(LogCategory.EXTENSION, `Activating stockmon extension with ID: ${context.extension.id}`);
    logger.info(LogCategory.EXTENSION, `URI Scheme: ${vscode.env.uriScheme}`);
    logger.info(LogCategory.EXTENSION, `Activation events: ${context.extension.packageJSON.activationEvents.join(', ')}`);
    logger.info(LogCategory.EXTENSION, `Extension Path: ${context.extensionPath}`);

    // 設置日誌級別 - 從設置中讀取
    const config = vscode.workspace.getConfiguration('stockmon');
    const configLogLevel = config.get<string>('logLevel');
    // 確保我們有一個有效的日誌級別字符串
    if (configLogLevel && Object.keys(LogLevel).includes(configLogLevel)) {
        const logLevel = LogLevel[configLogLevel as keyof typeof LogLevel];
        logger.setLogLevel(logLevel);
        logger.debug(LogCategory.EXTENSION, `Logger initialized with level ${configLogLevel} (${logLevel})`);
    } else {
        logger.setLogLevel(LogLevel.INFO); // 默認為 INFO
        logger.info(LogCategory.EXTENSION, `Logger initialized with default level INFO`);
    }

    // 註冊所有命令
    registerCommands(context, logger, LogLevel[configLogLevel as keyof typeof LogLevel]);
    // 註冊 URI 處理器
    const stockmonUriHandler = new StockmonUriHandler(logger);
    stockmonUriHandler.setContext(context);
    context.subscriptions.push(vscode.window.registerUriHandler(stockmonUriHandler));

    // 初始化並註冊狀態欄管理器
    const statusBarManager = StatusBarManager.getInstance();
    statusBarManager.register(context);

    // 訂閱 WebSocket 狀態變化
    useWebSocketStore.subscribe(async (state) => {
        // 當 WebSocket 連接成功時，訂閱所有股票
        if (state.wsState === 'CONNECTED') {
            logger.info(LogCategory.WEBSOCKET, 'WebSocket connected, initializing data...');
            // 直接訂閱所有本地股票，不需要等待同步
            await subscribeToAllStocks();
            
            // 添加警報訂閱
            logger.info(LogCategory.WEBSOCKET, 'Subscribing to stock alerts...');
            useWebSocketStore.getState().subscribeAlert();
        }
    });

    // 註冊股票組合視圖
    const portfolioViewProvider = new PortfolioViewProvider();
    const portfolioView = vscode.window.createTreeView('stockmonPortfolio', {
        treeDataProvider: portfolioViewProvider,
        showCollapseAll: true
    });

    // 將視圖和視圖提供者添加到訂閱中
    context.subscriptions.push(portfolioView);
    context.subscriptions.push(portfolioViewProvider);

    const languageManager = LanguageManager.getInstance();
    let messages = languageManager.getMessage();

    // 初始化 WebSocket store
    const wsStore = useWebSocketStore.getState();
    try {
        logger.info(LogCategory.EXTENSION, 'Starting extension activation...');

        // 加載保存的會話狀態
        logger.debug(LogCategory.EXTENSION, 'Loading session state...');
        await useSessionStore.getState().loadFromGlobalState(context);
        // 獲取加載後的狀態
        const sessionStore = useSessionStore.getState();
        logger.info(LogCategory.EXTENSION, `Auth token loaded: ${!!sessionStore.authToken}`);
        logger.info(LogCategory.EXTENSION, `Session state: ${JSON.stringify(sessionStore.sessionInfo)}`);
        logger.info(LogCategory.EXTENSION, `Authentication state: ${sessionStore.isAuthenticated}`);
        // 先載入本地股票清單
        logger.info(LogCategory.EXTENSION, 'Loading local stocks...');
        useStockDataStore.getState().loadFromGlobalState();
        // 檢查會話是否有效
        if (sessionStore.isValidSession()) {
            logger.info(LogCategory.EXTENSION, 'Valid session found, starting background sync');
            // 在背景進行同步，不阻塞主流程
            setTimeout(async () => {
                try {
                    // 確認用戶已登入才進行同步
                    if (sessionStore.isAuthenticated && sessionStore.authToken) {
                        logger.info(LogCategory.EXTENSION, 'User authenticated, syncing stocks from server');
                        await syncUserStocksFromServer();
                        startAutoSync();
                    } else {
                        logger.info(LogCategory.EXTENSION, 'User not authenticated, skipping sync');
                    }
                } catch (error) {
                    logger.logError(LogCategory.EXTENSION, error, 'Background sync error');
                }
            }, 0);
        } else {
            // 如果會話無效，清除相關狀態
            logger.info(LogCategory.EXTENSION, 'Invalid session, clearing session state');
            if (sessionStore.authToken) {
                await sessionStore.setAuthToken(null, context);
                await sessionStore.setSessionInfo(null, context);
            }
            // 確保停止自動同步
            stopAutoSync();
        }

        // 在所有初始化完成後連接 WebSocket
        logger.info(LogCategory.EXTENSION, 'Initiating WebSocket connection after session initialization');
        wsStore.connect(logger);

    } catch (error) {
        logger.logError(LogCategory.EXTENSION, error, 'Error during extension activation');
        wsStore.connect(logger);
    }

    // 建立股票提醒通知
    const alertNotifications: Map<string, vscode.StatusBarItem> = new Map();
    
    // 用於防抖處理的通知記錄
    const recentAlerts: Map<string, number> = new Map();
    const ALERT_DEBOUNCE_TIME = 5000; // 5秒內同一股票的提醒只顯示一次
    
    // 訂閱直接從 WebSocket 收到的提醒事件
    const unsubscribeWebSocketAlerts = WebSocketEvents.addEventListener(
        WebSocketEvents.STOCK_ALERT_RECEIVED,
        (alertData: any) => {
            const stockSymbol = alertData.symbol;
            const alertId = `ws-${alertData.id}`;
            const now = Date.now();
            
            // 檢查最近是否已經顯示過同一股票的提醒
            const lastAlertTime = recentAlerts.get(stockSymbol) || 0;
            if (now - lastAlertTime < ALERT_DEBOUNCE_TIME) {
                logger.debug(LogCategory.ALERT, `忽略短時間內重複的 ${stockSymbol} 提醒`);
                return;
            }
            
            // 記錄此次提醒時間
            recentAlerts.set(stockSymbol, now);
            
            // 如果通知已經存在，就不再創建
            if (alertNotifications.has(alertId)) {
                return;
            }
            
            logger.info(LogCategory.ALERT, `顯示股票提醒: ${JSON.stringify(alertData)}`);
            
            // 創建通知
            try {
                const notification = vscode.window.createStatusBarItem(
                    vscode.StatusBarAlignment.Right,
                    100 // 提醒通知優先級高於添加股票按鈕
                );
                
                const stockName = alertData.name || alertData.symbol;
                const alertTypeText = alertData.alertType.replace(/_/g, ' ').toLowerCase();
                
                // 添加時間信息到狀態欄文本中
                const timeDisplay = alertData.formattedTime || 
                    (alertData.timestamp ? new Date(alertData.timestamp).toLocaleTimeString() : 
                     new Date().toLocaleTimeString());
                
                notification.text = `$(alert) ${stockName} [${timeDisplay}]`;
                
                // 構建提醒詳細信息
                let alertDetails = '';
                if (alertData.threshold && alertData.price) {
                    // 根據不同的提醒類型提供更詳細的提示
                    switch (alertData.alertType) {
                        case 'PRICE_ABOVE':
                            alertDetails = `價格 ${alertData.price} 已超過 ${alertData.threshold}`;
                            break;
                        case 'PRICE_BELOW':
                            alertDetails = `價格 ${alertData.price} 已低於 ${alertData.threshold}`;
                            break;
                        case 'CHANGE_ABOVE':
                            alertDetails = `漲幅 ${alertData.change_percent || ''}% 已超過 ${alertData.threshold}%`;
                            break;
                        case 'CHANGE_BELOW':
                            alertDetails = `跌幅 ${Math.abs(alertData.change_percent || 0)}% 已超過 ${alertData.threshold}%`;
                            break;
                        default:
                            // 如果是其他類型的提醒，或者如果有自定義消息，直接顯示
                            alertDetails = alertData.message || `${alertTypeText}: 目標 ${alertData.threshold}, 現值 ${alertData.price || alertData.currentValue}`;
                    }
                } else {
                    // 如果沒有閾值和價格信息，就使用提供的消息
                    alertDetails = alertData.message || alertTypeText;
                }
                
                // 添加時間信息到工具提示中
                notification.tooltip = `${stockName}: ${alertDetails}\n觸發時間: ${alertData.formattedTime || new Date(alertData.timestamp).toLocaleString()}`;
                
                // 點擊通知打開股票面板
                notification.command = {
                    title: '查看提醒',
                    command: 'stockmon.showPanel',
                    arguments: [{ symbol: alertData.symbol }]
                };
                
                notification.show();
                
                // 存儲通知引用
                alertNotifications.set(alertId, notification);
                
                // 添加到訂閱中清理
                context.subscriptions.push(notification);
                
                // 5秒後自動移除通知
                setTimeout(() => {
                    const notificationToRemove = alertNotifications.get(alertId);
                    if (notificationToRemove) {
                        notificationToRemove.dispose();
                        alertNotifications.delete(alertId);
                    }
                }, 5000);
                
                // 同時發送 VSCode 通知 (僅對非測試提醒)
                if (!alertData.test) {
                    vscode.window.showInformationMessage(
                        `${stockName} 提醒: ${alertDetails} [${timeDisplay}]`,
                        '查看'
                    ).then(selection => {
                        if (selection === '查看') {
                            vscode.commands.executeCommand('stockmon.showPanel', { symbol: alertData.symbol });
                        }
                    });
                }
            } catch (error) {
                logger.logError(LogCategory.ALERT, error, '顯示提醒通知時發生錯誤');
            }
        }
    );
    
    // 添加到待清理列表
    context.subscriptions.push({ dispose: () => unsubscribeWebSocketAlerts() });
    
    // 訂閱 AlertStore 的變化
    // const unsubscribeAlertStore = useAlertStore.subscribe((state) => {
    //     if (state.alerts.length > 0) {
    //         // 檢查最新的提醒
    //         const latestAlerts = state.alerts.slice(0, 5); // 只處理最新的5個提醒
            
    //         latestAlerts.forEach(alert => {
    //             const alertId = `${alert.id}`;
                
    //             // 如果通知已經存在，就不再創建
    //             if (alertNotifications.has(alertId)) {
    //                 return;
    //             }
                
    //             // 創建通知
    //             const notification = vscode.window.createStatusBarItem(
    //                 vscode.StatusBarAlignment.Right,
    //                 100 // 提醒通知優先級高於添加股票按鈕
    //             );
                
    //             const stockName = alert.stock?.name || alert.stock?.symbol || '';
    //             const alertTypeText = alert.alert_rule?.alert_type?.replace(/_/g, ' ').toLowerCase() || '警報';
                
    //             // 獲取可能存在的歷史數據
    //             let historyData = state.alertHistory.find(h => h.stock_alert_id === alert.id);
                
    //             // 添加時間信息到狀態欄文本中
    //             let timeDisplay = '最新';
    //             if (historyData) {
    //                 // 優先使用擴展的時間字段
    //                 timeDisplay = historyData.formatted_time || 
    //                     (historyData.timestamp ? new Date(historyData.timestamp).toLocaleTimeString() : 
    //                      (historyData.triggered_at ? new Date(historyData.triggered_at).toLocaleTimeString() : 
    //                       (historyData.time ? new Date(historyData.time).toLocaleTimeString() : '最新')));
    //             } else if (alert.last_triggered) {
    //                 timeDisplay = new Date(alert.last_triggered).toLocaleTimeString();
    //             }
                
    //             notification.text = `$(alert) ${stockName} [${timeDisplay}]`;
                
    //             // 構建提醒詳細信息
    //             let alertDetails = '';
    //             // 從 alert_rule 獲取閾值和其他詳細信息
    //             const threshold = alert.alert_rule?.threshold;
    //             const alertType = alert.alert_rule?.alert_type;
                
    //             if (threshold && historyData) {
    //                 // 從歷史數據中獲取價格和變化百分比
    //                 const currentPrice = historyData.price;
    //                 const changePercent = historyData.change_percent;
                    
    //                 // 根據不同的提醒類型提供更詳細的提示
    //                 switch (alertType) {
    //                     case 'PRICE_ABOVE':
    //                         alertDetails = `價格 ${currentPrice} 已超過 ${threshold}`;
    //                         break;
    //                     case 'PRICE_BELOW':
    //                         alertDetails = `價格 ${currentPrice} 已低於 ${threshold}`;
    //                         break;
    //                     case 'CHANGE_ABOVE':
    //                         alertDetails = `漲幅 ${changePercent}% 已超過 ${threshold}%`;
    //                         break;
    //                     case 'CHANGE_BELOW':
    //                         alertDetails = `跌幅 ${Math.abs(changePercent)}% 已超過 ${threshold}%`;
    //                         break;
    //                     default:
    //                         // 如果是其他類型的提醒，顯示一般信息
    //                         alertDetails = `${alertTypeText}: 目標 ${threshold}, 現值 ${currentPrice || historyData.current_value}`;
    //                 }
    //             } else {
    //                 // 如果沒有閾值和價格信息，只顯示提醒類型
    //                 alertDetails = alert.alert_rule?.description || alertTypeText;
    //             }
                
    //             // 添加時間信息到工具提示中
    //             notification.tooltip = `${stockName}: ${alertDetails}\n觸發時間: ${timeDisplay}`;
                
    //             // 點擊通知打開股票面板
    //             notification.command = {
    //                 title: '查看提醒',
    //                 command: 'stockmon.showPanel',
    //                 arguments: [{ symbol: alert.stock?.symbol }]
    //             };
                
    //             notification.show();
                
    //             // 存儲通知引用
    //             alertNotifications.set(alertId, notification);
                
    //             // 添加到訂閱中清理
    //             context.subscriptions.push(notification);
                
    //             // 5秒後自動移除通知
    //             setTimeout(() => {
    //                 const notificationToRemove = alertNotifications.get(alertId);
    //                 if (notificationToRemove) {
    //                     notificationToRemove.dispose();
    //                     alertNotifications.delete(alertId);
    //                 }
    //             }, 5000);
                
    //             // 同時發送 VSCode 通知
    //             vscode.window.showInformationMessage(
    //                 `${stockName} 警報: ${alertDetails} [${timeDisplay}]`,
    //                 '查看'
    //             ).then(selection => {
    //                 if (selection === '查看') {
    //                     vscode.commands.executeCommand('stockmon.showPanel', { symbol: alert.stock?.symbol });
    //                 }
    //             });
    //         });
    //     }
    // });
    
    // // 添加到待清理列表
    // context.subscriptions.push({ dispose: () => unsubscribeAlertStore() });
    
    // 在 WebSocket 連接後載入提醒
    useWebSocketStore.subscribe(async (state) => {
        if (state.wsState === 'CONNECTED' && useSessionStore.getState().isAuthenticated) {
            logger.info(LogCategory.ALERT, 'WebSocket connected, fetching alert data...');
            try {
                await useAlertStore.getState().fetchAlerts();
                logger.info(LogCategory.ALERT, 'Alert data fetched successfully');
            } catch (error) {
                logger.logError(LogCategory.ALERT, error, 'Error fetching alert data');
            }
        }
    });

    // Function to update command titles based on current language
    // Multiple languages command are supported here
    function updateCommandTitles() {
        const messages = languageManager.getMessage();
        const commands = [
            { id: 'stockmon.addStock', title: messages.commands.addStock },
            { id: 'stockmon.searchStocks', title: messages.commands.searchStocks },
            { id: 'stockmon.deleteStock', title: messages.commands.deleteStock },
            { id: 'stockmon.refresh', title: messages.commands.refresh },
            { id: 'stockmon.setCost', title: messages.commands.setCost },
            { id: 'stockmon.setPriceAlert', title: messages.commands.setPriceAlert },
            { id: 'stockmon.managePriceAlerts', title: messages.commands.managePriceAlerts },
            { id: 'stockmon.login', title: messages.commands.login },
            { id: 'stockmon.logout', title: messages.commands.logout },
            { id: 'stockmon.showPanel', title: messages.commands.showPanel },
            { id: 'stockmon.clearAllSubscriptions', title: messages.commands.clearAllSubscriptions },
            { id: 'stockmon.showSessionInfo', title: messages.commands.showSessionInfo },
            { id: 'stockmon.syncUserStocks', title: messages.commands.syncUserStocks },
            { id: 'stockmon.manualSync', title: messages.commands.manualSync }
        ];

        commands.forEach(cmd => {
            vscode.commands.executeCommand('setContext', `${cmd.id}.title`, cmd.title);
        });
    }

    // Update command titles when language changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            const newLocale = vscode.env.language;
            if (newLocale !== languageManager.getCurrentLocale()) {
                messages = languageManager.getMessage();
                updateCommandTitles();
                // updateStockDisplay();
            }
        })
    );

    // Initial update of command titles
    updateCommandTitles();



    // 監聽配置變更
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('stockmon.logLevel')) {
                const newConfig = vscode.workspace.getConfiguration('stockmon');
                const newLogLevel = newConfig.get<string>('logLevel');

                if (newLogLevel && Object.keys(LogLevel).includes(newLogLevel)) {
                    const logLevel = LogLevel[newLogLevel as keyof typeof LogLevel];
                    logger.setLogLevel(logLevel);
                    logger.info(LogCategory.EXTENSION, `Log level changed to ${newLogLevel} (${logLevel})`);
                }
            }
        })
    );

    // 創建右下角添加股票提示
    const createStockNotificationButton = () => {
        const stocksCount = useStockDataStore.getState().stocks.length;

        if (stocksCount === 0) {
            // 建立通知
            const notification = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Right,
                99  // 設置優先級，比主狀態欄稍低
            );

            notification.text = "$(plus-circle) 建立持倉";
            notification.tooltip = "添加您的第一個股票持倉";
            notification.command = 'stockmon.createFirstStock';
            notification.show();

            // 添加到訂閱中清理
            context.subscriptions.push(notification);

            // 返回通知實例以便後續操作
            return notification;
        }

        return null;
    };

    // 初始化空持倉提示
    let emptyStockNotification = createStockNotificationButton();

    // 訂閱 Stock 數據變化，更新空持倉提示
    const unsubscribeStockStoreForNotification = useStockDataStore.subscribe((state) => {
        if (state.stocks.length === 0 && !emptyStockNotification) {
            // 如果沒有股票且提示不存在，則創建提示
            emptyStockNotification = createStockNotificationButton();
        } else if (state.stocks.length > 0 && emptyStockNotification) {
            // 如果有股票且提示存在，則移除提示
            emptyStockNotification.dispose();
            emptyStockNotification = null;
        }
    });


    // 添加到待清理列表
    context.subscriptions.push({ dispose: () => unsubscribeStockStoreForNotification() });

    // 在 StockPanel 中註冊消息處理
    StockPanel.messageHandlers.set('submitFeedback', async (message: any) => {
        try {
            // 從消息中獲取反饋數據
            const feedback = message.feedback;
            // 執行提交反饋命令
            await vscode.commands.executeCommand('stockmon.submitFeedback', feedback);
        } catch (error) {
            logger.logError(LogCategory.FEEDBACK, error, '處理反饋提交時發生錯誤');
            if (StockPanel.currentPanel) {
                StockPanel.currentPanel.postMessageToWebview({
                    type: 'feedbackResponse',
                    data: {
                        status: 'error',
                        message: '處理反饋提交時發生錯誤'
                    }
                });
            }
        }
    });
    // 初始化完成後檢查用戶持倉，如果為空則顯示通知提醒
    const checkEmptyPortfolio = async () => {
        try {
            // 確保從全域狀態加載完成數據
            await useStockDataStore.getState().loadFromGlobalState();
            const stockState = useStockDataStore.getState();
            const stocksCount = stockState.stocks.length;

            logger.info(LogCategory.EXTENSION, `Portfolio check: found ${stocksCount} stocks`);
            if (stocksCount === 0) {
                logger.info(LogCategory.EXTENSION, 'No stocks found, showing notification');
                // 顯示通知提醒用戶添加第一個持倉
                const selection = await vscode.window.showInformationMessage(
                    '歡迎使用 StockMon! 您目前沒有任何持倉，添加您的第一個持倉開始追踪您的投資組合。',
                    '添加持倉'
                );
                if (selection === '添加持倉') {
                    logger.info(LogCategory.EXTENSION, 'User clicked on add stock notification');
                    vscode.commands.executeCommand('stockmon.createFirstStock');
                }
            }
        } catch (error) {
            logger.logError(LogCategory.EXTENSION, error, 'Error checking stocks count');
        }
    };
    // 在擴展完全初始化後執行檢查
    setTimeout(checkEmptyPortfolio, 1500); // 給予 2 秒鐘的時間讓擴展完全初始化
    // 在 StockPanel 中註冊消息處理 - 添加在其他 messageHandlers 設置下方
    StockPanel.messageHandlers.set('showPortfolioView', async () => {
        try {
            // 執行顯示 Portfolio 視圖的命令
            await vscode.commands.executeCommand('stockmon.showPortfolioView');
        } catch (error) {
            logger.logError(LogCategory.PORTFOLIO, error, '處理顯示 Portfolio 視圖請求時發生錯誤');
        }
    });

    // Clean up WebSocket connection when extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            wsStore.disconnect();
        }
    });

}


export function deactivate() {
    const logger = LoggerService.getInstance();
    logger.log(LogCategory.EXTENSION, 'Extension deactivated');

    // 確保所有同步操作已完成
    try {
        const stockDataStore = useStockDataStore.getState();
        if (stockDataStore.syncQueue.length > 0) {
            logger.warning(LogCategory.SYNC, `Extension deactivated with ${stockDataStore.syncQueue.length} items in sync queue`);
        }

        // 停止自動同步
        if (stockDataStore.autoSyncEnabled) {
            stopAutoSync();
            logger.log(LogCategory.SYNC, 'Auto sync stopped on extension deactivation');
        }

        // 處置狀態欄管理器
        StatusBarManager.getInstance().dispose();
    } catch (error) {
        logger.logError(LogCategory.EXTENSION, error, 'Error during extension deactivation');
    }
}