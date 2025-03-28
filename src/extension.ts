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
import { SessionInfo } from './types';
import { urls } from './config';
import { WebSocketState } from './types';
import { config } from './config';

export async function activate(context: vscode.ExtensionContext) {
    // 添加啟動日誌
    console.log('Activating stockmon extension...');
    console.log('Extension ID:', context.extension.id);
    console.log('URI Scheme:', vscode.env.uriScheme);
    
    // Initialize the context manager first
    ExtensionContextManager.initialize(context);

    // Initialize and register the logger service
    const logger = LoggerService.getInstance();
    logger.register(context);
    
    // 記錄啟動信息
    logger.info(LogCategory.EXTENSION, `Activating stockmon extension with ID: ${context.extension.id}`);
    logger.info(LogCategory.EXTENSION, `URI Scheme: ${vscode.env.uriScheme}`);
    logger.info(LogCategory.EXTENSION, `Activation events: ${context.extension.packageJSON.activationEvents.join(', ')}`);
    
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

    // 定義 URI 處理器類
    class StockmonUriHandler implements vscode.UriHandler {
        constructor(private readonly logger: LoggerService) {}

        async handleUri(uri: vscode.Uri): Promise<void> {
            console.log('URI handler triggered:', uri.toString());
            this.logger.info(LogCategory.EXTENSION, `URI handler triggered with: ${uri.toString()}`);
            this.logger.info(LogCategory.EXTENSION, `URI components - scheme: ${uri.scheme}, authority: ${uri.authority}, path: ${uri.path}, query: ${uri.query}`);
            // 處理 URI
            await processUri(uri);
        }
    }

    // 註冊 URI 處理器
    const stockmonUriHandler = new StockmonUriHandler(logger);
    context.subscriptions.push(vscode.window.registerUriHandler(stockmonUriHandler));

    // 處理 URI 的通用函數
    async function processUri(uri: vscode.Uri): Promise<void> {
        try {
            console.log('Processing URI:', uri.toString());
            logger.info(LogCategory.EXTENSION, `Processing URI: ${uri.toString()}`);
            logger.info(LogCategory.EXTENSION, `URI details - scheme: ${uri.scheme}, authority: ${uri.authority}, path: ${uri.path}, query: ${uri.query}`);
            
            
            // 檢查URI是否是我們期望的格式 - 放寬條件
            if (uri.scheme === vscode.env.uriScheme) {
                logger.info(LogCategory.EXTENSION, 'URI scheme is valid');
                
                // 解析查詢參數
                const queryString = uri.query;
                logger.info(LogCategory.EXTENSION, `Query string: ${queryString}`);
                
                if (!queryString) {
                    logger.warning(LogCategory.EXTENSION, 'URI has no query string');
                    vscode.window.showWarningMessage('URI 缺少查詢參數');
                    return;
                }
                
                const queryParams = new URLSearchParams(queryString);
                const token = queryParams.get('token');
                const userInfoStr = queryParams.get('user');
                
                logger.info(LogCategory.EXTENSION, `Parsed params - token exists: ${!!token}, userInfo exists: ${!!userInfoStr}`);
                
                if (token) {
                    logger.info(LogCategory.EXTENSION, 'Token found in URI, processing auth callback');
                    
                    // 處理token
                    await handleAuthCallback(token, userInfoStr);
                } else {
                    logger.warning(LogCategory.EXTENSION, 'Auth callback URI has no token');
                    vscode.window.showWarningMessage('登入回調缺少必要的 token');
                }
            } else {
                logger.warning(LogCategory.EXTENSION, `Invalid URI scheme: ${uri.scheme}, expected: ${vscode.env.uriScheme}`);
                vscode.window.showWarningMessage(`無效的 URI 格式: ${uri.toString()}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.logError(LogCategory.EXTENSION, error, 'Error processing URI');
            vscode.window.showErrorMessage(`處理 URI 時發生錯誤: ${errorMessage}`);
        }
    }

    // 處理認證回調的函數
    async function handleAuthCallback(token: string, userInfoStr: string | null) {
        try {
            logger.log(LogCategory.AUTH, 'Handling auth callback');
            
            // 解析用戶信息
            let userInfo = null;
            if (userInfoStr) {
                try {
                    userInfo = JSON.parse(userInfoStr);
                } catch (e) {
                    logger.logError(LogCategory.AUTH, e, 'Failed to parse user info');
                }
            }
            
            // 設置認證狀態
            await useSessionStore.getState().setAuthToken(token, context);
            
            // 更新會話信息，設置認證狀態為true
            const clientUuid = useSessionStore.getState().clientUuid || useSessionStore.getState().getOrCreateUuid(context);
            const sessionInfo = {
                uuid: clientUuid,
                is_authenticated: true,
                channel_type: 'stock',
                user: userInfo?.username || 'user'
            };
            await useSessionStore.getState().setSessionInfo(sessionInfo, context);
            
            // 檢查認證狀態
            logger.log(LogCategory.AUTH, `Authentication status after callback: ${useSessionStore.getState().isAuthenticated}`);
            
            // 更新狀態欄
            updateStatusBar();
            
            // 顯示成功訊息
            vscode.window.showInformationMessage('登入成功！');
            
            // 開始自動同步
            useStockDataStore.getState().startAutoSync();
            
            // 上傳本地股票資料到雲端
            try {
                await useStockDataStore.getState().uploadLocalStocksToServer();
            } catch (error) {
                logger.logError(LogCategory.SYNC, error, '上傳本地股票資料失敗');
                // 不中斷登入流程，僅記錄錯誤
            }
            
            // 顯示當前狀態
            useSessionStore.getState().showSessionInfoAndAuthToken(logger);
            
            // 重新連接WebSocket，使用新的認證狀態
            logger.log(LogCategory.WEBSOCKET, 'Reconnecting WebSocket with new authentication state');
            const wsStore = useWebSocketStore.getState();
            if (wsStore.wsState !== WebSocketState.CONNECTING) {
                wsStore.disconnect();
                setTimeout(() => {
                    wsStore.connect(logger);
                }, 500);
            }
            
        } catch (error) {
            logger.logError(LogCategory.AUTH, error, 'Failed to handle auth callback');
            vscode.window.showErrorMessage('登入處理失敗，請重試');
        }
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
        } else if (!sessionState.isAuthenticated && !hasPositions) {
            // 未登入且沒有持股時，顯示為 StockMon
            statusBarItem.text = `StockMon`;
        } else {
            statusBarItem.text = `${connectionIcon} ${loginIcon}`.trim();
        }
        statusBarItem.tooltip = `${connectionTooltip} | ${loginTooltip}`;
        statusBarItem.color = profitColor;
        
        // 設置點擊命令 - 始終打開面板
        statusBarItem.command = 'stockmon.showPanel';
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
            // 詢問用戶是否使用外部登入頁面
            const loginMethod = await vscode.window.showQuickPick(
                [
                    { label: '$(globe) 使用網頁登入', description: '在瀏覽器中打開登入頁面', id: 'web' },
                    { label: '$(person) 直接輸入帳號密碼', description: '在VSCode中輸入帳號密碼', id: 'direct' }
                ],
                { placeHolder: '選擇登入方式' }
            );

            if (!loginMethod) {
                return;
            }

            if (loginMethod.id === 'web') {
                // 使用外部登入頁面
                await useExternalLogin();
            } else {
                // 使用直接輸入帳號密碼的方式
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
            }
        } catch (error) {
            logger.logError(LogCategory.EXTENSION, error, 'Login command error');
        }
    });

    // 添加外部登入功能
    async function useExternalLogin() {
        try {
            // 生成一個隨機的extension_id
            const extensionId = `vscode-stockmon-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
            
            // 獲取正確的 URI 方案和擴展 ID
            const uriScheme = vscode.env.uriScheme; // 通常是 'vscode'
            const appExtensionId = context.extension.id; // 使用完整的擴展 ID
            
            // 設置回調URL
            // 使用vscode協議，這將由我們的URI處理器處理
            const callbackUri = vscode.Uri.parse(`${uriScheme}://${appExtensionId}/auth/callback`);
            
            // 將 URI 轉換為外部 URI
            const externalCallbackUri = await vscode.env.asExternalUri(callbackUri);
            const callbackUrl = externalCallbackUri.toString();
            
            // 構建登入URL，確保正確編碼所有參數
            const loginUrlParams = new URLSearchParams();
            loginUrlParams.append('from_extension', 'true');
            loginUrlParams.append('extension_id', extensionId);
            loginUrlParams.append('callback_url', callbackUrl);
            
            // 使用正確的 URL 路徑
            const loginUrl = `${urls.auth.extensionLogin}?${loginUrlParams.toString()}`;
            
            logger.info(LogCategory.EXTENSION, `Opening external login URL: ${loginUrl}`);
            logger.info(LogCategory.EXTENSION, `Callback URL: ${callbackUrl}`);
            logger.info(LogCategory.EXTENSION, `Extension ID: ${extensionId}`);
            logger.info(LogCategory.EXTENSION, `URI Scheme: ${uriScheme}, App Extension ID: ${appExtensionId}`);
            logger.info(LogCategory.EXTENSION, `External Callback URI: ${externalCallbackUri.toString()}`);
            
            // 打開外部瀏覽器
            await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
            
            // 啟動輪詢，作為備用方案
            startPollingForLogin(extensionId);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.logError(LogCategory.EXTENSION, error, 'External login error');
            vscode.window.showErrorMessage(`外部登入失敗: ${errorMessage}`);
        }
    }

    // 輪詢登入狀態的函數
    async function startPollingForLogin(extensionId: string) {
        logger.info(LogCategory.EXTENSION, `Starting polling for login with extension ID: ${extensionId}`);
        
        // 檢查是否已經登入
        if (useSessionStore.getState().isAuthenticated) {
            logger.info(LogCategory.EXTENSION, 'User is already authenticated, skipping polling');
            return;
        }
        
        // 顯示進度條
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '等待登入完成...',
            cancellable: true
        }, async (progress, token) => {
            // 設置超時時間
            const timeout = 5 * 60 * 1000; // 5分鐘
            const startTime = Date.now();
            
            // 輪詢間隔
            const pollInterval = 2000; // 2秒
            
            return new Promise<void>((resolve, reject) => {
                // 設置輪詢定時器
                const interval = setInterval(async () => {
                    // 檢查是否已經登入
                    if (useSessionStore.getState().isAuthenticated) {
                        clearInterval(interval);
                        logger.info(LogCategory.EXTENSION, 'User is already authenticated via another method, stopping polling');
                        resolve();
                        return;
                    }
                    
                    // 檢查是否取消
                    if (token.isCancellationRequested) {
                        clearInterval(interval);
                        logger.info(LogCategory.EXTENSION, 'Login polling cancelled by user');
                        reject(new Error('登入已取消'));
                        return;
                    }
                    
                    // 檢查是否超時
                    if (Date.now() - startTime > timeout) {
                        clearInterval(interval);
                        logger.warning(LogCategory.EXTENSION, 'Login polling timed out');
                        reject(new Error('登入超時'));
                        return;
                    }
                    
                    try {
                        // 檢查登入狀態
                        logger.debug(LogCategory.EXTENSION, `Polling login status for extension ID: ${extensionId}`);
                        
                        // 發送請求到後端檢查登入狀態
                        const response = await axios.get(urls.auth.checkCallback(extensionId));
                        
                        // 檢查是否收到回調
                        if (response.data && response.data.received) {
                            clearInterval(interval);
                            logger.info(LogCategory.EXTENSION, 'Login callback received via polling');
                            
                            // 獲取token和用戶信息
                            const token = response.data.token;
                            const userInfo = response.data.user_info;
                            
                            if (token) {
                                // 處理token
                                await handleAuthCallback(token, userInfo ? JSON.stringify(userInfo) : null);
                                resolve();
                            } else {
                                logger.warning(LogCategory.EXTENSION, 'Login callback received but no token found');
                                reject(new Error('登入回調缺少必要的token'));
                            }
                            return;
                        }
                    } catch (error) {
                        // 忽略輪詢錯誤，繼續輪詢
                        logger.debug(LogCategory.EXTENSION, `Login polling error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                    
                    // 更新進度
                    progress.report({ message: '等待登入完成...' });
                }, pollInterval);
                
                // 添加清理函數，確保在 Promise 被解決或拒絕後清除定時器
                return () => {
                    clearInterval(interval);
                };
            }).catch(error => {
                logger.warning(LogCategory.EXTENSION, `Login polling failed: ${error.message}`);
                vscode.window.showWarningMessage(`登入等待失敗: ${error.message}`);
            });
        });
    }

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


    // 註冊命令：處理 URI 回調
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.authCallback', (uri: vscode.Uri) => {
            logger.info(LogCategory.EXTENSION, `Auth callback command triggered with URI: ${uri?.toString() || 'undefined'}`);
            
            if (uri) {
                // 使用通用函數處理 URI
                processUri(uri);
            } else {
                logger.warning(LogCategory.EXTENSION, 'Auth callback command triggered without URI');
                vscode.window.showWarningMessage('登入回調缺少必要的URI');
            }
        })
    );

    // 註冊命令：直接處理您提供的 URI
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.handleProvidedUri', async () => {
            try {
                // 獲取正確的 URI 方案和擴展 ID
                const uriScheme = vscode.env.uriScheme; // 通常是 'vscode'
                const extensionId = context.extension.id; // 使用完整的擴展 ID
                
                // 使用您提供的 URI，但確保使用正確的 URI 方案和擴展 ID
                const providedUri = vscode.Uri.parse(`${uriScheme}://${extensionId}/auth/callback?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjozLCJ1c2VybmFtZSI6ImRhbmllbCIsImVtYWlsIjoic3NzdXBlcm1hbkBnbWFpbC5jb20iLCJleHRlbnNpb25faWQiOiJ2c2NvZGUtc3RvY2ttb24tMTc0MTk2MzUzOTY4NC1od3RtYzN5cmZkbCIsImV4cCI6MTc0MjA0OTk0MCwiaWF0IjoxNzQxOTYzNTQwfQ.BWXpFPJzrERBE2xqJhFvBh9l5smGaXzUa1ALXDH-t7U&user=%7B%22id%22%3A3%2C%22username%22%3A%22daniel%22%2C%22email%22%3A%22sssuperman%40gmail.com%22%2C%22first_name%22%3A%22Daniel%22%2C%22last_name%22%3A%22Chang%22%2C%22is_staff%22%3Afalse%2C%22is_active%22%3Atrue%2C%22date_joined%22%3A%222025-03-07T09%3A19%3A17.530683%2B00%3A00%22%7D`);
                
                // 將 URI 轉換為外部 URI
                const externalProvidedUri = await vscode.env.asExternalUri(providedUri);
                
                logger.info(LogCategory.EXTENSION, `Handling provided URI: ${providedUri.toString()}`);
                logger.info(LogCategory.EXTENSION, `URI components - scheme: ${providedUri.scheme}, authority: ${providedUri.authority}, path: ${providedUri.path}`);
                logger.info(LogCategory.EXTENSION, `External URI: ${externalProvidedUri.toString()}`);
                
                // 直接處理 URI
                await processUri(providedUri);
                
                // 嘗試直接解析 token 和 user
                const queryParams = new URLSearchParams(providedUri.query);
                const token = queryParams.get('token');
                const userInfoStr = queryParams.get('user');
                
                if (token && userInfoStr) {
                    logger.info(LogCategory.EXTENSION, 'Directly calling handleAuthCallback with token and user info');
                    await handleAuthCallback(token, userInfoStr);
                }
                
                // 也嘗試使用 openExternal 打開 URI
                logger.info(LogCategory.EXTENSION, 'Also trying to open URI externally');
                await vscode.env.openExternal(externalProvidedUri);
                
                vscode.window.showInformationMessage('已處理提供的 URI，請檢查日誌');
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.logError(LogCategory.EXTENSION, error, 'Handle provided URI error');
                vscode.window.showErrorMessage(`處理提供的 URI 失敗: ${errorMessage}`);
            }
        })
    );

    // 註冊命令：直接處理 URI
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.handleUri', async (uriString: string) => {
            try {
                logger.info(LogCategory.EXTENSION, `Handle URI command triggered with: ${uriString}`);
                
                if (!uriString) {
                    logger.warning(LogCategory.EXTENSION, 'Handle URI command triggered without URI string');
                    return;
                }
                
                // 解析 URI 字符串
                const uri = vscode.Uri.parse(uriString);
                
                // 將 URI 轉換為外部 URI
                const externalUri = await vscode.env.asExternalUri(uri);
                
                logger.info(LogCategory.EXTENSION, `URI components - scheme: ${uri.scheme}, authority: ${uri.authority}, path: ${uri.path}`);
                logger.info(LogCategory.EXTENSION, `External URI: ${externalUri.toString()}`);
                
                // 處理 URI
                await processUri(uri);
                
                // 也嘗試使用 openExternal 打開 URI
                logger.info(LogCategory.EXTENSION, 'Also trying to open URI externally');
                await vscode.env.openExternal(externalUri);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.logError(LogCategory.EXTENSION, error, 'Handle URI command error');
            }
        })
    );

    // 註冊命令：顯示擴展 ID 和 URI 方案
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.showExtensionInfo', () => {
            const extensionId = context.extension.id;
            const uriScheme = vscode.env.uriScheme;
            const appExtensionId = extensionId.split('.').pop() || 'stockmon';
            
            logger.info(LogCategory.EXTENSION, `Extension ID: ${extensionId}`);
            logger.info(LogCategory.EXTENSION, `URI Scheme: ${uriScheme}`);
            logger.info(LogCategory.EXTENSION, `App Extension ID: ${appExtensionId}`);
            
            vscode.window.showInformationMessage(`擴展 ID: ${extensionId}\nURI 方案: ${uriScheme}\n應用擴展 ID: ${appExtensionId}`);
        })
    );
    // 註冊命令：檢查 sessionStore 的狀態
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.checkSessionStore', () => {
            try {
                const sessionState = useSessionStore.getState();
                logger.info(LogCategory.EXTENSION, '=== Session Store State ===');
                logger.info(LogCategory.EXTENSION, `Auth Token: ${sessionState.authToken ? 'present' : 'null'}`);
                logger.info(LogCategory.EXTENSION, `Is Authenticated: ${sessionState.isAuthenticated}`);
                logger.info(LogCategory.EXTENSION, `Session Info: ${JSON.stringify(sessionState.sessionInfo, null, 2)}`);
                logger.info(LogCategory.EXTENSION, `Client UUID: ${sessionState.clientUuid}`);
                
                // 檢查 global state
                const savedToken = context.globalState.get<string>('authToken');
                const savedSession = context.globalState.get<SessionInfo>('sessionInfo');
                logger.info(LogCategory.EXTENSION, '=== Global State ===');
                logger.info(LogCategory.EXTENSION, `Saved Token: ${savedToken ? 'present' : 'null'}`);
                logger.info(LogCategory.EXTENSION, `Saved Session: ${JSON.stringify(savedSession, null, 2)}`);
                
                // 檢查 token 是否過期
                if (savedToken) {
                    try {
                        const expired = isTokenExpired(savedToken);
                        logger.info(LogCategory.EXTENSION, `Token Expired: ${expired}`);
                    } catch (error) {
                        logger.warning(LogCategory.EXTENSION, `Failed to check token expiration: ${error}`);
                    }
                }
                
                // 顯示通知
                vscode.window.showInformationMessage(`Session 狀態: ${sessionState.isAuthenticated ? '已登入' : '未登入'}`);
                
                // 顯示日誌
                logger.show();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.logError(LogCategory.EXTENSION, error, 'Failed to check session store');
                vscode.window.showErrorMessage(`檢查 session store 失敗: ${errorMessage}`);
            }
        })
    );

    // 註冊命令：測試 API 請求
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.testApiRequest', async () => {
            try {
                const sessionState = useSessionStore.getState();
                logger.info(LogCategory.EXTENSION, '=== Testing API Request ===');
                
                if (!sessionState.authToken || !sessionState.isAuthenticated) {
                    logger.warning(LogCategory.EXTENSION, 'No auth token or not authenticated, cannot test API request');
                    vscode.window.showWarningMessage('未登入，無法測試 API 請求');
                    return;
                }
                
                logger.info(LogCategory.EXTENSION, `Using auth token: ${sessionState.authToken ? 'present' : 'null'}`);
                logger.info(LogCategory.EXTENSION, `Client UUID: ${sessionState.clientUuid}`);
                
                // 構建請求頭
                const headers = {
                    'Authorization': `Bearer ${sessionState.authToken}`,
                    'Content-Type': 'application/json',
                    'X-Client-UUID': sessionState.clientUuid
                };
                
                logger.info(LogCategory.EXTENSION, `Request headers: ${JSON.stringify(headers)}`);
                logger.info(LogCategory.EXTENSION, `Request URL: ${urls.stocks.list}`);
                
                // 發送請求
                const response = await axios.get(urls.stocks.list, { headers });
                
                logger.info(LogCategory.EXTENSION, `Response status: ${response.status}`);
                logger.info(LogCategory.EXTENSION, `Response data: ${JSON.stringify(response.data)}`);
                
                // 顯示通知
                vscode.window.showInformationMessage(`API 請求成功，收到 ${response.data.length} 筆資料`);
                
                // 顯示日誌
                logger.show();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.logError(LogCategory.EXTENSION, error, 'API request failed');
                vscode.window.showErrorMessage(`API 請求失敗: ${errorMessage}`);
                logger.show();
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

    // 註冊引導添加第一個股票的命令
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.createFirstStock', async () => {
            logger.info(LogCategory.EXTENSION, 'Create first stock command triggered');
            
            // 顯示面板
            const panel = StockPanel.createOrShow(context.extensionUri);
            
            // 等待面板初始化完成
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 告訴面板顯示空狀態提示並高亮添加按鈕
            if (StockPanel.currentPanel) {
                // 使用公共方法發送消息
                StockPanel.currentPanel.postMessageToWebview({
                    type: 'showEmptyState',
                    highlightAddButton: true
                });
            }
        })
    );

    // 添加到待清理列表
    context.subscriptions.push({ dispose: () => unsubscribeStockStoreForNotification() });

    // // 註冊命令：處理用戶反饋
    // context.subscriptions.push(
    //     vscode.commands.registerCommand('stockmon.submitFeedback', async (feedbackData: any) => {
    //         try {
    //             logger.info(LogCategory.EXTENSION, 'Processing feedback submission...');
                
    //             const sessionState = useSessionStore.getState();
    //             const headers = {
    //                 'Authorization': `Bearer ${sessionState.authToken}`,
    //                 'Content-Type': 'application/json',
    //                 'X-Client-UUID': sessionState.clientUuid
    //             };
                
    //             // 添加系統信息到 metadata
    //             const metadata = {
    //                 ...feedbackData.metadata,
    //                 vscodeVersion: vscode.version,
    //                 extensionVersion: context.extension.packageJSON.version,
    //                 platform: process.platform,
    //                 arch: process.arch,
    //                 uriScheme: vscode.env.uriScheme,
    //                 appHost: vscode.env.appHost,
    //                 sessionId: sessionState.clientUuid,
    //                 wsState: useWebSocketStore.getState().wsState
    //             };
                
    //             // 發送反饋到後端
    //             const response = await axios.post(urls.feedback.submit, {
    //                 ...feedbackData,
    //                 metadata
    //             }, { headers });
                
    //             if (response.data.status === 'success') {
    //                 // 如果面板存在，發送成功消息給面板
    //                 if (StockPanel.currentPanel) {
    //                     StockPanel.currentPanel.postMessageToWebview({
    //                         type: 'feedbackResponse',
    //                         data: {
    //                             status: 'success',
    //                             message: '感謝您的反饋！'
    //                         }
    //                     });
    //                 }
                    
    //                 vscode.window.showInformationMessage('感謝您的反饋！');
    //                 logger.info(LogCategory.EXTENSION, 'Feedback submitted successfully');
    //             } else {
    //                 throw new Error(response.data.message || '提交反饋失敗');
    //             }
    //         } catch (error) {
    //             const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    //             logger.logError(LogCategory.EXTENSION, error, 'Error submitting feedback');
                
    //             // 如果面板存在，發送錯誤消息給面板
    //             if (StockPanel.currentPanel) {
    //                 StockPanel.currentPanel.postMessageToWebview({
    //                     type: 'feedbackResponse',
    //                     data: {
    //                         status: 'error',
    //                         message: `提交反饋失敗: ${errorMessage}`
    //                     }
    //                 });
    //             }
                
    //             vscode.window.showErrorMessage(`提交反饋失敗: ${errorMessage}`);
    //         }
    //     })
    // );

    // 註冊命令：獲取反饋類型
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.getFeedbackTypes', async () => {
            try {
                logger.info(LogCategory.EXTENSION, 'Fetching feedback types...');
                
                const sessionState = useSessionStore.getState();
                const headers = {
                    'Authorization': `Bearer ${sessionState.authToken}`,
                    'Content-Type': 'application/json',
                    'X-Client-UUID': sessionState.clientUuid
                };
                
                const response = await axios.get(urls.feedback.types, { headers });
                
                // 如果面板存在，發送類型列表給面板
                if (StockPanel.currentPanel) {
                    StockPanel.currentPanel.postMessageToWebview({
                        type: 'feedbackTypes',
                        data: response.data.types
                    });
                }
                
                return response.data.types;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : '未知錯誤';
                logger.logError(LogCategory.EXTENSION, error, 'Error fetching feedback types');
                vscode.window.showErrorMessage(`獲取反饋類型失敗: ${errorMessage}`);
                throw error;
            }
        })
    );

    // 註冊反饋提交命令
    let submitFeedbackCommand = vscode.commands.registerCommand('stockmon.submitFeedback', async (feedback: any) => {
        try {
            logger.info(LogCategory.FEEDBACK, `Submitting feedback: ${JSON.stringify(feedback)}`);
            
            // 獲取當前的 session token
            const sessionState = useSessionStore.getState();
            const token = sessionState.authToken;
            
            // 準備請求頭
            const headers: any = {
                'Content-Type': 'application/json'
            };
            
            // 如果已登入，添加認證 token
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            // 發送反饋到後端
            const response = await axios.post(urls.feedback.submit, feedback, { headers });
            
            logger.info(LogCategory.FEEDBACK, `Feedback submitted successfully: ${JSON.stringify(response.data)}`);
            
            // 通知 webview 提交成功
            if (StockPanel.currentPanel) {
                StockPanel.currentPanel.postMessageToWebview({
                    type: 'feedbackResponse',
                    data: {
                        status: 'success',
                        message: '反饋已成功提交'
                    }
                });
            }
            
        } catch (error) {
            logger.logError(LogCategory.FEEDBACK, error, '提交反饋時發生錯誤');
            
            // 通知 webview 提交失敗
            if (StockPanel.currentPanel) {
                StockPanel.currentPanel.postMessageToWebview({
                    type: 'feedbackResponse',
                    data: {
                        status: 'error',
                        message: '提交反饋時發生錯誤'
                    }
                });
            }
        }
    });
    
    context.subscriptions.push(submitFeedbackCommand);

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
    setTimeout(checkEmptyPortfolio, 2000); // 給予 2 秒鐘的時間讓擴展完全初始化

    // 註冊命令：顯示並展開左側的 Portfolio 視圖
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.showPortfolioView', async () => {
            try {
                logger.info(LogCategory.PORTFOLIO, 'Showing portfolio view...');
                
                // 刷新 portfolio 視圖
                portfolioViewProvider.refresh();
                
                // 確保視圖可見並展開
                await vscode.commands.executeCommand('stockmonPortfolio.focus');
                
                // 如果 StockPanel 存在，發送確認消息
                if (StockPanel.currentPanel) {
                    StockPanel.currentPanel.postMessageToWebview({
                        type: 'portfolioViewShown',
                        success: true
                    });
                }
            } catch (error) {
                logger.logError(LogCategory.PORTFOLIO, error, 'Error showing portfolio view');
                vscode.window.showErrorMessage(`Error showing portfolio view: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    // 在 StockPanel 中註冊消息處理 - 添加在其他 messageHandlers 設置下方
    StockPanel.messageHandlers.set('showPortfolioView', async () => {
        try {
            // 執行顯示 Portfolio 視圖的命令
            await vscode.commands.executeCommand('stockmon.showPortfolioView');
        } catch (error) {
            logger.logError(LogCategory.PORTFOLIO, error, '處理顯示 Portfolio 視圖請求時發生錯誤');
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
            stockDataStore.stopAutoSync();
            logger.log(LogCategory.SYNC, 'Auto sync stopped on extension deactivation');
        }
    } catch (error) {
        logger.logError(LogCategory.EXTENSION, error, 'Error during extension deactivation');
    }
}