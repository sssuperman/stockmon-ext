import * as vscode from 'vscode';
import { StockService, StockData, DataSource } from './stockService';
import { StockPanel } from './stockPanel';
import { getLocaleMessages } from './i18n/locales';
import { LanguageManager } from './i18n/languageManager';
import { StateManager } from './stateManager';

export function activate(context: vscode.ExtensionContext) {
    // 創建狀態欄項目
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.name = "StockMon";
    statusBarItem.command = 'stockmon.showPanel';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    const stockService = new StockService(context, statusBarItem);
    let updateInterval: NodeJS.Timeout | undefined;
    const languageManager = LanguageManager.getInstance();
    const stateManager = StateManager.getInstance(context);
    let messages = languageManager.getMessage();

    // Function to update command titles based on current language
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
            { id: 'stockmon.clearAllSubscriptions', title: messages.commands.clearAllSubscriptions }
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
                updateStockDisplay();
            }
        })
    );

    // Initial update of command titles
    updateCommandTitles();

    // 從 StateManager 獲取初始訂閱
    const initialSubscriptions = stateManager.getSubscriptions();
    if (initialSubscriptions.size === 0) {
        // 如果沒有訂閱，添加預設股票
        const defaultSymbol = messages.stock.defaultStock;

        stateManager.updateSubscription(defaultSymbol, true);
    }

    // 等待 WebSocket 連接成功後再訂閱
    stockService.onWebSocketOpen(() => {
        const subscriptions = stateManager.getSubscriptions();
        if (subscriptions.size > 0) {
            stockService.updateSubscriptions(Array.from(subscriptions));
        }
    });

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

        const success = await stockService.login(username, password);
        if (success) {
            vscode.window.showInformationMessage(messages.auth.loginSuccess);
            // 立即更新 Panel
            if (StockPanel.currentPanel) {
                StockPanel.currentPanel['_update']();
            }
            updateStockDisplay();
        } else {
            vscode.window.showErrorMessage(messages.auth.loginFailed);
        }
    });

    // 添加登出命令
    let logoutCommand = vscode.commands.registerCommand('stockmon.logout', async () => {
        try {
            await stockService.logout();
            vscode.window.showInformationMessage(messages.auth.logoutSuccess);
            // 立即更新 Panel
            if (StockPanel.currentPanel) {
                StockPanel.currentPanel['_update']();
            }
            updateStockDisplay();
        } catch (error) {
            vscode.window.showErrorMessage(messages.auth.logoutFailed);
        }
    });

    // 顯示詳細資訊命令
    let showDetailsCommand = vscode.commands.registerCommand('stockmon.showDetails', async () => {
        const stockData = stockService.getLastStockData();
        if (!stockData || stockData.length === 0) {
            vscode.window.showInformationMessage(messages.details.noData);
            return;
        }

        // 建立每支股票的詳細資訊項目
        const items = stockData.map((stock: StockData) => {
            const priceIndicator = stock.isRealtime ? '' : '*';
            const changeSymbol = stock.change >= 0 ? '↑' : '↓';
            const profitSymbol = stock.profit && stock.profit >= 0 ? '↑' : '↓';
            
            const description = stock.cost !== undefined ? 
                `${stock.price.toFixed(2)}${priceIndicator} ${changeSymbol}${Math.abs(stock.change).toFixed(2)}` :
                `${stock.price.toFixed(2)}${priceIndicator} ${changeSymbol}${Math.abs(stock.change).toFixed(2)}`;
                
            const detail = stock.cost !== undefined ?
                `${messages.stock.cost}: ${stock.cost.toFixed(2)} | ${messages.stock.shares}: ${stock.shares} | ${messages.stock.profit}: ${profitSymbol}${Math.abs(stock.profit || 0).toFixed(2)}(${Math.abs(stock.profitPercent || 0).toFixed(2)}%)` :
                messages.stock.noCost;

            return {
                label: stock.symbol,
                description,
                detail
            };
        });

        // 顯示 QuickPick 視窗
        const quickPick = vscode.window.createQuickPick();
        quickPick.items = items;
        quickPick.title = messages.details.title;
        quickPick.placeholder = messages.details.setCostAndShares;
        
        // 當選擇項目時觸發設定成本
        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                const symbol = selected.label;
                quickPick.hide();
                
                // 呼叫設定成本的命令
                vscode.commands.executeCommand('stockmon.setCost', symbol);
            }
        });

        quickPick.show();
    });

    // 添加顯示面板命令
    let showPanelCommand = vscode.commands.registerCommand('stockmon.showPanel', () => {
        StockPanel.show(context.extensionUri, stockService);
    });

    // 更新股價顯示
    async function updateStockDisplay() {
        const subscriptions = stateManager.getSubscriptions();
        const stocks = Array.from(subscriptions);

        // 檢查 WebSocket 連接狀態
        const wsState = stockService.getWebSocketState();
        if (wsState === 'CONNECTING' || wsState === 'RECONNECTING') {
            statusBarItem.text = `$(loading~spin) ${messages.connection.connecting}`;
            statusBarItem.tooltip = messages.connection.connectingToService;
            statusBarItem.show();
            return;
        }

        if (wsState === 'CLOSED') {
            statusBarItem.text = `$(error) ${messages.connection.disconnected}`;
            statusBarItem.tooltip = messages.connection.clickToReconnect;
            statusBarItem.show();
            return;
        }

        if (stocks.length === 0) {
            statusBarItem.text = `$(graph) ${messages.stock.pleaseSetTrackingStocks}`;
            statusBarItem.tooltip = messages.stock.clickToSetStocks;
            statusBarItem.show();
            return;
        }

        // 重設提醒觸發狀態
        stockService.resetAlertTriggers();
        
        // 設定訊息處理器來更新狀態列
        stockService.setMessageHandler((data: any) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'stock_update' || message.type === 'stock_data') {
                    // 確保數據已經被處理
                    setTimeout(() => {
                        const stockData = stockService.getLastStockData();
                        // 只有在有股票數據時才更新狀態欄
                        if (stockData.some(stock => stock.symbol === message.symbol)) {
                            updateStatusBarAndTooltip();
                        }
                    }, 100);  // 給予一些時間讓 handleStockData 處理數據
                }
            } catch (error) {
                console.error('Error updating status bar:', error);
            }
        });

        // 檢查是否已有股票數據
        const lastStockData = stockService.getLastStockData();
        const hasValidData = lastStockData.some(stock => stocks.includes(stock.symbol));
        
        if (hasValidData) {
            updateStatusBarAndTooltip();
        } else {
            statusBarItem.text = `$(loading~spin) ${messages.stock.waitingForData}`;
            statusBarItem.tooltip = messages.stock.gettingPriceData;
            statusBarItem.show();
        }
    }

    // 更新狀態欄和浮動視窗
    function updateStatusBarAndTooltip() {
        const stockData = stockService.getLastStockData();
        const { totalProfit, totalProfitPercent } = stockService.calculateTotalProfit();
        
        // 更新狀態欄文字
        const totalProfitColor = totalProfit >= 0 ? '$(arrow-up)' : '$(arrow-down)';
        const formattedTotalProfit = Math.abs(totalProfit).toFixed(2);
        const formattedTotalProfitPercent = Math.abs(totalProfitPercent).toFixed(2);
        
        // 更新狀態欄
        statusBarItem.text = `$(graph) ${totalProfitColor}${formattedTotalProfit}(${formattedTotalProfitPercent}%)`;
        
        // 建立 MarkdownString 作為 tooltip
        const tooltipContent = new vscode.MarkdownString();
        tooltipContent.isTrusted = true;
        tooltipContent.supportHtml = true;

        tooltipContent.appendMarkdown(`# 股票收益統計 ${new Date().toLocaleDateString('zh-TW')}\n`);
        tooltipContent.appendMarkdown('---\n\n');
        
        stockData.forEach(stock => {
            const priceColor = stock.change >= 0 ? '↑' : '↓';
            const profitColor = (stock.profit || 0) >= 0 ? '↑' : '↓';
            
            // 基本股價資訊
            tooltipContent.appendMarkdown(`### ${stock.symbol}\n`);
            tooltipContent.appendMarkdown(`**現價:** ${stock.price.toFixed(2)} ${priceColor}${Math.abs(stock.change).toFixed(2)}\n\n`);
            
            // 如果有成本資訊，顯示損益
            if (stock.cost !== undefined) {
                tooltipContent.appendMarkdown(`**成本:** ${stock.cost.toFixed(2)} | **股數:** ${stock.shares}\n\n`);
                tooltipContent.appendMarkdown(`**損益:** ${profitColor}${Math.abs(stock.profit || 0).toFixed(2)}(${Math.abs(stock.profitPercent || 0).toFixed(2)}%)\n`);
            }
            tooltipContent.appendMarkdown('---\n\n');
        });

        // 總計資訊
        tooltipContent.appendMarkdown(`### 投資組合總計\n`);
        tooltipContent.appendMarkdown(`**總損益:** ${totalProfitColor === '$(arrow-up)' ? '↑' : '↓'}${formattedTotalProfit}\n\n`);
        tooltipContent.appendMarkdown(`**總報酬率:** ${totalProfitColor === '$(arrow-up)' ? '↑' : '↓'}${formattedTotalProfitPercent}%\n\n`);
        tooltipContent.appendMarkdown('---\n\n');
        tooltipContent.appendMarkdown('*點擊以開啟詳細資訊面板*');
        
        // 設定浮動視窗內容
        statusBarItem.tooltip = tooltipContent;
        statusBarItem.show();

        // 更新面板（如果存在）
        if (StockPanel.currentPanel) {
            StockPanel.currentPanel['_update']();
        }
    }

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
                    stockService.setPriceAlert(symbol, targetPrice, isAbove);
                    const direction = isAbove ? '上漲至' : '下跌至';
                    vscode.window.showInformationMessage(
                        `已設定 ${symbol} 股價${direction} ${targetPrice} 的提醒`
                    );
                }
            }
        }
    });

    // 管理到價提醒命令
    let managePriceAlertsCommand = vscode.commands.registerCommand('stockmon.managePriceAlerts', async () => {
        const allAlerts = stockService.getAllPriceAlerts();
        if (allAlerts.size === 0) {
            vscode.window.showInformationMessage('目前沒有設定任何到價提醒');
            return;
        }

        // 建立提醒清單項目
        const items: vscode.QuickPickItem[] = [];
        allAlerts.forEach((alerts, symbol) => {
            alerts.forEach(alert => {
                const direction = alert.isAbove ? '上漲至' : '下跌至';
                items.push({
                    label: symbol,
                    description: `${direction} ${alert.targetPrice}`,
                    detail: '點擊以移除此提醒'
                });
            });
        });

        // 顯示提醒清單
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '選擇要移除的到價提醒'
        });

        if (selected) {
            const symbol = selected.label;
            const targetPrice = parseFloat(selected.description!.split(' ')[1]);
            const isAbove = selected.description!.includes('上漲至');
            
            stockService.removePriceAlert(symbol, targetPrice, isAbove);
            vscode.window.showInformationMessage(`已移除 ${symbol} 的到價提醒`);
        }
    });

    // 新增股票命令
    let addStockCommand = vscode.commands.registerCommand('stockmon.addStock', async () => {
        const currentStocks = Array.from(stateManager.getSubscriptions());
        
        try {
            // 讓使用者輸入搜尋關鍵字
            const searchQuery = await vscode.window.showInputBox({
                prompt: messages.commands.searchStocks,
                placeHolder: '例如: 2330 或 台積電'
            });

            if (!searchQuery) {
                return;
            }

            // 搜尋股票
            const searchResults = await stockService.searchStocks(searchQuery);
            
            if (searchResults.length === 0) {
                vscode.window.showInformationMessage(messages.stock.noStocksInList);
                return;
            }

            // 讓使用者從搜尋結果中選擇
            const items = searchResults.map(stock => ({
                label: stock.symbol,
                description: stock.name,
                detail: currentStocks.includes(stock.symbol) ? '(已在追蹤清單中)' : undefined
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: messages.stock.selectStockToDelete,
                ignoreFocusOut: true
            });

            if (!selected) {
                return;
            }

            // 檢查是否已經在追蹤清單中
            if (currentStocks.includes(selected.label)) {
                vscode.window.showWarningMessage(messages.stock.alreadyInList.replace('{0}', selected.label));
                return;
            }

            // 新增到追蹤清單
            await stateManager.addSubscription(selected.label);
            stockService.updateSubscriptions([...currentStocks, selected.label]);
            updateStockDisplay();
            vscode.window.showInformationMessage(
                messages.stock.addSuccess
                    .replace('{0}', selected.label)
                    .replace('{1}', selected.description || '')
            );

            // 提示是否要設定成本
            const setCostResult = await vscode.window.showInformationMessage(
                messages.stock.setCostNow,
                messages.common.yes,
                messages.common.no
            );

            if (setCostResult === messages.common.yes) {
                vscode.commands.executeCommand('stockmon.setCost', selected.label);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`搜尋股票時發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
        }
    });

    // 新增搜尋股票命令
    let searchStocksCommand = vscode.commands.registerCommand('stockmon.searchStocks', async () => {
        try {
            const searchQuery = await vscode.window.showInputBox({
                prompt: '輸入股票代號或名稱進行搜尋',
                placeHolder: '例如: 2330 或 台積電'
            });

            if (!searchQuery) {
                return;
            }

            const searchResults = await stockService.searchStocks(searchQuery);
            
            if (searchResults.length === 0) {
                vscode.window.showInformationMessage('找不到符合的股票');
                return;
            }

            const currentStocks = Array.from(stateManager.getSubscriptions());
            const items = searchResults.map(stock => ({
                label: stock.symbol,
                description: stock.name,
                buttons: [
                    {
                        iconPath: new vscode.ThemeIcon('add'),
                        tooltip: '加入追蹤清單'
                    }
                ]
            }));

            const quickPick = vscode.window.createQuickPick();
            quickPick.items = items;
            quickPick.placeholder = '選擇股票以加入追蹤清單';
            
            // 處理點擊 "+" 按鈕的事件
            quickPick.onDidTriggerItemButton(async e => {
                const symbol = e.item.label;

                if (currentStocks.includes(symbol)) {
                    vscode.window.showWarningMessage(`${symbol} 已在追蹤清單中`);
                    return;
                }

                await stateManager.addSubscription(symbol);
                stockService.updateSubscriptions([...currentStocks, symbol]);
                updateStockDisplay();
                quickPick.hide();

                // 提示是否要設定成本
                const setCostResult = await vscode.window.showInformationMessage(
                    `已新增 ${symbol} (${e.item.description}) 到追蹤清單，是否要設定成本？`,
                    '是',
                    '否'
                );

                if (setCostResult === '是') {
                    vscode.commands.executeCommand('stockmon.setCost', symbol);
                }
            });

            // 處理選擇股票的事件
            quickPick.onDidAccept(async () => {
                const selected = quickPick.selectedItems[0];
                if (selected) {
                    const symbol = selected.label;

                    if (currentStocks.includes(symbol)) {
                        vscode.window.showWarningMessage(`${symbol} 已在追蹤清單中`);
                        quickPick.hide();
                        return;
                    }

                    await stateManager.addSubscription(symbol);
                    stockService.updateSubscriptions([...currentStocks, symbol]);
                    updateStockDisplay();
                    quickPick.hide();

                    // 提示是否要設定成本
                    const setCostResult = await vscode.window.showInformationMessage(
                        `已新增 ${symbol} (${selected.description}) 到追蹤清單，是否要設定成本？`,
                        '是',
                        '否'
                    );

                    if (setCostResult === '是') {
                        vscode.commands.executeCommand('stockmon.setCost', symbol);
                    }
                }
            });

            quickPick.show();
        } catch (error) {
            vscode.window.showErrorMessage(`搜尋股票時發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
        }
    });

    // 刪除股票命令
    let deleteStockCommand = vscode.commands.registerCommand('stockmon.deleteStock', async (symbol?: string) => {
        const currentStocks = Array.from(stateManager.getSubscriptions());
        
        if (currentStocks.length === 0) {
            vscode.window.showWarningMessage(messages.stock.noStocksInList);
            return;
        }

        // 如果沒有傳入symbol，讓使用者選擇要刪除的股票
        if (!symbol) {
            symbol = await vscode.window.showQuickPick(currentStocks, {
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
                await stateManager.updateSubscription(symbol, false);
                const newStocks = currentStocks.filter(s => s !== symbol);
                stockService.updateSubscriptions(newStocks);
                updateStockDisplay();
                vscode.window.showInformationMessage(messages.stock.deleteSuccess.replace('{0}', symbol));
            }
        }
    });

    // 更新股價命令
    let refreshCommand = vscode.commands.registerCommand('stockmon.refresh', () => {
        updateStockDisplay();
    });

    // 監聽設定變更
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('stockmon.symbols')) {
            const stocks = Array.from(stateManager.getSubscriptions());
            stockService.updateSubscriptions(stocks);
            updateStockDisplay();
            setupAutoRefresh();
        }
    }));

    // 設定自動更新
    function setupAutoRefresh() {
        if (updateInterval) {
            clearInterval(updateInterval);
        }

        // 使用固定的更新間隔（5分鐘）
        const interval = 5;
        updateInterval = setInterval(updateStockDisplay, interval * 60 * 1000);
    }

    // 設定股票成本命令
    let setCostCommand = vscode.commands.registerCommand('stockmon.setCost', async (symbol?: string) => {
        const stocks = Array.from(stateManager.getSubscriptions());
        
        if (stocks.length === 0) {
            vscode.window.showWarningMessage(messages.stock.noStocksInList);
            return;
        }

        // 如果沒有傳入symbol，讓使用者選擇要設定成本的股票
        if (!symbol) {
            symbol = await vscode.window.showQuickPick(stocks, {
                placeHolder: messages.stock.selectStockToDelete
            });
        }

        if (symbol) {
            const stockCost = stockService.getCost(symbol);
            
            // 輸入成本價格
            const costInput = await vscode.window.showInputBox({
                prompt: messages.stock.inputCostPrice.replace('{0}', symbol),
                value: stockCost?.cost.toString() || '',
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
                const cost = parseFloat(costInput);

                // 輸入股數
                const sharesInput = await vscode.window.showInputBox({
                    prompt: messages.stock.inputShares.replace('{0}', symbol),
                    value: stockCost?.shares.toString() || '1000',
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
                    stockService.setCost(symbol, cost, shares);
                    updateStockDisplay();
                    vscode.window.showInformationMessage(
                        messages.stock.setCostSuccess
                            .replace('{0}', symbol)
                            .replace('{1}', cost.toString())
                            .replace('{2}', shares.toString())
                    );
                }
            }
        }
    });

    // 手動觸發到價提醒檢查命令
    let manualCheckPriceAlertsCommand = vscode.commands.registerCommand('stockmon.manualCheckPriceAlerts', async () => {
        const stocks = Array.from(stateManager.getSubscriptions());
        
        if (stocks.length === 0) {
            vscode.window.showWarningMessage(messages.stock.noStocksInList);
            return;
        }

        // 讓使用者選擇要檢查的股票
        const symbol = await vscode.window.showQuickPick(stocks, {
            placeHolder: messages.alert.selectStock
        });

        if (symbol) {
            const triggeredAlerts = stockService.manualCheckPriceAlerts(symbol);
            
            if (triggeredAlerts.length === 0) {
                vscode.window.showInformationMessage(messages.alert.noTriggered.replace('{0}', symbol));
                return;
            }

            // 顯示觸發的提醒
            triggeredAlerts.forEach(alert => {
                const direction = alert.isAbove ? messages.alert.priceAbove : messages.alert.priceBelow;
                const currentPrice = stockService.getLastStockData().find((s: StockData) => s.symbol === symbol)?.price;
                
                vscode.window.showInformationMessage(
                    messages.alert.priceReached
                        .replace('{0}', symbol)
                        .replace('{1}', direction)
                        .replace('{2}', alert.targetPrice.toString())
                        .replace('{3}', currentPrice?.toString() || ''),
                    messages.alert.removeSuccess
                ).then(selection => {
                    if (selection === messages.alert.removeSuccess) {
                        stockService.removePriceAlert(alert.symbol, alert.targetPrice, alert.isAbove);
                        vscode.window.showInformationMessage(messages.alert.removeSuccess);
                    }
                });
            });
        }
    });

    // 清除所有訂閱命令
    let clearAllSubscriptionsCommand = vscode.commands.registerCommand('stockmon.clearAllSubscriptions', async () => {
        const result = await vscode.window.showWarningMessage(
            messages.subscription.clearConfirmation,
            { modal: true },
            messages.common.confirm,
            messages.common.cancel
        );

        if (result === messages.common.confirm) {
            await stockService.clearAllSubscriptions();
            // 清空設定中的股票列表
            const config = vscode.workspace.getConfiguration('stockmon');
            await config.update('symbols', [], vscode.ConfigurationTarget.Global);
            updateStockDisplay();
            vscode.window.showInformationMessage(messages.subscription.clearSuccess);
        }
    });

    context.subscriptions.push(addStockCommand);
    context.subscriptions.push(deleteStockCommand);
    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(setCostCommand);
    context.subscriptions.push(showDetailsCommand);
    context.subscriptions.push(setPriceAlertCommand);
    context.subscriptions.push(managePriceAlertsCommand);
    context.subscriptions.push(manualCheckPriceAlertsCommand);
    context.subscriptions.push(loginCommand);
    context.subscriptions.push(logoutCommand);
    context.subscriptions.push(showPanelCommand);
    context.subscriptions.push(searchStocksCommand);
    context.subscriptions.push(clearAllSubscriptionsCommand);

    // 初始化
    setupAutoRefresh();
}

export function deactivate() {
    // 清理工作
}
