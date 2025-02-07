import * as vscode from 'vscode';
import { StockService, StockData, WebSocketState } from './stockService';
import { LanguageManager } from './i18n/languageManager';
import { StateManager } from './stateManager';

export class StockPanel {
    public static currentPanel: StockPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _stockService: StockService;
    private readonly _stateManager: StateManager;
    private _disposables: vscode.Disposable[] = [];
    private _updateInterval: NodeJS.Timeout | undefined;
    private _languageManager: LanguageManager;
    private readonly _extensionUri: vscode.Uri;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, stockService: StockService) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._stockService = stockService;
        this._languageManager = LanguageManager.getInstance();
        this._stateManager = StateManager.getInstance(stockService.getContext());

        // 註冊更新事件處理器
        this._stockService.onUpdate(() => {
            this._update();
        });

        // 註冊 WebSocket 狀態變更處理器
        this._stockService.onWebSocketStateChange((state: WebSocketState) => {
            this._update();
        });

        this._update();
        this._setUpdateInterval();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 處理來自 WebView 的訊息
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'login':
                        await vscode.commands.executeCommand('stockmon.login');
                        this._update();
                        break;
                    case 'logout':
                        await vscode.commands.executeCommand('stockmon.logout');
                        this._update();
                        break;
                    case 'setCost':
                        // 呼叫 vscode 命令來設定成本並等待完成
                        await vscode.commands.executeCommand('stockmon.setCost', message.symbol);
                        // 手動更新最後一次的股票數據
                        const stockData = this._stockService.getLastStockData();
                        const stock = stockData.find(s => s.symbol === message.symbol);
                        if (stock) {
                            const cost = this._stockService.getCost(message.symbol);
                            if (cost && stock.price !== undefined) {
                                stock.cost = cost.cost;
                                stock.shares = cost.shares;
                                stock.profit = (stock.price - cost.cost) * cost.shares;
                                stock.profitPercent = ((stock.price - cost.cost) / cost.cost) * 100;
                            }
                        }
                        // 立即更新面板
                        this._update();
                        break;
                    case 'setPriceAlert':
                        // 呼叫 vscode 命令來設定提醒並等待完成
                        await vscode.commands.executeCommand('stockmon.setPriceAlert', message.symbol);
                        // 立即更新面板
                        this._update();
                        break;
                    case 'removePriceAlert':
                        this._stockService.removePriceAlert(message.symbol, message.targetPrice, message.isAbove);
                        vscode.window.showInformationMessage(`已移除 ${message.symbol} 的到價提醒`);
                        // 立即更新面板
                        this._update();
                        break;
                    case 'addStock':
                        await vscode.commands.executeCommand('stockmon.addStock');
                        break;
                    case 'confirmDelete':
                        await vscode.commands.executeCommand('stockmon.deleteStock', message.symbol);
                        break;
                    case 'confirmLogout':
                        // 顯示確認對話框
                        vscode.window.showWarningMessage(
                            this._languageManager.getMessage().auth.logoutConfirmation,
                            { modal: true },
                            this._languageManager.getMessage().common.confirm,
                            this._languageManager.getMessage().common.cancel
                        ).then(async selection => {
                            if (selection === this._languageManager.getMessage().common.confirm) {
                                await vscode.commands.executeCommand('stockmon.logout');
                                // 重新初始化 WebSocket
                                await this._stockService.reinitializeWebSocket();
                                // 重新訂閱股票
                                const subscriptions = Array.from(this._stateManager.getSubscriptions());
                                if (subscriptions.length > 0) {
                                    this._stockService.updateSubscriptions(subscriptions);
                                }
                                this._update();
                            }
                        });
                        break;
                }
            },
            null,
            this._disposables
        );

        // 監聽 StockService 的數據更新
        this._stockService.setMessageHandler((data: any) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'stock_update' || message.type === 'stock_data') {
                    this._update();
                }
            } catch (error) {
                console.error('Error updating panel:', error);
            }
        });
    }

    public static show(extensionUri: vscode.Uri, stockService: StockService) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (StockPanel.currentPanel) {
            StockPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'stockWatch',
            'St. Mon.',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        StockPanel.currentPanel = new StockPanel(panel, extensionUri, stockService);
    }

    private _setUpdateInterval() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }

        // 使用固定的更新間隔（5分鐘）
        const interval = 5;
        this._updateInterval = setInterval(() => this._update(), interval * 60 * 1000);
    }

    private _update() {
        const stockData = this._stockService.getLastStockData();
        const wsState = this._stockService.getWebSocketState();
        const isAuthenticated = this._stockService.isAuthenticated();
        const sessionInfo = this._stateManager.getSessionInfo();
        
        this._panel.webview.html = this._getWebviewContent(this._panel.webview);
    }

    private _getWebviewContent(webview: vscode.Webview): string {
        const messages = this._languageManager.getMessage();
        const stockData = this._stockService.getLastStockData();
        const { totalProfit, totalProfitPercent } = this._stockService.calculateTotalProfit();
        const isAuthenticated = this._stockService.isAuthenticated();
        const sessionInfo = this._stateManager.getSessionInfo();
        const wsState = this._stockService.getWebSocketState();

        // 建立認證狀態的 HTML
        const authStatusHtml = isAuthenticated
            ? `<div class="auth-status authenticated" onclick="handleAuth()" data-auth="true">
                 <span class="auth-icon">✓</span>
                 ${messages.auth.loggedInAs}: ${sessionInfo?.user || 'Unknown'}
               </div>`
            : `<div class="auth-status not-authenticated" onclick="handleAuth()" data-auth="false">
                 <span class="auth-icon">⚠</span>
                 ${messages.auth.login}
               </div>`;

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Stock Monitor</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 10px;
                        color: var(--vscode-foreground);
                        position: relative;
                    }
                    .auth-status {
                        position: absolute;
                        top: 5px;
                        right: 5px;
                        padding: 4px 8px;
                        border-radius: 3px;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        font-size: 0.85em;
                        opacity: 0.8;
                        cursor: pointer;
                        transition: opacity 0.2s;
                    }
                    .auth-status:hover {
                        opacity: 1;
                    }
                    .authenticated {
                        background-color: var(--vscode-gitDecoration-addedResourceForeground);
                        color: var(--vscode-editor-background);
                    }
                    .not-authenticated {
                        background-color: var(--vscode-gitDecoration-modifiedResourceForeground);
                        color: var(--vscode-editor-background);
                    }
                    .auth-icon {
                        font-size: 0.9em;
                    }
                    .stock-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                        gap: 10px;
                        margin-top: 20px;
                    }
                    .stock-card {
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 5px;
                        padding: 15px;
                        background-color: var(--vscode-editor-background);
                    }
                    .stock-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 10px;
                    }
                    .stock-symbol {
                        font-size: 1.2em;
                        font-weight: bold;
                    }
                    .stock-name {
                        font-size: 0.9em;
                        font-weight: normal;
                        opacity: 0.8;
                        margin-left: 8px;
                    }
                    .stock-price {
                        font-size: 1.1em;
                    }
                    .stock-change {
                        margin-top: 5px;
                    }
                    .stock-details {
                        margin-top: 10px;
                        padding-top: 10px;
                        border-top: 1px solid var(--vscode-panel-border);
                    }
                    .profit-up {
                        color: var(--vscode-terminal-ansiGreen);
                    }
                    .profit-down {
                        color: var(--vscode-terminal-ansiRed);
                    }
                    .total-profit {
                        font-size: 1.2em;
                        margin-top: 20px;
                        padding: 10px;
                        border-radius: 5px;
                        background-color: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                    }
                    .realtime-badge {
                        font-size: 0.8em;
                        padding: 2px 6px;
                        border-radius: 3px;
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        margin-left: 5px;
                    }
                    .realtime-badge.connecting {
                        background-color: var(--vscode-statusBarItem-warningBackground);
                    }
                    .realtime-badge.offline {
                        background-color: var(--vscode-statusBarItem-errorBackground);
                    }
                    .action-bar {
                        margin: 15px 0;
                        display: flex;
                        gap: 10px;
                    }
                    .action-button {
                        display: inline-flex;
                        align-items: center;
                        gap: 5px;
                        padding: 6px 12px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                        font-size: 0.9em;
                    }
                    .action-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    .codicon {
                        font-family: codicon;
                        font-size: 1em;
                    }
                    .codicon-add:before {
                        content: "\\ea60";
                    }
                    .card-actions {
                        position: relative;
                        display: flex;
                        justify-content: flex-end;
                        margin-top: 10px;
                    }
                    .menu-dots {
                        background: none;
                        border: none;
                        color: var(--vscode-foreground);
                        cursor: pointer;
                        padding: 4px 8px;
                        border-radius: 3px;
                        opacity: 0.6;
                        font-size: 16px;
                        line-height: 1;
                    }
                    .menu-dots:hover {
                        opacity: 1;
                        background-color: var(--vscode-button-secondaryBackground);
                    }
                    .menu-content {
                        display: none;
                        position: absolute;
                        right: 0;
                        top: 100%;
                        background-color: var(--vscode-menu-background);
                        border: 1px solid var(--vscode-menu-border);
                        border-radius: 3px;
                        box-shadow: 0 2px 8px var(--vscode-widget-shadow);
                        z-index: 1000;
                        min-width: 160px;
                    }
                    .menu-content.show {
                        display: block;
                    }
                    .menu-item {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 6px 12px;
                        color: var(--vscode-menu-foreground);
                        background: none;
                        border: none;
                        width: 100%;
                        text-align: left;
                        cursor: pointer;
                        font-size: 0.9em;
                    }
                    .menu-item:hover {
                        background-color: var(--vscode-menu-selectionBackground);
                        color: var(--vscode-menu-selectionForeground);
                    }
                    .codicon-gear:before {
                        content: "\\ea6c";
                    }
                    .codicon-bell:before {
                        content: "\\ea64";
                    }
                    .codicon-trash:before {
                        content: "\\ea81";
                    }
                </style>
            </head>
            <body>
                ${authStatusHtml}
                
                <div class="total-profit ${totalProfit >= 0 ? 'profit-up' : 'profit-down'}">
                    ${messages.panel.totalProfit}: ${totalProfit >= 0 ? '↑' : '↓'}${Math.abs(totalProfit).toFixed(2)} (${Math.abs(totalProfitPercent).toFixed(2)}%)
                </div>

                <div class="action-bar">
                    <button class="action-button" onclick="addStock()">
                        <span class="codicon codicon-add"></span>
                        ${messages.stock.add}
                    </button>
                </div>

                <div class="stock-grid">
                    ${stockData.map((stock, index) => {
                        const profitClass = (stock.profit || 0) >= 0 ? 'profit-up' : 'profit-down';
                        let statusBadge = '';
                        if (wsState === WebSocketState.CONNECTED && stock.isRealtime) {
                            statusBadge = '<span class="realtime-badge">Realtime</span>';
                        } else if ([WebSocketState.CONNECTING, WebSocketState.RECONNECTING].includes(wsState)) {
                            statusBadge = '<span class="realtime-badge connecting">Connecting</span>';
                        } else if (wsState === WebSocketState.CLOSED) {
                            statusBadge = '<span class="realtime-badge offline">Offline</span>';
                        } else {
                            // 其他狀態（如 CLOSING）也顯示為 Connecting
                            statusBadge = '<span class="realtime-badge connecting">Connecting</span>';
                        }
                        return `
                            <div class="stock-card">
                                <div class="stock-header">
                                    <span class="stock-symbol">
                                        ${stock.symbol}
                                        ${stock.name ? `<span class="stock-name">${stock.name}</span>` : ''}
                                    </span>
                                    <span class="stock-price">
                                        ${stock.price.toFixed(2)}
                                        ${statusBadge}
                                    </span>
                                </div>
                                <div class="stock-change ${stock.change >= 0 ? 'profit-up' : 'profit-down'}">
                                    ${stock.change >= 0 ? '↑' : '↓'}${Math.abs(stock.change).toFixed(2)} (${Math.abs(stock.changePercent).toFixed(2)}%)
                                </div>
                                ${stock.cost !== undefined ? `
                                    <div class="stock-details">
                                        <div>${messages.stock.cost}: ${stock.cost.toFixed(2)} | ${messages.stock.shares}: ${stock.shares}</div>
                                        <div class="${profitClass}">
                                            ${messages.stock.profit}: ${(stock.profit || 0) >= 0 ? '↑' : '↓'}${Math.abs(stock.profit || 0).toFixed(2)} (${Math.abs(stock.profitPercent || 0).toFixed(2)}%)
                                        </div>
                                    </div>
                                ` : ''}
                                <div class="card-actions">
                                    <button class="menu-dots" onclick="toggleMenu(${index})">⋮</button>
                                    <div class="menu-content" id="menu-${index}">
                                        <button class="menu-item" onclick="setCost('${stock.symbol}')">
                                            <span class="codicon codicon-gear"></span>
                                            ${messages.stock.setCost}
                                        </button>
                                        <button class="menu-item" onclick="setPriceAlert('${stock.symbol}')">
                                            <span class="codicon codicon-bell"></span>
                                            ${messages.stock.setAlert}
                                        </button>
                                        <button class="menu-item" onclick="confirmDelete('${stock.symbol}')">
                                            <span class="codicon codicon-trash"></span>
                                            ${messages.stock.delete}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function handleAuth() {
                        const isAuthenticated = document.querySelector('.auth-status').dataset.auth === 'true';
                        if (isAuthenticated) {
                            // 如果已登入，先詢問是否要登出
                            vscode.postMessage({
                                command: 'confirmLogout'
                            });
                        } else {
                            // 如果未登入，直接觸發登入
                            vscode.postMessage({
                                command: 'login'
                            });
                        }
                    }

                    function addStock() {
                        vscode.postMessage({
                            command: 'addStock'
                        });
                    }

                    function setCost(symbol) {
                        vscode.postMessage({
                            command: 'setCost',
                            symbol: symbol
                        });
                    }

                    function setPriceAlert(symbol) {
                        vscode.postMessage({
                            command: 'setPriceAlert',
                            symbol: symbol
                        });
                    }

                    function confirmDelete(symbol) {
                        vscode.postMessage({
                            command: 'confirmDelete',
                            symbol: symbol
                        });
                    }

                    function toggleMenu(index) {
                        const menus = document.querySelectorAll('.menu-content');
                        menus.forEach((menu, i) => {
                            if (i !== index) {
                                menu.classList.remove('show');
                            }
                        });
                        const menuElement = document.getElementById('menu-' + index);
                        if (menuElement) {
                            menuElement.classList.toggle('show');
                        }
                    }

                    // 點擊其他地方時關閉選單
                    document.addEventListener('click', function(event) {
                        if (!event.target.matches('.menu-dots')) {
                            const menus = document.querySelectorAll('.menu-content');
                            menus.forEach(function(menuElement) {
                                menuElement.classList.remove('show');
                            });
                        }
                    });
                </script>
            </body>
            </html>`;
    }

    public dispose() {
        StockPanel.currentPanel = undefined;

        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
} 