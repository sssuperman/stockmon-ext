import * as vscode from 'vscode';
import { LoggerService, LogCategory } from './utilities/loggerService';
import { useSessionStore } from './store/sessionStore';
import { useWebSocketStore } from './store/websocketStore';
import { WebSocketState } from './types';
import { startAutoSync, uploadLocalStocksToServer } from './store/stockDataActionUserSync';
import { StatusBarManager } from './statusBar';
// import { ExtensionContextManager } from './utilities/contextManager';
const logger = LoggerService.getInstance();
// const context = ExtensionContextManager.getContext();

export class StockmonUriHandler implements vscode.UriHandler {
    private context!: vscode.ExtensionContext;
    
    constructor(private readonly logger: LoggerService) {
        // 由於此類在extension.ts中初始化，所以不需要使用ExtensionContextManager
    }
    
    setContext(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async handleUri(uri: vscode.Uri): Promise<void> {
        console.log('URI handler triggered:', uri.toString());
        this.logger.info(LogCategory.EXTENSION, `URI handler triggered with: ${uri.toString()}`);
        this.logger.info(LogCategory.EXTENSION, `URI components - scheme: ${uri.scheme}, authority: ${uri.authority}, path: ${uri.path}, query: ${uri.query}`);
        // 處理 URI
        await processUri(uri, this.context);
    }
}

export async function processUri(uri: vscode.Uri, context?: vscode.ExtensionContext): Promise<void> {
    try {
        console.log('Processing URI:', uri.toString());
        logger.info(LogCategory.EXTENSION, `Processing URI: ${uri.toString()}`);
        logger.info(LogCategory.EXTENSION, `URI details - scheme: ${uri.scheme}, authority: ${uri.authority}, path: ${uri.path}, query: ${uri.query}`);
        
        
        // 檢查URI是否是我們期望的格式 - 放寬條件
        if (uri.scheme === vscode.env.uriScheme) {
            logger.info(LogCategory.EXTENSION, 'URI scheme is valid');
            
            // 解析查詢參數
            const queryString = uri.query;
            logger.info(LogCategory.EXTENSION, `Query string: ${queryString}`);
            
            if (!queryString) {
                logger.warning(LogCategory.EXTENSION, 'URI has no query string');
                vscode.window.showWarningMessage('URI 缺少查詢參數');
                return;
            }
            
            const queryParams = new URLSearchParams(queryString);
            const token = queryParams.get('token');
            const userInfoStr = queryParams.get('user');
            
            logger.info(LogCategory.EXTENSION, `Parsed params - token exists: ${!!token}, userInfo exists: ${!!userInfoStr}`);
            
            if (token) {
                logger.info(LogCategory.EXTENSION, 'Token found in URI, processing auth callback');
                
                // 處理token
                await handleAuthCallback(token, userInfoStr, context);
            } else {
                logger.warning(LogCategory.EXTENSION, 'Auth callback URI has no token');
                vscode.window.showWarningMessage('登入回調缺少必要的 token');
            }
        } else {
            logger.warning(LogCategory.EXTENSION, `Invalid URI scheme: ${uri.scheme}, expected: ${vscode.env.uriScheme}`);
            vscode.window.showWarningMessage(`無效的 URI 格式: ${uri.toString()}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.logError(LogCategory.EXTENSION, error, 'Error processing URI');
        vscode.window.showErrorMessage(`處理 URI 時發生錯誤: ${errorMessage}`);
    }
}

export async function handleAuthCallback(token: string, userInfoStr: string | null, context?: vscode.ExtensionContext) {
    try {
        logger.log(LogCategory.AUTH, 'Handling auth callback');
        
        if (!context) {
            logger.warning(LogCategory.AUTH, 'Extension context not available for auth callback');
            vscode.window.showErrorMessage('無法處理登入，擴展上下文不可用');
            return;
        }

        // 解析用戶信息
        let userInfo = null;
        if (userInfoStr) {
            try {
                userInfo = JSON.parse(userInfoStr);
            } catch (e) {
                logger.logError(LogCategory.AUTH, e, 'Failed to parse user info');
            }
        }

        // 設置認證狀態
        await useSessionStore.getState().setAuthToken(token, context);

        // 更新會話信息，設置認證狀態為true
        const clientUuid = useSessionStore.getState().clientUuid || useSessionStore.getState().getOrCreateUuid(context);
        const sessionInfo = {
            uuid: clientUuid,
            is_authenticated: true,
            channel_type: 'stock',
            user: userInfo?.username || 'user'
        };
        await useSessionStore.getState().setSessionInfo(sessionInfo, context);

        // 檢查認證狀態
        logger.log(LogCategory.AUTH, `Authentication status after callback: ${useSessionStore.getState().isAuthenticated}`);

        // 更新狀態欄
        StatusBarManager.getInstance().update();

        // 顯示成功訊息
        vscode.window.showInformationMessage('登入成功！');

        // 開始自動同步
        startAutoSync();

        // 上傳本地股票資料到雲端
        try {
            await uploadLocalStocksToServer();
        } catch (error) {
            logger.logError(LogCategory.SYNC, error, '上傳本地股票資料失敗');
            // 不中斷登入流程，僅記錄錯誤
        }

        // 顯示當前狀態
        useSessionStore.getState().showSessionInfoAndAuthToken(logger);

        // 重新連接WebSocket，使用新的認證狀態
        logger.log(LogCategory.WEBSOCKET, 'Reconnecting WebSocket with new authentication state');
        const wsStore = useWebSocketStore.getState();
        if (wsStore.wsState !== WebSocketState.CONNECTING) {
            wsStore.disconnect();
            setTimeout(() => {
                wsStore.connect(logger);
            }, 500);
        }

    } catch (error) {
        logger.logError(LogCategory.AUTH, error, 'Failed to handle auth callback');
        vscode.window.showErrorMessage('登入處理失敗，請重試');
    }
}