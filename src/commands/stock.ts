import * as vscode from 'vscode';
import { LoggerService, LogCategory } from '../utilities/loggerService';
import { useStockDataStore } from '../store/stockDataStore';
import { addStock, removeStock, updateStockCost } from '../store/stockDataActionUserStock'; // Import actions
import { LanguageManager } from '../i18n/languageManager';
// import { ExtensionContextManager } from 'src/utilities/contextManager';

// 不在文件頂層使用ExtensionContextManager
const logger = LoggerService.getInstance();
// const context = ExtensionContextManager.getContext();  // 刪除這行
const languageManager = LanguageManager.getInstance();
const messages = languageManager.getMessage();

// 將命令定義移動到註冊函數中
export function registerStockCommands(context: vscode.ExtensionContext, logger: LoggerService): void {
    logger.info(LogCategory.COMMAND, 'Registering stock commands');
    const languageManager = LanguageManager.getInstance();
    const messages = languageManager.getMessage();

    // Add Stock Command
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
                    await addStock([symbol]);

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
                    await removeStock(symbol);
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
                    let sharesInput = await vscode.window.showInputBox({
                        prompt: messages.stock.inputShares.replace('{0}', symbol),
                        value: existingCost?.quantity ? existingCost.quantity.toString() : '0',
                        validateInput: (value) => {
                            if (!value) {
                                return messages.stock.pleaseInputShares;
                            }
                            const shares = parseInt(value);
                            if (isNaN(shares) || shares < 0) {
                                return messages.stock.invalidShares;
                            }
                            return null;
                        }
                    });

                    if (sharesInput) {
                        const shares = parseInt(sharesInput);

                        try {
                            await updateStockCost(symbol, {
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
                            console.error('Error updating stock cost:', error);
                            vscode.window.showErrorMessage(`Failed to update cost: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error setting stock cost:', error);
            vscode.window.showErrorMessage(`Error setting stock cost: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

    // 添加命令到訂閱中
    context.subscriptions.push(addStockCommand);
    context.subscriptions.push(deleteStockCommand);
    context.subscriptions.push(setCostCommand);
    context.subscriptions.push(listStockCommand);
    
    logger.info(LogCategory.COMMAND, 'Stock commands registered successfully');
} 