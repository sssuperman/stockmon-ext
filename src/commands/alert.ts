import * as vscode from 'vscode';
import { LoggerService, LogCategory } from '../utilities/loggerService';
// import { ExtensionContextManager } from '../utilities/contextManager';
import { useSessionStore } from 'src/store/sessionStore';
import { useAlertStore } from 'src/store/alertStore';
import { AlertTypeEnum } from '../store/alertStore';
import { StockPanel } from '../stockPanel';

const logger = LoggerService.getInstance();
// const context = ExtensionContextManager.getContext();

export function registerAlertCommands(context: vscode.ExtensionContext, logger: LoggerService) {
    logger.info(LogCategory.COMMAND, 'Registering alert commands');
    
    const setPriceAlertCommand = vscode.commands.registerCommand('stockmon.setPriceAlert', async (symbol?: string) => {
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

    const addAlertCommand = vscode.commands.registerCommand('stockmon.addAlert', async () => {
        try {
            logger.log(LogCategory.EXTENSION, 'Executing stockmon.addAlert command');
            
            // 檢查是否已登錄
            if (!useSessionStore.getState().sessionInfo?.is_authenticated) {
                const result = await vscode.window.showWarningMessage(
                    '需要登錄才能添加提醒',
                    '立即登錄',
                    '取消'
                );
                
                if (result === '立即登錄') {
                    vscode.commands.executeCommand('stockmon.login');
                }
                return;
            }
            
            // 讓用戶選擇股票代號
            const stockSymbol = await vscode.window.showInputBox({
                placeHolder: '請輸入股票代號 (例如: 2330)',
                prompt: '輸入您想要設置提醒的股票代號',
                validateInput: (value) => {
                    if (!value) {
                        return '股票代號不能為空';
                    }
                    if (!/^\d{1,4}$/.test(value)) {
                        return '股票代號必須是1-4位數字';
                    }
                    return null;
                }
            });
            
            if (!stockSymbol) {
                return; // 用戶取消操作
            }
            
            // 讓用戶選擇提醒類型
            const alertType = await vscode.window.showQuickPick(
                [
                    { label: '價格高於', value: AlertTypeEnum.PRICE_ABOVE },
                    { label: '價格低於', value: AlertTypeEnum.PRICE_BELOW },
                    { label: '漲幅高於', value: AlertTypeEnum.CHANGE_ABOVE },
                    { label: '跌幅高於', value: AlertTypeEnum.CHANGE_BELOW },
                    { label: '成交量高於', value: AlertTypeEnum.VOLUME_ABOVE }
                ],
                {
                    placeHolder: '選擇提醒類型',
                    title: '請選擇一種提醒類型'
                }
            );
            
            if (!alertType) {
                return; // 用戶取消操作
            }
            
            // 讓用戶輸入閾值
            const threshold = await vscode.window.showInputBox({
                placeHolder: '請輸入閾值',
                prompt: '輸入提醒的閾值(%)',
                validateInput: (value) => {
                    if (!value) {
                        return '閾值不能為空';
                    }
                    if (isNaN(Number(value)) || Number(value) <= 0) {
                        return '閾值必須是大於0的數字';
                    }
                    return null;
                }
            });
            
            if (!threshold) {
                return; // 用戶取消操作
            }
            
            // 格式化股票代號，確保是4位數
            const formattedStockSymbol = stockSymbol.padStart(4, '0');
            
            // 創建提醒名稱和描述
            let alertName = `${formattedStockSymbol} `;
            let alertDescription = `當 ${formattedStockSymbol} `;
            
            switch (alertType.value) {
                case AlertTypeEnum.PRICE_ABOVE:
                    alertName += `價格高於 ${threshold}`;
                    alertDescription += `價格高於 ${threshold} 時發出提醒`;
                    break;
                case AlertTypeEnum.PRICE_BELOW:
                    alertName += `價格低於 ${threshold}`;
                    alertDescription += `價格低於 ${threshold} 時發出提醒`;
                    break;
                case AlertTypeEnum.CHANGE_ABOVE:
                    alertName += `漲幅高於 ${threshold}%`;
                    alertDescription += `漲幅高於 ${threshold}% 時發出提醒`;
                    break;
                case AlertTypeEnum.CHANGE_BELOW:
                    alertName += `跌幅低於 ${threshold}%`;
                    alertDescription += `跌幅低於 ${threshold}% 時發出提醒`;
                    break;
                case AlertTypeEnum.VOLUME_ABOVE:
                    alertName += `成交量高於 ${threshold}`;
                    alertDescription += `成交量高於 ${threshold} 時發出提醒`;
                    break;
            }
            
            // 創建提醒
            const alertData = {
                name: alertName,
                description: alertDescription,
                stock_symbol: formattedStockSymbol,
                alert_type: alertType.value,
                threshold: parseFloat(threshold),
                is_active: true,
                is_premium: false,
                parameters: {},
                repeat_notification: false
            };
            
            // 顯示創建中的提示
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `正在創建提醒: ${alertName}`,
                    cancellable: false
                },
                async (progress) => {
                    try {
                        const result = await useAlertStore.getState().createAlert(alertData);
                        if (result) {
                            vscode.window.showInformationMessage(`成功創建提醒: ${alertName}`);
                            
                            // 如果 StockPanel 已開啟，則更新提醒列表
                            if (StockPanel.currentPanel) {
                                StockPanel.currentPanel.postMessageToWebview({
                                    type: 'alertCreated',
                                    alert: result,
                                    success: true
                                });
                            }
                        } else {
                            vscode.window.showErrorMessage('創建提醒失敗: 未知錯誤');
                        }
                    } catch (error) {
                        logger.logError(LogCategory.EXTENSION, error, '創建提醒時發生錯誤');
                        vscode.window.showErrorMessage(`創建提醒失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
                    }
                }
            );
        } catch (error) {
            logger.logError(LogCategory.EXTENSION, error, '執行添加提醒命令時發生錯誤');
            vscode.window.showErrorMessage(`添加提醒時發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
        }
    });

    const showAlertsCommand = vscode.commands.registerCommand('stockmon.showAlerts', () => {
        try {
            logger.info(LogCategory.EXTENSION, 'Show alerts command executed');
            
            // 首先確保面板存在
            const panel = StockPanel.createOrShow(context.extensionUri);
            
            // 然後向面板發送消息，切換到提醒視圖
            panel.postMessageToWebview({
                type: 'showAlertView'
            });
            
        } catch (error) {
            logger.logError(LogCategory.EXTENSION, error, 'Show alerts command error');
            vscode.window.showErrorMessage('顯示提醒視圖時發生錯誤');
        }
    });

    const showLoginOptionsCommand = vscode.commands.registerCommand('stockmon.showLoginOptions', async () => {
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

    context.subscriptions.push(setPriceAlertCommand);
    context.subscriptions.push(addAlertCommand);
    context.subscriptions.push(showAlertsCommand);
    context.subscriptions.push(showLoginOptionsCommand);
    
    logger.info(LogCategory.COMMAND, 'Alert commands registered successfully');
}