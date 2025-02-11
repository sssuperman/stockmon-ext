import * as vscode from 'vscode';
import { getLocaleMessages } from './i18n/locales';
import { LanguageManager } from './i18n/languageManager';
import { switchEnvironment } from './config';
import { useWebSocketStore } from './store/websocketStore';
import { useStockDataStore } from './store/stockDataStore';
import { useSessionStore } from './store/sessionStore';
import { StockPanel } from './stockPanel';
import { ExtensionContextManager } from './utilities/contextManager';

export function activate(context: vscode.ExtensionContext) {
    // Initialize the context manager first
    ExtensionContextManager.initialize(context);

    // 創建狀態欄項目
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.name = "StockMon";
    statusBarItem.command = 'stockmon.showPanel';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // const stockService = new StockService(context, statusBarItem);
    const languageManager = LanguageManager.getInstance();
    // const stockState = stateManager.getStockState();
    const stockState = useStockDataStore.getState();
    let messages = languageManager.getMessage();

    // const outputChannel = vscode.window.createOutputChannel('Stock Mon WebSocket');
    const outputChannel = vscode.window.createOutputChannel('Stock Mon Extension.ts');
    context.subscriptions.push(outputChannel);

    // Initialize WebSocket connection with output channel
    const wsStore = useWebSocketStore.getState();
    wsStore.connect(outputChannel);

    // Subscribe to WebSocket state changes
    useWebSocketStore.subscribe(
        (state) => {
            const wsState = state.wsState;

            switch (wsState) {
                case 'CONNECTED':
                    statusBarItem.text = "$(radio-tower) StockMon";
                    statusBarItem.tooltip = "Connected to stock service";
                    useStockDataStore.getState().subscribeToAllStocks();

                    break;
                case 'CONNECTING':
                    statusBarItem.text = "$(sync~spin) StockMon";
                    statusBarItem.tooltip = "Connecting to stock service...";
                    break;
                case 'CLOSED':
                    statusBarItem.text = "$(warning) StockMon";
                    statusBarItem.tooltip = "Disconnected from stock service";
                    break;
            }
        }
    );

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
            { id: 'stockmon.showSessionInfo', title: messages.commands.showSessionInfo }
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


    // 添加登入命令
    let loginCommand = vscode.commands.registerCommand('stockmon.login', async () => {
        const username = await vscode.window.showInputBox({
            prompt: messages.auth.username,
            placeHolder: messages.auth.username
        });

        if (!username) {
            return;
        }

        const password = await vscode.window.showInputBox({
            prompt: messages.auth.password,
            password: true,
            placeHolder: messages.auth.password
        });

        if (!password) {
            return;
        }

        const token = await useSessionStore.getState().login(username, password, context);

        if (token) {
            vscode.window.showInformationMessage(messages.auth.loginSuccess);
            outputChannel.appendLine(`[${new Date().toLocaleString()}] Login successful for user: ${username}`);
            // 立即更新 Panel
        } else {
            vscode.window.showErrorMessage(messages.auth.loginFailed);
        }
    });

    // 添加登出命令
    let logoutCommand = vscode.commands.registerCommand('stockmon.logout', async () => {
        try {
            await useSessionStore.getState().logout(context);
            vscode.window.showInformationMessage(messages.auth.logoutSuccess);
            // 立即更新 Panel
            // if (StockPanel.currentPanel) {
            //     StockPanel.currentPanel['_update']();
            // }
            // updateStockDisplay();
        } catch (error) {
            vscode.window.showErrorMessage(messages.auth.logoutFailed);
        }
    });


    let showSessionInfoCommand = vscode.commands.registerCommand('stockmon.showSessionInfo', () => {
        useSessionStore.getState().showSessionInfoAndAuthToken(outputChannel);
    });


    // 添加顯示面板命令
    let showPanelCommand = vscode.commands.registerCommand('stockmon.showPanel', () => {
        StockPanel.render(context.extensionUri);
    });



    // // 更新狀態欄和浮動視窗
    // function updateStatusBarAndTooltip() {
    //     const stockData = stockService.getLastStockData();
    //     const { totalProfit, totalProfitPercent } = stockService.calculateTotalProfit();

    //     // 更新狀態欄文字
    //     const totalProfitColor = totalProfit >= 0 ? '$(arrow-up)' : '$(arrow-down)';
    //     const formattedTotalProfit = Math.abs(totalProfit).toFixed(2);
    //     const formattedTotalProfitPercent = Math.abs(totalProfitPercent).toFixed(2);

    //     // 更新狀態欄
    //     statusBarItem.text = `$(graph) ${totalProfitColor}${formattedTotalProfit}(${formattedTotalProfitPercent}%)`;

    //     // 建立 MarkdownString 作為 tooltip
    //     const tooltipContent = new vscode.MarkdownString();
    //     tooltipContent.isTrusted = true;
    //     tooltipContent.supportHtml = true;

    //     tooltipContent.appendMarkdown(`# 股票收益統計 ${new Date().toLocaleDateString('zh-TW')}\n`);
    //     tooltipContent.appendMarkdown('---\n\n');

    //     stockData.forEach((stock: StockInventory) => {
    //         const priceColor = stock.change >= 0 ? '↑' : '↓';
    //         const profitColor = (stock.profit || 0) >= 0 ? '↑' : '↓';

    //         // 基本股價資訊
    //         tooltipContent.appendMarkdown(`### ${stock.symbol}\n`);
    //         tooltipContent.appendMarkdown(`**現價:** ${stock.price.toFixed(2)} ${priceColor}${Math.abs(stock.change).toFixed(2)}\n\n`);

    //         // 如果有成本資訊，顯示損益
    //         if (stock.cost !== undefined) {
    //             tooltipContent.appendMarkdown(`**成本:** ${stock.cost.cost.toFixed(2)} | **股數:** ${stock.shares}\n\n`);
    //             tooltipContent.appendMarkdown(`**損益:** ${profitColor}${Math.abs(stock.profit || 0).toFixed(2)}(${Math.abs(stock.profitPercent || 0).toFixed(2)}%)\n`);
    //         }
    //         tooltipContent.appendMarkdown('---\n\n');
    //     });

    //     // 總計資訊
    //     tooltipContent.appendMarkdown(`### 投資組合總計\n`);
    //     tooltipContent.appendMarkdown(`**總損益:** ${totalProfitColor === '$(arrow-up)' ? '↑' : '↓'}${formattedTotalProfit}\n\n`);
    //     tooltipContent.appendMarkdown(`**總報酬率:** ${totalProfitColor === '$(arrow-up)' ? '↑' : '↓'}${formattedTotalProfitPercent}%\n\n`);
    //     tooltipContent.appendMarkdown('---\n\n');
    //     tooltipContent.appendMarkdown('*點擊以開啟詳細資訊面板*');

    //     // 設定浮動視窗內容
    //     statusBarItem.tooltip = tooltipContent;
    //     statusBarItem.show();

    //     // 更新面板（如果存在）
    //     if (StockPanel.currentPanel) {
    //         StockPanel.currentPanel['_update']();
    //     }
    // }

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
                const currentStocks = useStockDataStore.getState().stocks;

                if (currentStocks.some(stock => stock.symbol === symbol)) {
                    vscode.window.showWarningMessage(`${symbol} 已在追蹤清單中`);
                    return;
                }

                try {
                    await useStockDataStore.getState().addSubscription(symbol);
                    const setCostResult = await vscode.window.showInformationMessage(
                        `已新增 ${symbol} (${selected.description}) 到追蹤清單，是否要設定成本？`,
                        '是',
                        '否'
                    );

                    if (setCostResult === '是') {
                        vscode.commands.executeCommand('stockmon.setCost', symbol);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`新增股票失敗: ${symbol}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`搜尋股票時發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
            console.error('Search stock error:', error);
        }
    });

    // 刪除股票命令
    let deleteStockCommand = vscode.commands.registerCommand('stockmon.deleteStock', async (symbol?: string) => {
        const currentStocks = Array.from(useStockDataStore.getState().stocks);

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
                    // 先刪除成本資料
                    await useStockDataStore.getState().removeStockCost(symbol);

                    // 使用 stockState 處理取消訂閱
                    await useStockDataStore.getState().removeSubscription(symbol);

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
    let setCostCommand = vscode.commands.registerCommand('stockmon.setCost', async (symbol?: string) => {
        const stockState = useStockDataStore.getState();
        const stocks = stockState.stocks;

        if (stocks.length === 0) {
            vscode.window.showWarningMessage(messages.stock.noStocksInList);
            return;
        }

        // 如果沒有傳入symbol，讓使用者選擇要設定成本的股票
        if (!symbol) {
            const stockOptions = stocks.map(stock => ({
                label: stock.symbol,
                description: stock.name
            }));

            const selected = await vscode.window.showQuickPick(stockOptions, {
                placeHolder: messages.stock.selectStockToDelete
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
                value: existingCost?.cost.toString() || '',
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
                    value: existingCost?.quantity.toString() || '1000',
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

                    // 更新成本資訊
                    try {
                        await stockState.updateStockCost(symbol, {
                            cost: costPrice,
                            quantity: shares,
                            averageCost: costPrice  // 因為是設定成本，所以平均成本就是成本價
                        });

                        vscode.window.showInformationMessage(
                            messages.stock.setCostSuccess
                                .replace('{0}', symbol)
                                .replace('{1}', costPrice.toString())
                                .replace('{2}', shares.toString())
                        );
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to set cost for ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                }
            }
        }
    });


    let listStockCommand = vscode.commands.registerCommand('stockmon.listStock', () => {
        const stocks = useStockDataStore.getState().stocks;
        outputChannel.appendLine('=== Current Stocks in Store ===');
        outputChannel.appendLine(JSON.stringify(stocks, null, 2));
        outputChannel.show(); // 自動顯示 output channel
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
    context.subscriptions.push(showPanelCommand);
    // context.subscriptions.push(clearAllSubscriptionsCommand);
    context.subscriptions.push(listStockCommand);
    context.subscriptions.push(showSessionInfoCommand);

    // 添加環境切換命令
    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.switchToDevelopment', async () => {
            await switchEnvironment('development');
            // 重新初始化 WebSocket 連接
            wsStore.disconnect();
            wsStore.connect(outputChannel);
            vscode.window.showInformationMessage('Switched to Development Environment');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('stockmon.switchToProduction', async () => {
            await switchEnvironment('production');
            // 重新初始化 WebSocket 連接
            wsStore.disconnect();
            wsStore.connect(outputChannel);
            vscode.window.showInformationMessage('Switched to Production Environment');
        })
    );

    // Clean up WebSocket connection when extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            wsStore.disconnect();
        }
    });
}

export function deactivate() {
    // WebSocket cleanup is handled by the subscription above
}
