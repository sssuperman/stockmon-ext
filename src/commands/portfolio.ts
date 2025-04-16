import * as vscode from 'vscode';
import { LoggerService, LogCategory } from '../utilities/loggerService';
import { ExtensionContextManager } from '../utilities/contextManager';
import { PortfolioViewProvider } from '../views/portfolioView';
import { StockPanel } from 'src/stockPanel';

const logger = LoggerService.getInstance();

const portfolioViewProvider = new PortfolioViewProvider();
const portfolioView = vscode.window.createTreeView('stockmonPortfolio', {
    treeDataProvider: portfolioViewProvider,
    showCollapseAll: true
});

export function registerPortfolioCommands(context: vscode.ExtensionContext, logger: LoggerService) {

    const refreshPortfolioCommand = vscode.commands.registerCommand('stockmon.refreshPortfolio', () => {
        logger.info(LogCategory.PORTFOLIO, 'Refreshing portfolio view...');
        portfolioViewProvider.refresh();
        vscode.window.showInformationMessage('Portfolio refreshed');
    });
    const showPortfolioViewCommand = vscode.commands.registerCommand('stockmon.showPortfolioView', async () => {
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
        StockPanel.messageHandlers.set('showPortfolioView', async () => {
            try {
                // 執行顯示 Portfolio 視圖的命令
                await vscode.commands.executeCommand('stockmon.showPortfolioView');
            } catch (error) {
                logger.logError(LogCategory.PORTFOLIO, error, '處理顯示 Portfolio 視圖請求時發生錯誤');
            }
        });
    });
    context.subscriptions.push(refreshPortfolioCommand);
    context.subscriptions.push(showPortfolioViewCommand);
    context.subscriptions.push(portfolioView);
    context.subscriptions.push(portfolioViewProvider);

}
