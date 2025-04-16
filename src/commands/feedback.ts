import { useSessionStore } from "src/store/sessionStore";
import * as vscode from 'vscode';
import { LoggerService, LogCategory } from '../utilities/loggerService';
import axios from 'axios';
import { urls } from '../config';
import { StockPanel } from "src/stockPanel";

export function registerFeedbackCommands(context: vscode.ExtensionContext, logger: LoggerService) {
    // 註冊命令：處理用戶反饋
    const submitFeedbackCommand = vscode.commands.registerCommand('stockmon.submitFeedback', async (feedback: any) => {
        try {
            logger.info(LogCategory.FEEDBACK, `Submitting feedback: ${JSON.stringify(feedback)}`);

            // 獲取當前的 session token
            const sessionState = useSessionStore.getState();
            const token = sessionState.authToken;

            // 準備請求頭
            const headers: any = {
                'Content-Type': 'application/json'
            };

            // 如果已登入，添加認證 token
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            // 發送反饋到後端
            const response = await axios.post(urls.feedback.submit, feedback, { headers });

            logger.info(LogCategory.FEEDBACK, `Feedback submitted successfully: ${JSON.stringify(response.data)}`);

            // 通知 webview 提交成功
            if (StockPanel.currentPanel) {
                StockPanel.currentPanel.postMessageToWebview({
                    type: 'feedbackResponse',
                    data: {
                        status: 'success',
                        message: '反饋已成功提交'
                    }
                });
            }

        } catch (error) {
            logger.logError(LogCategory.FEEDBACK, error, '提交反饋時發生錯誤');

            // 通知 webview 提交失敗
            if (StockPanel.currentPanel) {
                StockPanel.currentPanel.postMessageToWebview({
                    type: 'feedbackResponse',
                    data: {
                        status: 'error',
                        message: '提交反饋時發生錯誤'
                    }
                });
            }
        }
    });

    context.subscriptions.push(submitFeedbackCommand);
}
