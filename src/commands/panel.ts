import * as vscode from 'vscode';
import { LoggerService, LogCategory } from '../utilities/loggerService';
import { StockPanel } from '../stockPanel'; // Import StockPanel
import { useStockDataStore } from '../store/stockDataStore';
import { useWebSocketStore } from '../store/websocketStore';
import { LanguageManager } from '../i18n/languageManager';
// const context = ExtensionContextManager.getContext();
const languageManager = LanguageManager.getInstance();


export function registerPanelCommands(context: vscode.ExtensionContext, logger: LoggerService): void {
    logger.info(LogCategory.COMMAND, 'Registering panel commands');
    
    const languageManager = LanguageManager.getInstance();
    const wsStore = useWebSocketStore.getState();
    
    const showPanelCommand = vscode.commands.registerCommand('stockmon.showPanel', async () => {
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
    });

    const showStockDetailCommand = vscode.commands.registerCommand('stockmon.showStockDetail', async (symbolOrStock: string | any) => {
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
    });
    
    const showStockDetailFromButtonCommand = vscode.commands.registerCommand('stockmon.showStockDetailFromButton', async (item: any) => {
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
    });

    const createFirstStockCommand = vscode.commands.registerCommand('stockmon.createFirstStock', async () => {
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
    });

    // Show Panel Command
    context.subscriptions.push(showPanelCommand);
    // Show Stock Detail Command (from portfolio view or direct call)
    context.subscriptions.push(showStockDetailCommand);
    // Show Stock Detail Command (specifically from TreeView button context)
    // This might be redundant if showStockDetail handles the 'item' object correctly.
    // Consider merging or ensuring showStockDetail handles `{ stock: { symbol: '...' } }`
    context.subscriptions.push(showStockDetailFromButtonCommand);
    // Create First Stock Command (Guidance)
    context.subscriptions.push(createFirstStockCommand);
    
    logger.info(LogCategory.COMMAND, 'Panel commands registered successfully');
}