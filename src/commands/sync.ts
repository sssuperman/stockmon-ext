import * as vscode from 'vscode';
import { processSyncQueue, syncUserStocksFromServer } from '../store/stockDataActionUserSync';
import { LanguageManager } from '../i18n/languageManager';
import { LoggerService, LogCategory } from '../utilities/loggerService';
import { useSessionStore } from 'src/store/sessionStore';
import { checkAndSync } from '../store/stockDataActionUserSync';

const languageManager = LanguageManager.getInstance();
let messages = languageManager.getMessage();

export function registerSyncCommands(context: vscode.ExtensionContext, logger: LoggerService) {

const syncUserStocksCommand = vscode.commands.registerCommand('stockmon.syncUserStocks', async () => {
    try {
        await syncUserStocksFromServer();
        vscode.window.showInformationMessage(messages.commands.syncUserStocks);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to sync user stocks: ${error}`);
    }
});

const processSyncQueueCommand =  vscode.commands.registerCommand('stockmon.processSyncQueue', async () => {
    try {
        logger.info(LogCategory.SYNC, 'Processing sync queue...');
        await processSyncQueue();
    } catch (error) {
        logger.logError(LogCategory.SYNC, error, 'Error processing sync queue');
        vscode.window.showErrorMessage(`Failed to process sync queue: ${error}`);
    }
});

const syncStocksCommand = vscode.commands.registerCommand('stockmon.syncStocks', async () => {
    try {
        logger.log(LogCategory.SYNC, 'Syncing stocks...');
        // ... existing code ...
    } catch (error) {
        logger.logError(LogCategory.SYNC, error, 'Error syncing stocks');
        vscode.window.showErrorMessage(`Sync error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});


const manualSyncCommand = vscode.commands.registerCommand('stockmon.manualSync', async () => {
        const logger = LoggerService.getInstance();
        const sessionStore = useSessionStore.getState();

        try {
            // 檢查用戶是否已登入
            if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
                logger.log(LogCategory.SYNC, 'User not authenticated, cannot sync');
                vscode.window.showWarningMessage(messages.sync.notAuthenticated);
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: messages.sync.syncing,
                cancellable: false
            }, async (progress) => {
                try {
                    // 執行同步
                    logger.log(LogCategory.SYNC, 'Manual sync triggered');
                    await checkAndSync();
                    vscode.window.showInformationMessage(messages.sync.syncComplete);
                } catch (error) {
                    logger.logError(LogCategory.SYNC, error, 'Manual sync failed');
                    vscode.window.showErrorMessage(`${messages.sync.syncFailed}: ${error instanceof Error ? error.message : '未知錯誤'}`);
                }
            });
        } catch (error) {
            logger.logError(LogCategory.SYNC, error, 'Manual sync command error');
        }
    });
    context.subscriptions.push(syncUserStocksCommand);
    context.subscriptions.push(manualSyncCommand);
    context.subscriptions.push(processSyncQueueCommand);
    context.subscriptions.push(syncStocksCommand);
}
