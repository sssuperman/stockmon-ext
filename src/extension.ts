import * as vscode from 'vscode';
import { getLocaleMessages } from './i18n/locales';
import { LanguageManager } from './i18n/languageManager';
import { setUseProxy } from './config';
import { useWebSocketStore } from './store/websocketStore';
import { useStockDataStore } from './store/stockDataStore';
import { useSessionStore } from './store/sessionStore';
import { StockPanel } from './stockPanel';
import { ExtensionContextManager } from './utilities/contextManager';
import axios from 'axios';
import { isTokenExpired } from './utilities/tokenUtils';
import { LoggerService, LogCategory, LogLevel } from './utilities/loggerService';
import { PortfolioViewProvider } from './views/portfolioView';

export async function activate(context: vscode.ExtensionContext) {
    // Initialize the context manager first
    ExtensionContextManager.initialize(context);

    // Initialize and register the logger service
    const logger = LoggerService.getInstance();
    logger.register(context);
    
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

    // 創建狀態欄項目
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.name = "StockMon";
    statusBarItem.command = 'stockmon.showPanel';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // 創建一個命令來顯示登入/登出選項
    let showLoginOptionsCommand = vscode.commands.registerCommand('stockmon.showLoginOptions', async () => {
        const sessionState = useSessionStore.getState();
        
        if (sessionState.isAuthenticated) {
            // 已登入，顯示用戶選項
            const selected = await vscode.window.showQuickPick([
                { label: '$(account) 用戶資訊', description: `已登入為 ${sessionState.sessionInfo?.user || 'User'}`, id: 'info' },
                { label: '$(sign-out) 登出', description: '登出當前帳號', id: 'logout' }
            ], {
                placeHolder: '選擇操作'
            });
            
            if (selected) {
                if (selected.id === 'logout') {
                    vscode.commands.executeCommand('stockmon.logout');
                } else if (selected.id === 'info') {
                    vscode.commands.executeCommand('stockmon.showSessionInfo');
                }
            }
        } else {
            // 未登入，直接執行登入命令
            vscode.commands.executeCommand('stockmon.login');
        }
    });
    
    context.subscriptions.push(showLoginOptionsCommand);

    // 更新狀態欄，整合連線狀態、登入狀態和損益
    function updateStatusBar() {
        const stockState = useStockDataStore.getState();
        const sessionState = useSessionStore.getState();
        const wsState = useWebSocketStore.getState().wsState;
        
        // 計算損益
        const { totalProfit, hasPositions } = stockState.calculateTotalProfit();
        
        // 設置連線圖示
        let connectionIcon = '';
        let connectionTooltip = '';
        
        switch (wsState) {
            case 'CONNECTED':
                connectionIcon = '$(radio-tower)';
                connectionTooltip = "已連線到股票服務";
                break;
            case 'CONNECTING':
            case 'RECONNECTING':
                connectionIcon = '$(sync~spin)';
                connectionTooltip = "正在連線到股票服務...";
                break;
            default:
                connectionIcon = '$(warning)';
                connectionTooltip = "未連線到股票服務";
                break;
        }
        
        // 設置登入圖示
        let loginIcon = sessionState.isAuthenticated ? '$(account)' : '$(sign-in)';
        let loginTooltip = sessionState.isAuthenticated 
            ? `已登入為 ${sessionState.sessionInfo?.user || 'User'}` 
            : '點擊登入';
        
        // 設置損益文字
        let profitText = '';
        let profitColor = undefined;
        
        if (hasPositions) {
            const formattedProfit = Math.round(totalProfit).toLocaleString();
            
            if (totalProfit > 0) {
                profitColor = new vscode.ThemeColor('charts.red');
                profitText = `+${formattedProfit}`;
            } else if (totalProfit < 0) {
                profitColor = new vscode.ThemeColor('charts.green');
                profitText = `${formattedProfit}`;
            } else {
                profitText = `${formattedProfit}`;
            }
        }
        
        // 組合狀態欄文字
        if (hasPositions) {
            statusBarItem.text = `${connectionIcon} ${profitText} ${loginIcon}`.trim();
        } else {
            statusBarItem.text = `${connectionIcon} ${loginIcon}`.trim();
        }
        statusBarItem.tooltip = `${connectionTooltip} | ${loginTooltip}`;
        statusBarItem.color = profitColor;
        
        // 設置點擊命令
        if (!sessionState.isAuthenticated) {
            // 未登入時，點擊顯示登入選項
            statusBarItem.command = 'stockmon.showLoginOptions';
        } else {
            // 已登入時，點擊顯示面板
            statusBarItem.command = 'stockmon.showPanel';
        }
    }

    // 初始更新
    updateStatusBar();

    // 訂閱 WebSocket 狀態變化
    useWebSocketStore.subscribe(async (state) => {
        updateStatusBar();
        
        // 當 WebSocket 連接成功時，訂閱所有股票
        if (state.wsState === 'CONNECTED') {
            logger.info(LogCategory.WEBSOCKET, 'WebSocket connected, initializing data...');
            // 直接訂閱所有本地股票，不需要等待同步
            await useStockDataStore.getState().subscribeToAllStocks();
        }
    });

    // 訂閱 Session 狀態變化
    const unsubscribeSessionStore = useSessionStore.subscribe(() => {
        updateStatusBar();
    });

    // 訂閱 Stock 數據變化
    useStockDataStore.subscribe(() => {
        updateStatusBar();
    });

    // 添加到待清理列表
    context.subscriptions.push({ dispose: () => unsubscribeSessionStore() });

    // 註冊股票組合視圖
    const portfolioViewProvider = new PortfolioViewProvider();
    const portfolioView = vscode.window.createTreeView('stockmonPortfolio', {
        treeDataProvider: portfolioViewProvider,
        showCollapseAll: true
    });
    
    // 註冊刷新股票組合命令
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.refreshPortfolio', () => {
            logger.info(LogCategory.PORTFOLIO, 'Refreshing portfolio view...');
            portfolioViewProvider.refresh();
            vscode.window.showInformationMessage('Portfolio refreshed');
        })
    );
    
    // 註冊顯示股票詳情命令
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.showStockDetail', async (symbolOrStock: string | any) => {
            // 處理參數可能是對象的情況
            let symbol: string;
            
            if (typeof symbolOrStock === 'string') {
                symbol = symbolOrStock;
            } else if (symbolOrStock && typeof symbolOrStock === 'object' && symbolOrStock.symbol) {
                // 如果傳入的是股票對象，提取 symbol 屬性
                symbol = symbolOrStock.symbol;
            } else {
                logger.logError(LogCategory.PORTFOLIO, `Invalid argument for showStockDetail: ${JSON.stringify(symbolOrStock)}`);
                vscode.window.showErrorMessage('Invalid stock information');
                return;
            }
            
            logger.info(LogCategory.PORTFOLIO, `Showing details for stock: ${symbol}`);
            
            try {
                const stockState = useStockDataStore.getState();
                const stock = stockState.stocks.find(s => s.symbol === symbol);
                
                if (!stock) {
                    logger.warning(LogCategory.PORTFOLIO, `Stock not found: ${symbol}`);
                    vscode.window.showWarningMessage(`Stock not found: ${symbol}`);
                    return;
                }
                
                // 使用 StockPanel 顯示股票詳情
                if (!StockPanel.currentPanel) {
                    // 如果面板不存在，創建一個新的面板
                    StockPanel.createOrShow(context.extensionUri);
                    
                    // 等待面板初始化完成
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                // 發送消息到 webview 顯示股票詳情
                StockPanel.currentPanel?.showStockDetail(symbol);
                
                logger.debug(LogCategory.PORTFOLIO, `Stock detail request sent to panel for ${symbol}`);
            } catch (error) {
                logger.logError(LogCategory.PORTFOLIO, error, `Error showing stock detail for ${symbol}`);
                vscode.window.showErrorMessage(`Error showing stock details: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
    
    // 註冊從按鈕顯示股票詳情命令
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.showStockDetailFromButton', async (item: any) => {
            // 從 TreeItem 中獲取股票信息
            if (!item || !item.stock || !item.stock.symbol) {
                logger.warning(LogCategory.PORTFOLIO, `Invalid item for showStockDetailFromButton: ${JSON.stringify(item)}`);
                vscode.window.showWarningMessage('Cannot show stock details: Invalid stock item');
                return;
            }
            
            const symbol = item.stock.symbol;
            logger.info(LogCategory.PORTFOLIO, `Showing details for stock from button: ${symbol}`);
            
            try {
                const stockState = useStockDataStore.getState();
                const stock = stockState.stocks.find(s => s.symbol === symbol);
                
                if (!stock) {
                    logger.warning(LogCategory.PORTFOLIO, `Stock not found: ${symbol}`);
                    vscode.window.showWarningMessage(`Stock not found: ${symbol}`);
                    return;
                }
                
                // 使用 StockPanel 顯示股票詳情
                if (!StockPanel.currentPanel) {
                    // 如果面板不存在，創建一個新的面板
                    StockPanel.createOrShow(context.extensionUri);
                    
                    // 等待面板初始化完成
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                // 發送消息到 webview 顯示股票詳情
                StockPanel.currentPanel?.showStockDetail(symbol);
                
                logger.debug(LogCategory.PORTFOLIO, `Stock detail request sent to panel for ${symbol}`);
            } catch (error) {
                logger.logError(LogCategory.PORTFOLIO, error, `Error showing stock detail for ${symbol}`);
                vscode.window.showErrorMessage(`Error showing stock details: ${error}`);
            }
        })
    );
    
    // 將視圖和視圖提供者添加到訂閱中
    context.subscriptions.push(portfolioView);
    context.subscriptions.push(portfolioViewProvider);

    const languageManager = LanguageManager.getInstance();
    const stockState = useStockDataStore.getState();
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
                        await useStockDataStore.getState().syncUserStocksFromServer();
                        useStockDataStore.getState().startAutoSync();
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
            useStockDataStore.getState().stopAutoSync();
        }

        // 在所有初始化完成後連接 WebSocket
        logger.info(LogCategory.EXTENSION, 'Initiating WebSocket connection after session initialization');
        wsStore.connect(logger);

    } catch (error) {
        logger.logError(LogCategory.EXTENSION, error, 'Error during extension activation');
        wsStore.connect(logger);
    }

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
            { id: 'stockmon.manualCheckPriceAlerts', title: messages.commands.manualCheckPriceAlerts },
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



    // 修改登入命令
    let loginCommand = vscode.commands.registerCommand('stockmon.login', async () => {
        try {
            const username = await vscode.window.showInputBox({
                prompt: messages.auth.username,
                placeHolder: messages.auth.username
            });

            if (!username) {
                return;
            }

            const password = await vscode.window.showInputBox({
                prompt: messages.auth.password,
                placeHolder: messages.auth.password,
                password: true
            });

            if (!password) {
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: messages.auth.loggingIn,
                cancellable: false
            }, async (progress) => {
                try {
                    const token = await useSessionStore.getState().login(username, password, context);
                    
                    // 登入成功後，開始同步
                    logger.info(LogCategory.EXTENSION, 'Login successful, starting sync');
                    await useStockDataStore.getState().syncUserStocksFromServer();
                    useStockDataStore.getState().startAutoSync();
                    
                    vscode.window.showInformationMessage(messages.auth.loginSuccess);
                    return token;
                } catch (error) {
                    logger.logError(LogCategory.EXTENSION, error, 'Login failed');
                    vscode.window.showErrorMessage(messages.auth.loginFailed);
                    throw error;
                }
            });
        } catch (error) {
            logger.logError(LogCategory.EXTENSION, error, 'Login command error');
        }
    });

    // 修改登出命令
    let logoutCommand = vscode.commands.registerCommand('stockmon.logout', async () => {
        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: messages.auth.loggingOut,
                cancellable: false
            }, async (progress) => {
                try {
                    // 先停止同步
                    logger.info(LogCategory.EXTENSION, 'Stopping sync before logout');
                    useStockDataStore.getState().stopAutoSync();
                    
                    // 然後登出
                    await useSessionStore.getState().logout(context);
                    vscode.window.showInformationMessage(messages.auth.logoutSuccess);
                } catch (error) {
                    logger.logError(LogCategory.EXTENSION, error, 'Logout failed');
                    vscode.window.showErrorMessage(messages.auth.logoutFailed);
                    throw error;
                }
            });
        } catch (error) {
            logger.logError(LogCategory.EXTENSION, error, 'Logout command error');
        }
    });


    let showSessionInfoCommand = vscode.commands.registerCommand('stockmon.showSessionInfo', () => {
        useSessionStore.getState().showSessionInfoAndAuthToken(logger);
    });


    // 註冊顯示面板命令
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.showPanel', async () => {
            logger.log(LogCategory.EXTENSION, 'Show Panel command triggered');
            
            // 確保在顯示面板前有數據
            const stockState = useStockDataStore.getState();
            logger.log(LogCategory.EXTENSION, `Current stocks in store: ${stockState.stocks.length}, has index: ${!!stockState.twseIndex}`);
            
            // 如果 WebSocket 未連接，則重新連接
            if (useWebSocketStore.getState().wsState !== 'CONNECTED') {
                logger.log(LogCategory.EXTENSION, 'WebSocket not connected, reconnecting...');
                wsStore.disconnect();
                wsStore.connect(logger);
                
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Connecting to stock service...",
                    cancellable: false
                }, async (progress) => {
                    return new Promise<void>((resolve) => {
                        const unsub = useWebSocketStore.subscribe((state) => {
                            if (state.wsState === 'CONNECTED') {
                                logger.log(LogCategory.EXTENSION, 'WebSocket connected, proceeding to show panel');
                                unsub();
                                resolve();
                            }
                        });
                        
                        // 10 秒後超時
                        setTimeout(() => {
                            unsub();
                            logger.log(LogCategory.EXTENSION, 'WebSocket connection timed out, showing panel anyway');
                            resolve();
                        }, 10000);
                    });
                });
            }
            
            // 創建並顯示面板
            const panel = StockPanel.createOrShow(context.extensionUri);
        })
    );


    // 設定到價提醒命令
    let setPriceAlertCommand = vscode.commands.registerCommand('stockmon.setPriceAlert', async (symbol?: string) => {
        const config = vscode.workspace.getConfiguration('stockmon');
        const stocks = config.get<string[]>('symbols', []);

        if (stocks.length === 0) {
            vscode.window.showWarningMessage('請先設定要追蹤的股票');
            return;
        }

        // 如果沒有傳入symbol，讓使用者選擇要設定提醒的股票
        if (!symbol) {
            symbol = await vscode.window.showQuickPick(stocks, {
                placeHolder: '選擇要設定到價提醒的股票'
            });
        }

        if (symbol) {
            // 選擇提醒類型
            const alertType = await vscode.window.showQuickPick(
                ['價格上漲至', '價格下跌至'],
                { placeHolder: '選擇提醒類型' }
            );

            if (alertType) {
                const isAbove = alertType === '價格上漲至';

                // 輸入目標價格
                const priceInput = await vscode.window.showInputBox({
                    prompt: `輸入 ${symbol} 的目標價格`,
                    validateInput: (value) => {
                        if (!value) {
                            return '請輸入價格';
                        }
                        const price = parseFloat(value);
                        if (isNaN(price) || price <= 0) {
                            return '請輸入有效的價格';
                        }
                        return null;
                    }
                });

                if (priceInput) {
                    const targetPrice = parseFloat(priceInput);
                    // stockService.setPriceAlert(symbol, targetPrice, isAbove);
                    const direction = isAbove ? '上漲至' : '下跌至';
                    vscode.window.showInformationMessage(
                        `已設定 ${symbol} 股價${direction} ${targetPrice} 的提醒`
                    );
                }
            }
        }
    });

    // // 管理到價提醒命令
    // let managePriceAlertsCommand = vscode.commands.registerCommand('stockmon.managePriceAlerts', async () => {
    //     const allAlerts = stockService.getAllPriceAlerts();
    //     if (allAlerts.size === 0) {
    //         vscode.window.showInformationMessage('目前沒有設定任何到價提醒');
    //         return;
    //     }

    //     // 建立提醒清單項目
    //     const items: vscode.QuickPickItem[] = [];
    //     allAlerts.forEach((alerts, symbol) => {
    //         alerts.forEach(alert => {
    //             const direction = alert.type === 'above' ? '上漲至' : '下跌至';
    //             items.push({
    //                 label: symbol,
    //                 description: `${direction} ${alert.price}`,
    //                 detail: '點擊以移除此提醒'
    //             });
    //         });
    //     });

    //     // 顯示提醒清單
    //     const selected = await vscode.window.showQuickPick(items, {
    //         placeHolder: '選擇要移除的到價提醒'
    //     });

    //     if (selected) {
    //         const symbol = selected.label;
    //         const price = parseFloat(selected.description!.split(' ')[1]);
    //         const isAbove = selected.description!.includes('上漲至');

    //         stockService.removePriceAlert(symbol, price, isAbove);
    //         vscode.window.showInformationMessage(`已移除 ${symbol} 的到價提醒`);
    //     }
    // });



    // Add Stock Command by search stocks   
    let addStockCommand = vscode.commands.registerCommand('stockmon.addStock', async () => {
        try {
            const searchQuery = await vscode.window.showInputBox({
                prompt: '輸入股票代號或名稱進行搜尋',
                placeHolder: '例如: 2330 或 台積電'
            });

            if (!searchQuery) {
                return;
            }

            const searchResults = await useStockDataStore.getState().searchStocks(searchQuery);

            // 檢查搜尋結果的格式
            if (!Array.isArray(searchResults) || searchResults.length === 0) {
                vscode.window.showInformationMessage('找不到符合的股票');
                return;
            }

            // 確保每個結果都有必要的屬性
            const validResults = searchResults.filter(
                stock => stock && typeof stock.symbol === 'string' && typeof stock.name === 'string'
            );

            if (validResults.length === 0) {
                vscode.window.showInformationMessage('搜尋結果格式不正確');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                validResults.map(stock => ({
                    label: stock.symbol,
                    description: stock.name
                })),
                {
                    placeHolder: '選擇股票以加入追蹤清單'
                }
            );

            if (selected) {
                const symbol = selected.label;
                try {
                    // 使用新的 addStock 方法
                    await useStockDataStore.getState().addStock([symbol]);
                    
                    const setCostResult = await vscode.window.showInformationMessage(
                        `已新增 ${symbol} (${selected.description}) 到追蹤清單，是否要設定成本？`,
                        '是',
                        '否'
                    );

                    if (setCostResult === '是') {
                        vscode.commands.executeCommand('stockmon.setCost', symbol);
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? 
                        `新增股票失敗: ${symbol} - ${error.message}` : 
                        `新增股票失敗: ${symbol} - 未知錯誤`;
                    logger.log(LogCategory.EXTENSION, `Add stock error: ${errorMessage}`);
                    vscode.window.showErrorMessage(errorMessage);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`搜尋股票時發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
            console.error('Search stock error:', error);
        }
    });

    // 刪除股票命令
    let deleteStockCommand = vscode.commands.registerCommand('stockmon.deleteStock', async (symbolOrItem?: string | any) => {
        const currentStocks = Array.from(useStockDataStore.getState().stocks);

        // 從參數中提取股票代號
        let symbol: string | undefined;
        
        if (typeof symbolOrItem === 'string') {
            // 如果是字符串，直接使用
            symbol = symbolOrItem;
        } else if (symbolOrItem && typeof symbolOrItem === 'object') {
            // 如果是對象，嘗試從不同的屬性中獲取股票代號
            if (symbolOrItem.stock && symbolOrItem.stock.symbol) {
                // 從 StockItem 對象中獲取
                symbol = symbolOrItem.stock.symbol;
            } else if (symbolOrItem.symbol) {
                // 直接從對象中獲取
                symbol = symbolOrItem.symbol;
            } else if (symbolOrItem.label) {
                // 從標籤中獲取
                symbol = symbolOrItem.label;
            }
        }

        if (!symbol) {
            symbol = await vscode.window.showQuickPick(currentStocks.map(stock => stock.symbol), {
                placeHolder: messages.stock.selectStockToDelete
            });
        }

        if (symbol) {
            const result = await vscode.window.showWarningMessage(
                messages.stock.confirmDelete.replace('{0}', symbol),
                { modal: true },
                messages.common.confirm,
                messages.common.cancel
            );

            if (result === messages.common.confirm) {
                try {
                    await useStockDataStore.getState().removeStock(symbol);
                    vscode.window.showInformationMessage(
                        messages.stock.deleteSuccess.replace('{0}', symbol)
                    );
                } catch (error) {
                    console.error('Error deleting stock:', error);
                    vscode.window.showErrorMessage(
                        `Failed to delete stock: ${symbol} - ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
            }
        }
    });

    // 更新股價命令
    let refreshCommand = vscode.commands.registerCommand('stockmon.refresh', () => {
        // updateStockDisplay();
    });

    // 監聽設定變更
    // context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
    //     if (e.affectsConfiguration('stockmon.symbols')) {
    //         // 只需要更新顯示，不需要重新訂閱
    //         // 因為 stockState 已經保存了訂閱狀態
    //         updateStockDisplay();
    //     }
    // }));



    // 設定股票成本命令
    let setCostCommand = vscode.commands.registerCommand('stockmon.setCost', async (symbolOrItem?: string | any) => {
        const stockState = useStockDataStore.getState();
        const stocks = stockState.stocks;

        try {
            if (stocks.length === 0) {
                vscode.window.showWarningMessage(messages.stock.noStocksInList);
                return;
            }

            // 從參數中提取股票代號
            let symbol: string | undefined;
            
            if (typeof symbolOrItem === 'string') {
                // 如果是字符串，直接使用
                symbol = symbolOrItem;
            } else if (symbolOrItem && typeof symbolOrItem === 'object') {
                // 如果是對象，嘗試從不同的屬性中獲取股票代號
                if (symbolOrItem.stock && symbolOrItem.stock.symbol) {
                    // 從 StockItem 對象中獲取
                    symbol = symbolOrItem.stock.symbol;
                } else if (symbolOrItem.symbol) {
                    // 直接從對象中獲取
                    symbol = symbolOrItem.symbol;
                } else if (symbolOrItem.label) {
                    // 從標籤中獲取
                    symbol = symbolOrItem.label;
                }
            }
            
            // 如果沒有傳入symbol，讓使用者選擇要設定成本的股票
            if (!symbol) {
                const stockOptions = stocks.map(stock => ({
                    label: stock.symbol,
                    description: stock.name
                }));

                const selected = await vscode.window.showQuickPick(stockOptions, {
                    placeHolder: messages.stock.selectStock
                });

                if (selected) {
                    symbol = selected.label;
                }
            }

            if (symbol) {
                const existingStock = stocks.find(s => s.symbol === symbol);
                const existingCost = existingStock?.cost;

                // 輸入成本價格
                const costInput = await vscode.window.showInputBox({
                    prompt: messages.stock.inputCostPrice.replace('{0}', symbol),
                    value: typeof existingCost?.averageCost === 'number' ? existingCost.averageCost.toString() : '',
                    validateInput: (value) => {
                        if (!value) {
                            return messages.stock.pleaseInputPrice;
                        }
                        const cost = parseFloat(value);
                        if (isNaN(cost) || cost <= 0) {
                            return messages.stock.invalidPrice;
                        }
                        return null;
                    }
                });

                if (costInput) {
                    const costPrice = parseFloat(costInput);

                    // 輸入股數
                    const sharesInput = await vscode.window.showInputBox({
                        prompt: messages.stock.inputShares.replace('{0}', symbol),
                        value: typeof existingCost?.quantity === 'number' ? existingCost.quantity.toString() : '1000',
                        validateInput: (value) => {
                            if (!value) {
                                return messages.stock.pleaseInputShares;
                            }
                            const shares = parseInt(value);
                            if (isNaN(shares) || shares <= 0) {
                                return messages.stock.invalidShares;
                            }
                            return null;
                        }
                    });

                    if (sharesInput) {
                        const shares = parseInt(sharesInput);

                        try {
                            await stockState.updateStockCost(symbol, {
                                cost: costPrice,
                                quantity: shares,
                                averageCost: costPrice
                            });

                            vscode.window.showInformationMessage(
                                messages.stock.setCostSuccess
                                    .replace('{0}', symbol)
                                    .replace('{1}', costPrice.toString())
                                    .replace('{2}', shares.toString())
                            );
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                            vscode.window.showErrorMessage(
                                messages.stock.error
                                    .replace('{0}', symbol || '')
                                    .replace('{1}', errorMessage)
                            );
                        }
                    }
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(
                messages.stock.generalError.replace('{0}', errorMessage)
            );
        }
    });


    let listStockCommand = vscode.commands.registerCommand('stockmon.listStock', () => {
        const stocks = useStockDataStore.getState().stocks;
        logger.log(LogCategory.EXTENSION, '=== Current Stocks in Store ===');
        logger.log(LogCategory.EXTENSION, JSON.stringify(stocks, null, 2));
        logger.log(LogCategory.EXTENSION, '=== Current Index in Store ===');
        const index = useStockDataStore.getState().twseIndex;
        logger.log(LogCategory.EXTENSION, JSON.stringify(index, null, 2));
    });


    context.subscriptions.push(addStockCommand);
    context.subscriptions.push(deleteStockCommand);
    context.subscriptions.push(refreshCommand);
    // context.subscriptions.push(setCostCommand);
    // context.subscriptions.push(showDetailsCommand);
    context.subscriptions.push(setPriceAlertCommand);
    // context.subscriptions.push(managePriceAlertsCommand);
    // context.subscriptions.push(manualCheckPriceAlertsCommand);
    context.subscriptions.push(loginCommand);
    context.subscriptions.push(logoutCommand);
    context.subscriptions.push(showSessionInfoCommand);
    context.subscriptions.push(listStockCommand);

    // 添加檢查配置命令
    const checkConfigCommand = vscode.commands.registerCommand('stockmon.checkConfig', () => {
        const { config } = require('./config');
        const stockmonConfig = vscode.workspace.getConfiguration('stockmon');
        const useProxy = stockmonConfig.get<boolean>('useProxy') || false;
        
        logger.log(LogCategory.EXTENSION, '=== Current Configuration ===');
        logger.log(LogCategory.EXTENSION, `Proxy Enabled: ${useProxy}`);
        
        if (useProxy) {
            logger.log(LogCategory.EXTENSION, '=== Proxy Settings ===');
            logger.log(LogCategory.EXTENSION, `API Base URL: ${stockmonConfig.get('proxyApiBaseUrl')}`);
            logger.log(LogCategory.EXTENSION, `WebSocket Host: ${stockmonConfig.get('proxyWsHost')}`);
            logger.log(LogCategory.EXTENSION, `WebSocket Port: ${stockmonConfig.get('proxyWsPort')}`);
        }
        
        logger.log(LogCategory.EXTENSION, '=== Active Configuration ===');
        logger.log(LogCategory.EXTENSION, JSON.stringify(config, null, 2));
        
        vscode.window.showInformationMessage(`Configuration checked. Proxy: ${useProxy ? 'Enabled' : 'Disabled'}. See output panel for details.`);
    });
    context.subscriptions.push(checkConfigCommand);

    // 添加環境切換命令
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.enableProxy', async () => {
            await setUseProxy(true);
            wsStore.disconnect();
            wsStore.connect(logger);
            vscode.window.showInformationMessage('Proxy Server Enabled');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.disableProxy', async () => {
            await setUseProxy(false);
            wsStore.disconnect();
            wsStore.connect(logger);
            vscode.window.showInformationMessage('Proxy Server Disabled');
        })
    );

    // Clean up WebSocket connection when extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            wsStore.disconnect();
        }
    });

    // WebSocket 狀態命令
    let showWebSocketStateCommand = vscode.commands.registerCommand('stockmon.showWebSocketState', () => {
        const wsStore = useWebSocketStore.getState();
        const logger = LoggerService.getInstance();
        
        logger.log(LogCategory.WEBSOCKET, '=== WebSocket State ===');
        logger.log(LogCategory.WEBSOCKET, `Current state: ${wsStore.wsState}`);
        logger.log(LogCategory.WEBSOCKET, `Reconnect attempts: ${wsStore.reconnectAttempts}`);
        logger.log(LogCategory.WEBSOCKET, `Socket ready state: ${wsStore.socket?.readyState}`);
        logger.show();
    });

    // 將命令添加到 subscriptions
    context.subscriptions.push(showWebSocketStateCommand);

    // 註冊命令：處理同步隊列
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.processSyncQueue', async () => {
            try {
                logger.info(LogCategory.SYNC, 'Processing sync queue...');
                await useStockDataStore.getState().processSyncQueue();
            } catch (error) {
                logger.logError(LogCategory.SYNC, error, 'Error processing sync queue');
                vscode.window.showErrorMessage(`Failed to process sync queue: ${error}`);
            }
        })
    );

    // 註冊命令：手動同步用戶股票
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.syncUserStocks', async () => {
            try {
                await useStockDataStore.getState().syncUserStocksFromServer();
                vscode.window.showInformationMessage(messages.commands.syncUserStocks);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to sync user stocks: ${error}`);
            }
        })
    );

    // 註冊手動同步命令
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.manualSync', async () => {
            const logger = LoggerService.getInstance();
            const sessionStore = useSessionStore.getState();
            
            try {
                // 檢查用戶是否已登入
                if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
                    logger.log(LogCategory.SYNC, 'User not authenticated, cannot sync');
                    vscode.window.showWarningMessage(messages.sync.notAuthenticated);
                    return;
                }
                
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: messages.sync.syncing,
                    cancellable: false
                }, async (progress) => {
                    try {
                        // 執行同步
                        logger.log(LogCategory.SYNC, 'Manual sync triggered');
                        await useStockDataStore.getState().checkAndSync();
                        vscode.window.showInformationMessage(messages.sync.syncComplete);
                    } catch (error) {
                        logger.logError(LogCategory.SYNC, error, 'Manual sync failed');
                        vscode.window.showErrorMessage(`${messages.sync.syncFailed}: ${error instanceof Error ? error.message : '未知錯誤'}`);
                    }
                });
            } catch (error) {
                logger.logError(LogCategory.SYNC, error, 'Manual sync command error');
            }
        })
    );

    // 註冊命令：連接 WebSocket
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.connectWebSocket', () => {
            logger.info(LogCategory.WEBSOCKET, 'Manual WebSocket connection attempt...');
            useWebSocketStore.getState().connect(logger);
        })
    );

    // Stock data synchronization
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.syncStocks', async () => {
            try {
                logger.log(LogCategory.SYNC, 'Syncing stocks...');
                // ... existing code ...
            } catch (error) {
                logger.logError(LogCategory.SYNC, error, 'Error syncing stocks');
                vscode.window.showErrorMessage(`Sync error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    // 註冊命令：設置日誌級別
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.setLogLevel', async () => {
            const levels = Object.keys(LogLevel).filter(key => isNaN(Number(key)));
            const selectedLevel = await vscode.window.showQuickPick(levels, {
                placeHolder: 'Select log level',
                title: 'StockMon Log Level'
            });
            
            if (selectedLevel) {
                const logLevel = LogLevel[selectedLevel as keyof typeof LogLevel];
                logger.setLogLevel(logLevel);
                
                // 保存到設置
                const config = vscode.workspace.getConfiguration('stockmon');
                await config.update('logLevel', selectedLevel, vscode.ConfigurationTarget.Global);
                
                vscode.window.showInformationMessage(`Log level set to ${selectedLevel}`);
            }
        })
    );

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
}

export function deactivate() {
    LoggerService.getInstance().log(LogCategory.EXTENSION, 'Extension deactivated');
}