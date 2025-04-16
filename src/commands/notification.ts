import { LogCategory, LoggerService } from "src/utilities/loggerService";
import * as vscode from 'vscode';
import * as notifier from 'node-notifier';


export function registerNotificationCommands(context: vscode.ExtensionContext, logger: LoggerService) {

    let testNotificationCommand = vscode.commands.registerCommand('stockmon.testSystemNotification', async () => {
        try {
            logger.info(LogCategory.EXTENSION, '測試系統通知');

            // 使用明確的通知選項
            const nc = new notifier.NotificationCenter();

            // 取得平台信息
            const platform = process.platform;
            logger.info(LogCategory.EXTENSION, `當前操作系統: ${platform}`);



            nc.notify({
                title: 'MeerkatIO Alert',
                message: "test",
            });

            vscode.window.showInformationMessage('系統通知測試已觸發，請檢查系統通知區域');

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知錯誤';
            logger.logError(LogCategory.EXTENSION, error, '測試系統通知時發生錯誤');
            vscode.window.showErrorMessage(`測試系統通知時發生錯誤: ${errorMessage}`);
        }
    });

    context.subscriptions.push(testNotificationCommand);

    // 註冊簡單的系統通知測試命令 - 使用 Growl 作為備選
    let simpleNotificationCommand = vscode.commands.registerCommand('stockmon.testSimpleNotification', async () => {
        try {
            logger.info(LogCategory.EXTENSION, '測試簡單系統通知');

            // 導入特定的通知器
            const WindowsToaster = notifier.WindowsToaster;
            const NotifySend = notifier.NotifySend;
            const nc = notifier.NotificationCenter;

            // 根據平台選擇合適的通知器
            let specificNotifier;

            if (process.platform === 'win32') {
                // Windows
                specificNotifier = new WindowsToaster();
            } else if (process.platform === 'darwin') {
                // macOS - 使用 Growl 作為備選
                specificNotifier = new nc({
                    withFallback: true,
                    customPath: context.extensionPath + "/resources/terminal-notifier.app/Contents/MacOS/terminal-notifier"

                });
            } else {
                // Linux 和其他平台
                specificNotifier = new NotifySend();
            }

            // 使用特定通知器發送通知
            specificNotifier.notify({
                title: 'StockMon 股價提醒',
                message: `2330 台積電已達到目標價格：950`,
                wait: false
            }, (err, response) => {
                if (err) {
                    logger.logError(LogCategory.EXTENSION, err, '平台特定通知錯誤');

                    // 如果特定通知失敗，嘗試使用通用方法
                    notifier.notify({
                        title: 'StockMon 股價提醒',
                        message: '2330 台積電已達到目標價格：950'
                    });
                } else {
                    logger.info(LogCategory.EXTENSION, `通知響應: ${response}`);
                }
            });

            vscode.window.showInformationMessage('簡單系統通知測試已觸發，請檢查系統通知區域');

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知錯誤';
            logger.logError(LogCategory.EXTENSION, error, '測試簡單系統通知時發生錯誤');
            vscode.window.showErrorMessage(`測試簡單系統通知時發生錯誤: ${errorMessage}`);
        }
    });
    context.subscriptions.push(testNotificationCommand);
    context.subscriptions.push(simpleNotificationCommand);


}