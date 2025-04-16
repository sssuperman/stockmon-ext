import * as vscode from 'vscode';
import { useWebSocketStore } from './store/websocketStore';
import { useStockDataStore } from './store/stockDataStore';
import { useIndiceDataStore } from './store/indiceDataStore';
import { useAlertStore } from './store/alertStore';
import { getNonce } from './utilities/getNonce';
import { getUri } from './utilities/getUri';
import { channel } from 'diagnostics_channel';
import { StockInventory } from './types';
import { LoggerService, LogCategory } from './utilities/loggerService';
import { useSessionStore } from './store/sessionStore';
import { removeStock } from './store/stockDataActionUserStock';
import { getMultipleStock5mCandles } from './store/stockDataStoreActionCandles';
export class StockPanel {
    private static logger = LoggerService.getInstance();
    public static currentPanel: StockPanel | undefined;
    public static messageHandlers: Map<string, (message: any) => Promise<void>> = new Map();
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _unsubscribeStockStore?: () => void;
    private _unsubscribeIndiceStore?: () => void;
    private _unsubscribeAlertStore?: () => void;

    /**
     * 創建或顯示 StockPanel
     * @param extensionUri 擴展 URI
     */
    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // 如果已經有面板，則顯示它
        if (StockPanel.currentPanel) {
            StockPanel.currentPanel._panel.reveal(column);
            return StockPanel.currentPanel;
        }

        // 否則，創建一個新的面板
        const panel = vscode.window.createWebviewPanel(
            'stockmon',
            'Stock Monitor',
            column || vscode.ViewColumn.One,
            {
                // Enable javascript in the webview
                enableScripts: true,
                // Restrict the webview to only load resources from the `out` directory
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'out'),
                    vscode.Uri.joinPath(extensionUri, 'webview-ui/build')
                ],
                retainContextWhenHidden: true
            }
        );

        StockPanel.currentPanel = new StockPanel(panel, extensionUri);
        return StockPanel.currentPanel;
    }

    /**
     * 顯示股票詳情
     * @param symbol 股票代號
     */
    public showStockDetail(symbol: string) {
        StockPanel.logger.log(LogCategory.PANEL, `Sending showStockDetail message for ${symbol}`);
        this._panel.webview.postMessage({
            type: 'showStockDetail',
            symbol: symbol
        });
    }

    /**
     * 向面板的 Webview 發送消息
     * @param message 要發送的消息
     */
    public postMessageToWebview(message: any) {
        StockPanel.logger.log(LogCategory.PANEL, `Sending message to webview: ${JSON.stringify(message)}`);
        this._panel.webview.postMessage(message);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        
        // Set the webview's initial html content
        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);

        StockPanel.logger.log(LogCategory.PANEL, `Panel constructor - current stocks count: ${useStockDataStore.getState().stocks.length}`);
        
        // 添加更詳細的日誌
        const stocksData = useStockDataStore.getState().stocks;
        StockPanel.logger.log(LogCategory.PANEL, `Raw stocks data types: ${stocksData.map(s => 
            `${s.symbol}:(price=${typeof s.price}, change=${typeof s.change})`).join(', ')}`);
        
        // 設置初始狀態 - 使用更徹底的數據清理
        const initialStocks = this._deepSanitizeData(useStockDataStore.getState().stocks);
        const initialTwseIndex = useStockDataStore.getState().twseIndex ? 
            this._deepSanitizeData([useStockDataStore.getState().twseIndex])[0] : null;
        
        // 獲取指數數據
        const initialIndices = useIndiceDataStore.getState().indices;
        
        // 獲取提醒數據
        const initialAlerts = useAlertStore.getState().alerts || [];
        
        StockPanel.logger.log(LogCategory.PANEL, `Sending initial data to webview - stocks: ${initialStocks.length}, has index: ${!!initialTwseIndex}, indices: ${Object.keys(initialIndices).length}, alerts: ${initialAlerts.length}`);
        
        // Get session info
        const sessionInfo = useSessionStore.getState().sessionInfo;
        StockPanel.logger.log(LogCategory.PANEL, `Sending session info to webview: ${JSON.stringify(sessionInfo)}`);
        
        this._panel.webview.postMessage({
            type: 'init',
            stocks: initialStocks,
            twseIndex: initialTwseIndex,
            sessionInfo: sessionInfo,
            indices: initialIndices,
            alerts: initialAlerts
        });

        // 訂閱 store 更新 - 確保數據格式正確
        this._unsubscribeStockStore = useStockDataStore.subscribe(
            (state) => {
                if (this._panel.visible) {
                    const sanitizedStocks = this._deepSanitizeData(state.stocks);
                    const sanitizedIndex = state.twseIndex ? 
                        this._deepSanitizeData([state.twseIndex])[0] : null;
                    
                    StockPanel.logger.debug(LogCategory.PANEL, `Store updated - sending to panel - stocks: ${sanitizedStocks.length}, has index: ${!!sanitizedIndex}`);
                    this._panel.webview.postMessage({
                        type: 'update',
                        stocks: sanitizedStocks,
                        twseIndex: sanitizedIndex,
                        sessionInfo: useSessionStore.getState().sessionInfo
                    });
                }
            }
        );

        // 訂閱指數數據更新
        this._unsubscribeIndiceStore = useIndiceDataStore.subscribe(
            (state) => {
                if (this._panel.visible) {
                    StockPanel.logger.debug(LogCategory.PANEL, `Indices updated - sending to panel - indices: ${Object.keys(state.indices).length}`);
                    this._panel.webview.postMessage({
                        type: 'updateIndices',
                        indices: state.indices
                    });
                }
            }
        );

        // Subscribe to session store updates
        const unsubscribeSessionStore = useSessionStore.subscribe(
            (state) => {
                if (this._panel.visible) {
                    StockPanel.logger.debug(LogCategory.PANEL, `Session updated - sending to panel: ${JSON.stringify(state.sessionInfo)}`);
                    this._panel.webview.postMessage({
                        type: 'updateSessionInfo',
                        sessionInfo: state.sessionInfo
                    });
                }
            }
        );

        // 訂閱 alert store 更新
        this._unsubscribeAlertStore = useAlertStore.subscribe(
            (state) => {
                if (this._panel.visible) {
                    StockPanel.logger.debug(LogCategory.PANEL, `Alerts updated - sending to panel - alerts: ${state.alerts.length}`);
                    this._panel.webview.postMessage({
                        type: 'updateAlerts',
                        alerts: state.alerts
                    });
                }
            }
        );

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                StockPanel.logger.log(LogCategory.PANEL, `Panel Received message from webview - command: ${message.command}`);
                
                // 檢查是否有註冊的消息處理器
                const handler = StockPanel.messageHandlers.get(message.command);
                if (handler) {
                    try {
                        await handler(message);
                        return;
                    } catch (error) {
                        StockPanel.logger.logError(LogCategory.PANEL, error, `Error handling message: ${message.command}`);
                    }
                }
                
                switch (message.command) {
                    case 'getStocks':
                        // Send initial data to webview
                        const stockState = useStockDataStore.getState();
                        const sanitizedStocks = this._deepSanitizeData(stockState.stocks);
                        StockPanel.logger.log(LogCategory.PANEL, `Responding to getStocks - sending ${sanitizedStocks.length} stocks`);
                        this._panel.webview.postMessage({
                            type: 'updateStocks',
                            stocks: sanitizedStocks
                        });
                        if (stockState.twseIndex) {
                            const sanitizedIndex = this._deepSanitizeData([stockState.twseIndex])[0];
                            this._panel.webview.postMessage({
                                type: 'updateTwseIndex',
                                index: sanitizedIndex
                            });
                        }
                        this._panel.webview.postMessage({
                            type: 'updateWebSocketState',
                            state: useWebSocketStore.getState().wsState
                        });
                        // Send session info
                        const sessionState = useSessionStore.getState();
                        this._panel.webview.postMessage({
                            type: 'updateSessionInfo',
                            sessionInfo: sessionState.sessionInfo
                        });
                        break;
                    case 'addAlert':
                        // 處理添加提醒命令，顯示提醒設置視窗
                        vscode.commands.executeCommand('stockmon.addAlert');
                        break;
                    case 'confirmDeleteAlert':
                        // 確認刪除提醒操作
                        const resultDeleteAlert = await vscode.window.showWarningMessage(
                            `確定要刪除提醒嗎？`,
                            { modal: true },
                            '確定',
                            '取消'
                        );
                        
                        if (resultDeleteAlert === '確定') {
                            try {
                                // 執行刪除提醒操作
                                const sessionStore = useSessionStore.getState();
                                
                                // 檢查是否已登入並有授權令牌
                                if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
                                    vscode.window.showErrorMessage('請先登入以刪除提醒');
                                    return;
                                }
                                
                                StockPanel.logger.log(LogCategory.PANEL, `正在刪除提醒 ID: ${message.alertId}`);
                                
                                // 確保使用 alertStore 方法，它會自動添加正確的驗證頭
                                const deleteResult = await useAlertStore.getState().deleteAlert(message.alertId);
                                
                                if (deleteResult) {
                                    vscode.window.showInformationMessage('提醒已成功刪除');
                                    // 更新UI
                                    this._panel.webview.postMessage({
                                        type: 'updateAlerts',
                                        alerts: useAlertStore.getState().alerts
                                    });
                                } else {
                                    throw new Error('刪除提醒失敗');
                                }
                            } catch (error) {
                                StockPanel.logger.logError(LogCategory.PANEL, error, `刪除提醒失敗`);
                                vscode.window.showErrorMessage(
                                    `刪除提醒失敗: ${error instanceof Error ? error.message : '未知錯誤'}`
                                );
                            }
                        }
                        break;
                    case 'editAlert':
                        // 處理編輯提醒
                        try {
                            const alertId = message.alertId;
                            if (!alertId) {
                                vscode.window.showErrorMessage('提醒ID無效');
                                break;
                            }
                            
                            const sessionStore = useSessionStore.getState();
                            // 檢查是否已登入並有授權令牌
                            if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
                                vscode.window.showErrorMessage('請先登入以編輯提醒');
                                return;
                            }

                            StockPanel.logger.log(LogCategory.PANEL, `正在獲取提醒詳情 ID: ${alertId}`);
                            
                            // 嘗試從本地 store 獲取提醒，如果找不到再通過 API 獲取
                            let alertToEdit = useAlertStore.getState().alerts.find(alert => alert.id === alertId);
                            
                            if (alertToEdit) {
                                StockPanel.logger.log(LogCategory.PANEL, `在本地找到提醒 ID: ${alertId}`);
                                vscode.commands.executeCommand('stockmon.editAlert', alertToEdit);
                                return;
                            }
                            
                            StockPanel.logger.log(LogCategory.PANEL, `本地未找到提醒，將通過 API 獲取 ID: ${alertId}`);
                            
                            // 通過 API 獲取最新提醒詳情
                            const alertDetail = await useAlertStore.getState().fetchAlertById(alertId);
                            
                            if (!alertDetail) {
                                throw new Error(`無法找到ID為 ${alertId} 的提醒`);
                            }

                            // 執行編輯提醒命令，傳遞提醒數據
                            vscode.commands.executeCommand('stockmon.editAlert', alertDetail);
                        } catch (error) {
                            StockPanel.logger.logError(LogCategory.PANEL, error, `編輯提醒失敗`);
                            vscode.window.showErrorMessage(
                                `編輯提醒失敗: ${error instanceof Error ? error.message : '未知錯誤'}`
                            );
                        }
                        break;
                    case 'resetAlert':
                        // 處理重置提醒
                        try {
                            const resetAlertId = message.alertId;
                            const sessionStore = useSessionStore.getState();
                            
                            // 檢查是否已登入並有授權令牌
                            if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
                                vscode.window.showErrorMessage('請先登入以重置提醒');
                                return;
                            }
                            
                            StockPanel.logger.log(LogCategory.PANEL, `正在重置提醒 ID: ${resetAlertId}`);
                            
                            // 使用 alertStore 的 resetAlert 方法
                            const resetResult = await useAlertStore.getState().resetAlert(resetAlertId);
                            
                            if (resetResult) {
                                vscode.window.showInformationMessage('提醒已成功重置');
                                
                                // 更新UI
                                this._panel.webview.postMessage({
                                    type: 'updateAlerts',
                                    alerts: useAlertStore.getState().alerts
                                });
                            } else {
                                throw new Error('重置提醒失敗');
                            }
                        } catch (error) {
                            StockPanel.logger.logError(LogCategory.PANEL, error, `重置提醒失敗`);
                            vscode.window.showErrorMessage(
                                `重置提醒失敗: ${error instanceof Error ? error.message : '未知錯誤'}`
                            );
                        }
                        break;
                    case 'getMultipleStock5mCandles':
                        try {
                            StockPanel.logger.log(LogCategory.PANEL, `Received request for 5-min candles for ${message.symbols.length} stocks`);
                            const { symbols } = message;
                            
                            if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
                                this._panel.webview.postMessage({
                                    command: 'klineDataResponse',
                                    data: {},
                                    error: '無效的股票代號列表'
                                });
                                break;
                            }
                            
                            let symbolsToFetch = symbols;
                            if (symbols.length > 20) {
                                StockPanel.logger.warning(LogCategory.PANEL, `請求股票數量過多，最多同時請求 20 支股票，當前請求 ${symbols.length} 支`);
                                symbolsToFetch = symbols.slice(0, 20);
                            }
                            
                            const klineData = await getMultipleStock5mCandles(symbolsToFetch);
                            
                            this._panel.webview.postMessage({
                                command: 'klineDataResponse',
                                data: klineData
                            });
                            
                            StockPanel.logger.debug(LogCategory.PANEL, `已發送 ${Object.keys(klineData).length} 支股票的K線數據`);
                        } catch (error) {
                            StockPanel.logger.logError(LogCategory.PANEL, error, '獲取K線數據時發生錯誤');
                            this._panel.webview.postMessage({
                                command: 'klineDataResponse',
                                data: {},
                                error: error instanceof Error ? error.message : '獲取K線數據時發生未知錯誤'
                            });
                        }
                        break;
                    case 'getIndices':
                        // 發送指數數據
                        const indiceState = useIndiceDataStore.getState();
                        StockPanel.logger.log(LogCategory.PANEL, `Responding to getIndices - sending ${Object.keys(indiceState.indices).length} indices`);
                        this._panel.webview.postMessage({
                            type: 'updateIndices',
                            indices: indiceState.indices
                        });
                        break;
                    case 'addStock':
                        vscode.commands.executeCommand('stockmon.addStock', message.symbol);
                        this._panel.webview.postMessage({
                            type: 'updateStocks',
                            stocks: useStockDataStore.getState().stocks
                        });
                        break;
                    case 'deleteStock':
                        await removeStock(message.symbol);
                        this._panel.webview.postMessage({
                            type: 'updateStocks',
                            stocks: useStockDataStore.getState().stocks
                        });
                        break;
                    case 'confirmDelete':
                        const result = await vscode.window.showWarningMessage(
                            `確定要刪除 ${message.symbol} 嗎？`,
                            { modal: true },
                            '確定',
                            '取消'
                        );
                        
                        if (result === '確定') {
                            try {
                                await removeStock(message.symbol);
                                this._panel.webview.postMessage({
                                    type: 'updateStocks',
                                    stocks: useStockDataStore.getState().stocks
                                });
                            } catch (error) {
                                vscode.window.showErrorMessage(
                                    `Failed to delete stock: ${error instanceof Error ? error.message : 'Unknown error'}`
                                );
                            }
                        }
                        break;
                    case 'setCost':
                        vscode.commands.executeCommand('stockmon.setCost', message.symbol);
                        break;
                    case 'login':
                        vscode.commands.executeCommand('stockmon.login');
                        break;
                    case 'confirmLogout':
                        const logoutResult = await vscode.window.showWarningMessage(
                            'Are you sure you want to log out?',
                            { modal: true },
                            'Yes',
                            'No'
                        );
                        
                        if (logoutResult === 'Yes') {
                            vscode.commands.executeCommand('stockmon.logout');
                        }
                        break;
                    case 'getAlerts':
                        // 發送提醒數據
                        const alertState = useAlertStore.getState();
                        StockPanel.logger.log(LogCategory.PANEL, `Responding to getAlerts - sending ${alertState.alerts.length} alerts`);
                        this._panel.webview.postMessage({
                            type: 'updateAlerts',
                            alerts: alertState.alerts
                        });
                        break;
                    case 'fetchAlerts':
                        // 獲取最新提醒列表
                        useAlertStore.getState().fetchAlerts().then(() => {
                            const updatedAlerts = useAlertStore.getState().alerts;
                            StockPanel.logger.log(LogCategory.PANEL, `Fetched ${updatedAlerts.length} alerts from API`);
                            this._panel.webview.postMessage({
                                type: 'updateAlerts',
                                alerts: updatedAlerts
                            });
                        }).catch(error => {
                            StockPanel.logger.logError(LogCategory.PANEL, error, '獲取提醒列表失敗');
                        });
                        break;
                    case 'createAlert':
                        // 創建新提醒
                        useAlertStore.getState().createAlert(message.alertData).then(newAlert => {
                            if (newAlert) {
                                StockPanel.logger.log(LogCategory.PANEL, `創建提醒成功: ${newAlert.id}`);
                                this._panel.webview.postMessage({
                                    type: 'alertCreated',
                                    alert: newAlert,
                                    success: true
                                });
                            } else {
                                this._panel.webview.postMessage({
                                    type: 'alertCreated',
                                    success: false,
                                    error: '創建提醒失敗'
                                });
                            }
                        }).catch(error => {
                            StockPanel.logger.logError(LogCategory.PANEL, error, '創建提醒失敗');
                            this._panel.webview.postMessage({
                                type: 'alertCreated',
                                success: false,
                                error: error instanceof Error ? error.message : '創建提醒時發生未知錯誤'
                            });
                        });
                        break;
                    case 'updateAlert':
                        // 更新提醒
                        useAlertStore.getState().updateAlert(message.alertId, message.alertData).then(updatedAlert => {
                            if (updatedAlert) {
                                StockPanel.logger.log(LogCategory.PANEL, `更新提醒成功: ${updatedAlert.id}`);
                                this._panel.webview.postMessage({
                                    type: 'alertUpdated',
                                    alert: updatedAlert,
                                    success: true
                                });
                            } else {
                                this._panel.webview.postMessage({
                                    type: 'alertUpdated',
                                    success: false,
                                    error: '更新提醒失敗'
                                });
                            }
                        }).catch(error => {
                            StockPanel.logger.logError(LogCategory.PANEL, error, '更新提醒失敗');
                            this._panel.webview.postMessage({
                                type: 'alertUpdated',
                                success: false,
                                error: error instanceof Error ? error.message : '更新提醒時發生未知錯誤'
                            });
                        });
                        break;
                    case 'deleteAlert':
                        // 刪除提醒
                        useAlertStore.getState().deleteAlert(message.alertId).then(success => {
                            StockPanel.logger.log(LogCategory.PANEL, `刪除提醒 ${message.alertId} ${success ? '成功' : '失敗'}`);
                            this._panel.webview.postMessage({
                                type: 'alertDeleted',
                                alertId: message.alertId,
                                success: success
                            });
                        }).catch(error => {
                            StockPanel.logger.logError(LogCategory.PANEL, error, '刪除提醒失敗');
                            this._panel.webview.postMessage({
                                type: 'alertDeleted',
                                alertId: message.alertId,
                                success: false,
                                error: error instanceof Error ? error.message : '刪除提醒時發生未知錯誤'
                            });
                        });
                        break;
                    case 'getAlertHistory':
                        // 獲取提醒歷史
                        useAlertStore.getState().fetchAlertHistory(message.filters).then(() => {
                            const history = useAlertStore.getState().alertHistory;
                            StockPanel.logger.log(LogCategory.PANEL, `獲取提醒歷史成功: ${history.length} 筆記錄`);
                            this._panel.webview.postMessage({
                                type: 'updateAlertHistory',
                                history: history,
                                success: true
                            });
                        }).catch(error => {
                            StockPanel.logger.logError(LogCategory.PANEL, error, '獲取提醒歷史失敗');
                            this._panel.webview.postMessage({
                                type: 'updateAlertHistory',
                                history: [],
                                success: false,
                                error: error instanceof Error ? error.message : '獲取提醒歷史時發生未知錯誤'
                            });
                        });
                        break;
                    case 'getAlertHistoryByAlertId':
                        // 獲取特定提醒的歷史
                        useAlertStore.getState().fetchAlertHistoryByAlertId(message.alertId).then(history => {
                            StockPanel.logger.log(LogCategory.PANEL, `獲取提醒 ${message.alertId} 歷史成功: ${history.length} 筆記錄`);
                            this._panel.webview.postMessage({
                                type: 'updateAlertHistoryByAlertId',
                                alertId: message.alertId,
                                history: history,
                                success: true
                            });
                        }).catch(error => {
                            StockPanel.logger.logError(LogCategory.PANEL, error, `獲取提醒 ${message.alertId} 歷史失敗`);
                            this._panel.webview.postMessage({
                                type: 'updateAlertHistoryByAlertId',
                                alertId: message.alertId,
                                history: [],
                                success: false,
                                error: error instanceof Error ? error.message : '獲取提醒歷史時發生未知錯誤'
                            });
                        });
                        break;
                }
            },
            null,
            this._disposables
        );

        // 監聽 WebSocket 狀態變化
        const unsubscribeWs = useWebSocketStore.subscribe(
            (state) => {
                if (this._panel.visible && state.wsState === 'CONNECTED') {
                    // WebSocket 連接成功後，重新發送當前狀態
                    this._panel.webview.postMessage({
                        type: 'update',
                        stocks: useStockDataStore.getState().stocks,
                        twseIndex: useStockDataStore.getState().twseIndex
                    });
                }
            }
        );

        // 添加到待清理列表
        this._disposables.push({ dispose: () => {
            this._unsubscribeStockStore?.();
            this._unsubscribeIndiceStore?.();
            this._unsubscribeAlertStore?.();
            unsubscribeWs();
            unsubscribeSessionStore();
        }});
    }

    private _getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
        const scriptUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.js"]);
        const styleUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.css"]);
        const codiconsUri = getUri(webview, extensionUri, ["node_modules", "@vscode/codicons", "dist", "codicon.css"]);

        const nonce = getNonce();

        return /*html*/ `
            <!DOCTYPE html>
            <html lang="en">
                <head>
                    <meta charset="UTF-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}'; connect-src ws: wss:;">
                    <link rel="stylesheet" type="text/css" href="${styleUri}">
                    <link rel="stylesheet" type="text/css" href="${codiconsUri}">
                    <title>Stock Monitor</title>
                    <style>
                        .error-container {
                            color: #e74c3c;
                            padding: 10px;
                            margin: 10px 0;
                            border: 1px solid #e74c3c;
                            border-radius: 5px;
                            display: none;
                        }
                        
                        /* 添加一個加載指示器 */
                        .loading {
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            font-size: 16px;
                            color: var(--vscode-foreground);
                        }
                    </style>
                </head>
                <body>
                    <div id="root">
                        <div class="loading">Loading Stock Monitor...</div>
                    </div>
                    <div id="error-container" class="error-container"></div>
                    
                    <!-- Handle VS Code API Initialization -->
                    <script nonce="${nonce}">
                        // Initialize VS Code API only once
                        try {
                            // 定義全局變量，讓 React 應用可以檢查 API 是否已經獲取
                            window.vsCodeApiReady = false;
                            
                            const vscode = acquireVsCodeApi();
                            window.vscode = vscode;
                            window.vsCodeApiReady = true;
                            
                            // Store messages until React is ready
                            window.vscodePendingMessages = [];
                            
                            // Create a simple messaging system
                            window.addEventListener('message', event => {
                                const message = event.data;
                                console.log('Received message from extension:', message);
                                
                                if (window.handleVsCodeMessage) {
                                    window.handleVsCodeMessage(message);
                                } else {
                                    window.vscodePendingMessages.push(message);
                                    console.log('Stored message for later processing');
                                }
                            });
                            
                            // Request initial data
                            setTimeout(() => {
                                console.log('Requesting initial stock data');
                                vscode.postMessage({
                                    command: 'getStocks'
                                });
                            }, 1000);
                            
                            // 提供一個安全的方法來獲取 VS Code API
                            window.getVsCodeApi = function() {
                                if (window.vscode) {
                                    return window.vscode;
                                }
                                throw new Error('VS Code API is not available');
                            };
                            
                            // Prevent any future acquisitions of the VS Code API
                            window.acquireVsCodeApi = function() {
                                console.warn('acquireVsCodeApi() was called, but API is already acquired. Using existing instance.');
                                return window.vscode;
                            };
                        } catch (error) {
                            const errorContainer = document.getElementById('error-container');
                            errorContainer.style.display = 'block';
                            errorContainer.textContent = 'Error initializing VS Code API: ' + error.message;
                            console.error('VS Code API initialization error:', error);
                        }
                    </script>
                    
                    <!-- Load React App -->
                    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
                </body>
            </html>`;
    }

    public dispose() {
        StockPanel.logger.log(LogCategory.PANEL, `Panel dispose`);
        StockPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    public updateStocks(stocks: StockInventory[]) {
        if (this._panel) {
            const sanitizedStocks = this._deepSanitizeData(stocks);
            this._panel.webview.postMessage({
                type: 'updateStocks',
                stocks: sanitizedStocks
            });

            // 同時發送指數數據
            const twseIndex = useStockDataStore.getState().twseIndex;
            if (twseIndex) {
                const sanitizedIndex = this._deepSanitizeData([twseIndex])[0];
                this._panel.webview.postMessage({
                    type: 'updateTwseIndex',
                    index: sanitizedIndex
                });
            }
            
            // 發送指數數據
            const indices = useIndiceDataStore.getState().indices;
            this._panel.webview.postMessage({
                type: 'updateIndices',
                indices: indices
            });
        }
    }

    private _deepSanitizeData(data: any[]): any[] {
        return data.map(item => {
            // 創建一個新對象
            const sanitized: any = {};
            
            // 遍歷原始對象的所有屬性
            for (const [key, value] of Object.entries(item)) {
                // 根據屬性類型進行處理
                if (typeof value === 'number') {
                    // 已經是數字，保持不變
                    sanitized[key] = value;
                } else if (typeof value === 'string') {
                    // 嘗試將字符串轉換為數字
                    if (['price', 'change', 'changePercent', 'cost', 'volume', 'amount', 'open', 'high', 'low', 'close'].includes(key)) {
                        // 這些字段應該是數字
                        const numValue = key === 'volume' || key === 'amount' ? 
                            parseInt(value, 10) : parseFloat(value);
                        sanitized[key] = isNaN(numValue) ? 0 : numValue;
                    } else {
                        // 其他字符串字段保持不變
                        sanitized[key] = value;
                    }
                } else if (value === null || value === undefined) {
                    // 將 null 或 undefined 值設為 0（對於應該是數字的字段）
                    if (['price', 'change', 'changePercent', 'cost', 'volume', 'amount', 'open', 'high', 'low', 'close'].includes(key)) {
                        sanitized[key] = 0;
                    } else {
                        sanitized[key] = value;
                    }
                } else if (Array.isArray(value)) {
                    // 遞歸處理數組
                    sanitized[key] = this._deepSanitizeData(value);
                } else if (typeof value === 'object') {
                    // 遞歸處理嵌套對象
                    sanitized[key] = this._deepSanitizeData([value])[0];
                } else {
                    // 其他類型保持不變
                    sanitized[key] = value;
                }
            }
            
            // 確保關鍵數值字段存在，即使原始數據中沒有
            const numericFields = ['price', 'change', 'changePercent', 'volume', 'cost'];
            for (const field of numericFields) {
                if (sanitized[field] === undefined) {
                    sanitized[field] = 0;
                }
            }
            
            return sanitized;
        });
    }

} 