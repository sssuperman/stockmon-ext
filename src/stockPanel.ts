import * as vscode from 'vscode';
import { useWebSocketStore } from './store/websocketStore';
import { useStockDataStore } from './store/stockDataStore';
import { getNonce } from './utilities/getNonce';
import { getUri } from './utilities/getUri';
import { channel } from 'diagnostics_channel';
import { StockInventory } from './types';

export class StockPanel {
    private static outputChannel = vscode.window.createOutputChannel('Stock Monitor Pannel');
    public static currentPanel: StockPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private unsubscribeStockDataStore: () => void;
    private unsubscribeWebSocketStore: () => void;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        
        // Set the webview's initial html content
        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                StockPanel.outputChannel.appendLine(`Panel Received message from webview - command: ${message.command}`);
                switch (message.command) {
                    case 'getStocks':
                        // Send initial data to webview
                        const stockState = useStockDataStore.getState();
                        this._panel.webview.postMessage({
                            type: 'updateStocks',
                            stocks: stockState.stocks
                        });
                        if (stockState.twseIndex) {
                            this._panel.webview.postMessage({
                                type: 'updateTwseIndex',
                                index: stockState.twseIndex
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
                        useStockDataStore.getState().removeSubscription(message.symbol);
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
                                await useStockDataStore.getState().removeSubscription(message.symbol);
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

        // 合併兩個 StockDataStore 訂閱為一個
        this.unsubscribeStockDataStore = useStockDataStore.subscribe(
            (state) => {
                StockPanel.outputChannel.appendLine(`Panel Received StockDataStore update - stocks count: ${state.stocks.length}`);
                if (this._panel) {
                    // 更新股票列表
                    this._panel.webview.postMessage({
                        type: 'updateStocks',
                        stocks: state.stocks
                    });
                    
                    // 更新指數
                    if (state.twseIndex) {
                        this._panel.webview.postMessage({
                            type: 'updateTwseIndex',
                            index: state.twseIndex
                        });
                    }
                }
            }
        );

        // WebSocket 狀態訂閱
        this.unsubscribeWebSocketStore = useWebSocketStore.subscribe(
            (state) => {
                StockPanel.outputChannel.appendLine(`Panel Received WebSocketStore update - state: ${state.wsState}`);
                if (this._panel) {
                    this._panel.webview.postMessage({
                        type: 'updateWebSocketState',
                        state: state.wsState
                    });
                }
            }
        );
    }

    public static render(extensionUri: vscode.Uri) {
        StockPanel.outputChannel.appendLine(`Panel render`);
        if (StockPanel.currentPanel) {
            StockPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            StockPanel.outputChannel.appendLine(`Panel render reveal`);
        } else {
            const panel = vscode.window.createWebviewPanel(
                'stockmon',
                'Stock Monitor',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(extensionUri, 'webview-ui/build'),
                        vscode.Uri.joinPath(extensionUri, 'media')
                    ]
                }
            );

            StockPanel.currentPanel = new StockPanel(panel, extensionUri);
        }
        
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
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ws: wss:;">
                    <link rel="stylesheet" type="text/css" href="${styleUri}">
                    <link rel="stylesheet" type="text/css" href="${codiconsUri}">
                    <title>Stock Monitor</title>
                </head>
                <body>
                    <div id="root"></div>
                    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
                </body>
            </html>`;
    }

    public dispose() {
        StockPanel.outputChannel.appendLine(`Panel dispose`);
        StockPanel.currentPanel = undefined;
        this._panel.dispose();
        this.unsubscribeStockDataStore();
        this.unsubscribeWebSocketStore();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    public updateStocks(stocks: StockInventory[]) {
        if (this._panel) {
            this._panel.webview.postMessage({
                type: 'updateStocks',
                stocks: stocks
            });

            // 同時發送指數數據
            const twseIndex = useStockDataStore.getState().twseIndex;
            if (twseIndex) {
                this._panel.webview.postMessage({
                    type: 'updateTwseIndex',
                    index: twseIndex
                });
            }
        }
    }

} 