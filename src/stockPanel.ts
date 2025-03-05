import * as vscode from 'vscode';
import { useWebSocketStore } from './store/websocketStore';
import { useStockDataStore } from './store/stockDataStore';
import { getNonce } from './utilities/getNonce';
import { getUri } from './utilities/getUri';
import { channel } from 'diagnostics_channel';
import { StockInventory } from './types';
import { LoggerService, LogCategory } from './utilities/loggerService';

export class StockPanel {
    private static logger = LoggerService.getInstance();
    public static currentPanel: StockPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _unsubscribeStockStore?: () => void;

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
        
        StockPanel.logger.log(LogCategory.PANEL, `Sending initial data to webview - stocks: ${initialStocks.length}, has index: ${!!initialTwseIndex}`);
        
        this._panel.webview.postMessage({
            type: 'init',
            stocks: initialStocks,
            twseIndex: initialTwseIndex
        });

        // 訂閱 store 更新 - 確保數據格式正確
        this._unsubscribeStockStore = useStockDataStore.subscribe(
            (state) => {
                if (this._panel.visible) {
                    const sanitizedStocks = this._deepSanitizeData(state.stocks);
                    const sanitizedIndex = state.twseIndex ? 
                        this._deepSanitizeData([state.twseIndex])[0] : null;
                    
                    StockPanel.logger.log(LogCategory.PANEL, `Store updated - sending to panel - stocks: ${sanitizedStocks.length}, has index: ${!!sanitizedIndex}`);
                    this._panel.webview.postMessage({
                        type: 'update',
                        stocks: sanitizedStocks,
                        twseIndex: sanitizedIndex
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
                        break;
                    case 'addStock':
                        vscode.commands.executeCommand('stockmon.addStock', message.symbol);
                        this._panel.webview.postMessage({
                            type: 'updateStocks',
                            stocks: useStockDataStore.getState().stocks
                        });
                        break;
                    case 'deleteStock':
                        useStockDataStore.getState().removeStock(message.symbol);
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
                                await useStockDataStore.getState().removeStock(message.symbol);
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
            unsubscribeWs();
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