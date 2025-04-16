import { LogCategory, LoggerService } from "src/utilities/loggerService";
import * as vscode from 'vscode';
// import { ExtensionContextManager } from "src/utilities/contextManager";
import { useSessionStore } from "src/store/sessionStore";
import { SessionInfo } from "src/types";
import { isTokenExpired } from "src/utilities/tokenUtils";
import axios from "axios";
import { urls } from "src/config";
import { useWebSocketStore } from "src/store/websocketStore";

const logger = LoggerService.getInstance();
// const context = ExtensionContextManager.getContext();

export function registerDebugCommands(context: vscode.ExtensionContext, logger: LoggerService): void {
    logger.info(LogCategory.COMMAND, 'Registering debug commands');
    
    const showExtensionInfoCommand = vscode.commands.registerCommand('stockmon.showExtensionInfo', () => {
        const extensionId = context.extension.id;
        const uriScheme = vscode.env.uriScheme;
        const appExtensionId = extensionId.split('.').pop() || 'stockmon';

        logger.info(LogCategory.EXTENSION, `Extension ID: ${extensionId}`);
        logger.info(LogCategory.EXTENSION, `URI Scheme: ${uriScheme}`);
        logger.info(LogCategory.EXTENSION, `App Extension ID: ${appExtensionId}`);

        vscode.window.showInformationMessage(`擴展 ID: ${extensionId}\nURI 方案: ${uriScheme}\n應用擴展 ID: ${appExtensionId}`);
    });

    const checkSessionStoreCommand = vscode.commands.registerCommand('stockmon.checkSessionStore', () => {
        try {
            const sessionState = useSessionStore.getState();
            logger.info(LogCategory.EXTENSION, '=== Session Store State ===');
            logger.info(LogCategory.EXTENSION, `Auth Token: ${sessionState.authToken ? 'present' : 'null'}`);
            logger.info(LogCategory.EXTENSION, `Is Authenticated: ${sessionState.isAuthenticated}`);
            logger.info(LogCategory.EXTENSION, `Session Info: ${JSON.stringify(sessionState.sessionInfo, null, 2)}`);
            logger.info(LogCategory.EXTENSION, `Client UUID: ${sessionState.clientUuid}`);

            // 檢查 global state
            const savedToken = context.globalState.get<string>('authToken');
            const savedSession = context.globalState.get<SessionInfo>('sessionInfo');
            logger.info(LogCategory.EXTENSION, '=== Global State ===');
            logger.info(LogCategory.EXTENSION, `Saved Token: ${savedToken ? 'present' : 'null'}`);
            logger.info(LogCategory.EXTENSION, `Saved Session: ${JSON.stringify(savedSession, null, 2)}`);

            // 檢查 token 是否過期
            if (savedToken) {
                try {
                    const expired = isTokenExpired(savedToken);
                    logger.info(LogCategory.EXTENSION, `Token Expired: ${expired}`);
                } catch (error) {
                    logger.warning(LogCategory.EXTENSION, `Failed to check token expiration: ${error}`);
                }
            }

            // 顯示通知
            vscode.window.showInformationMessage(`Session 狀態: ${sessionState.isAuthenticated ? '已登入' : '未登入'}`);

            // 顯示日誌
            logger.show();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.logError(LogCategory.EXTENSION, error, 'Failed to check session store');
            vscode.window.showErrorMessage(`檢查 session store 失敗: ${errorMessage}`);
        }
    });

    const testApiRequestCommand = vscode.commands.registerCommand('stockmon.testApiRequest', async () => {
        try {
            const sessionState = useSessionStore.getState();
            logger.info(LogCategory.EXTENSION, '=== Testing API Request ===');

            if (!sessionState.authToken || !sessionState.isAuthenticated) {
                logger.warning(LogCategory.EXTENSION, 'No auth token or not authenticated, cannot test API request');
                vscode.window.showWarningMessage('未登入，無法測試 API 請求');
                return;
            }

            logger.info(LogCategory.EXTENSION, `Using auth token: ${sessionState.authToken ? 'present' : 'null'}`);
            logger.info(LogCategory.EXTENSION, `Client UUID: ${sessionState.clientUuid}`);

            // 構建請求頭
            const headers = {
                'Authorization': `Bearer ${sessionState.authToken}`,
                'Content-Type': 'application/json',
                'X-Client-UUID': sessionState.clientUuid
            };

            logger.info(LogCategory.EXTENSION, `Request headers: ${JSON.stringify(headers)}`);
            logger.info(LogCategory.EXTENSION, `Request URL: ${urls.stocks.list}`);

            // 發送請求
            const response = await axios.get(urls.stocks.list, { headers });

            logger.info(LogCategory.EXTENSION, `Response status: ${response.status}`);
            logger.info(LogCategory.EXTENSION, `Response data: ${JSON.stringify(response.data)}`);

            // 顯示通知
            vscode.window.showInformationMessage(`API 請求成功，收到 ${response.data.length} 筆資料`);

            // 顯示日誌
            logger.show();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.logError(LogCategory.EXTENSION, error, 'API request failed');
            vscode.window.showErrorMessage(`API 請求失敗: ${errorMessage}`);
            logger.show();
        }
    });

    const showWebSocketStateCommand = vscode.commands.registerCommand('stockmon.showWebSocketState', () => {
        const wsStore = useWebSocketStore.getState();

        logger.log(LogCategory.WEBSOCKET, '=== WebSocket State ===');
        logger.log(LogCategory.WEBSOCKET, `Current state: ${wsStore.wsState}`);
        logger.log(LogCategory.WEBSOCKET, `Reconnect attempts: ${wsStore.reconnectAttempts}`);
        logger.log(LogCategory.WEBSOCKET, `Socket ready state: ${wsStore.socket?.readyState}`);
        logger.show();
    });

    context.subscriptions.push(showExtensionInfoCommand);
    context.subscriptions.push(checkSessionStoreCommand);
    context.subscriptions.push(testApiRequestCommand);
    context.subscriptions.push(showWebSocketStateCommand);
    
    logger.info(LogCategory.COMMAND, 'Debug commands registered successfully');
}