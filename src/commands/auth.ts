import * as vscode from 'vscode';
import axios from 'axios';
// import { ExtensionContextManager } from '../utilities/contextManager';
import { LoggerService, LogCategory } from '../utilities/loggerService';
import { useSessionStore } from '../store/sessionStore';
import { startAutoSync, stopAutoSync, syncUserStocksFromServer, uploadLocalStocksToServer } from '../store/stockDataActionUserSync';
import { handleAuthCallback } from '../uriHandler';
import { urls } from '../config'; // Assuming urls are needed  // Assuming WebSocketState is needed
import { LanguageManager } from '../i18n/languageManager';

const logger = LoggerService.getInstance();
// const context = ExtensionContextManager.getContext();
const languageManager = LanguageManager.getInstance();
const messages = languageManager.getMessage();

export function registerAuthCommands(context: vscode.ExtensionContext, logger: LoggerService) {
    logger.info(LogCategory.COMMAND, 'Registering auth commands');
    
    // Helper function for external login (moved from extension.ts)
    async function useExternalLogin() {
        try {
            // 生成一個隨機的extension_id
            const extensionId = `vscode-stockmon-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

            // 獲取正確的 URI 方案和擴展 ID
            const uriScheme = vscode.env.uriScheme; // 通常是 'vscode'
            const appExtensionId = context.extension.id; // 使用完整的擴展 ID

            // 設置回調URL
            const callbackUri = vscode.Uri.parse(`${uriScheme}://${appExtensionId}/auth/callback`);

            // 將 URI 轉換為外部 URI
            const externalCallbackUri = await vscode.env.asExternalUri(callbackUri);
            const callbackUrl = externalCallbackUri.toString();

            // 構建登入URL
            const loginUrlParams = new URLSearchParams();
            loginUrlParams.append('from_extension', 'true');
            loginUrlParams.append('extension_id', extensionId);
            loginUrlParams.append('callback_url', callbackUrl);

            const loginUrl = `${urls.auth.extensionLogin}?${loginUrlParams.toString()}`;

            logger.info(LogCategory.AUTH, `Opening external login URL: ${loginUrl}`);
            logger.info(LogCategory.AUTH, `Callback URL: ${callbackUrl}`);
            logger.info(LogCategory.AUTH, `External Callback URI: ${externalCallbackUri.toString()}`);

            // 打開外部瀏覽器
            await vscode.env.openExternal(vscode.Uri.parse(loginUrl));

            // 啟動輪詢，作為備用方案
            startPollingForLogin(extensionId); // Pass logger
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.logError(LogCategory.AUTH, error, 'External login error');
            vscode.window.showErrorMessage(`外部登入失敗: ${errorMessage}`);
        }
    }

    // 輪詢登入狀態的函數
    async function startPollingForLogin(extensionId: string) {
        logger.info(LogCategory.EXTENSION, `Starting polling for login with extension ID: ${extensionId}`);
        
        // 檢查是否已經登入
        if (useSessionStore.getState().isAuthenticated) {
            logger.info(LogCategory.EXTENSION, 'User is already authenticated, skipping polling');
            return;
        }
        
        // 顯示進度條
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '等待登入完成...',
            cancellable: true
        }, async (progress, token) => {
            // 設置超時時間
            const timeout = 5 * 60 * 1000; // 5分鐘
            const startTime = Date.now();
            
            // 輪詢間隔
            const pollInterval = 2000; // 2秒
            
            return new Promise<void>((resolve, reject) => {
                // 設置輪詢定時器
                const interval = setInterval(async () => {
                    // 檢查是否已經登入
                    if (useSessionStore.getState().isAuthenticated) {
                        clearInterval(interval);
                        logger.info(LogCategory.EXTENSION, 'User is already authenticated via another method, stopping polling');
                        resolve();
                        return;
                    }
                    
                    // 檢查是否取消
                    if (token.isCancellationRequested) {
                        clearInterval(interval);
                        logger.info(LogCategory.EXTENSION, 'Login polling cancelled by user');
                        reject(new Error('登入已取消'));
                        return;
                    }
                    
                    // 檢查是否超時
                    if (Date.now() - startTime > timeout) {
                        clearInterval(interval);
                        logger.warning(LogCategory.EXTENSION, 'Login polling timed out');
                        reject(new Error('登入超時'));
                        return;
                    }
                    
                    try {
                        // 檢查登入狀態
                        logger.debug(LogCategory.EXTENSION, `Polling login status for extension ID: ${extensionId}`);
                        
                        // 發送請求到後端檢查登入狀態
                        const response = await axios.get(urls.auth.checkCallback(extensionId));
                        
                        // 檢查是否收到回調
                        if (response.data && response.data.received) {
                            clearInterval(interval);
                            logger.info(LogCategory.EXTENSION, 'Login callback received via polling');
                            
                            // 獲取token和用戶信息
                            const token = response.data.token;
                            const userInfo = response.data.user_info;
                            
                            if (token) {
                                // 處理token
                                await handleAuthCallback(token, userInfo ? JSON.stringify(userInfo) : null, context);
                                resolve();
                            } else {
                                logger.warning(LogCategory.EXTENSION, 'Login callback received but no token found');
                                reject(new Error('登入回調缺少必要的token'));
                            }
                            return;
                        }
                    } catch (error) {
                        // 忽略輪詢錯誤，繼續輪詢
                        logger.debug(LogCategory.EXTENSION, `Login polling error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                    
                    // 更新進度
                    progress.report({ message: '等待登入完成...' });
                }, pollInterval);
                
                // 添加清理函數，確保在 Promise 被解決或拒絕後清除定時器
                return () => {
                    clearInterval(interval);
                };
            }).catch(error => {
                logger.warning(LogCategory.EXTENSION, `Login polling failed: ${error.message}`);
                vscode.window.showWarningMessage(`登入等待失敗: ${error.message}`);
            });
        });
    }

    let logoutCommand = vscode.commands.registerCommand('stockmon.logout', async () => {
        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: messages.auth.loggingOut,
                cancellable: false
            }, async (progress) => {
                try {
                    // 先停止同步
                    logger.info(LogCategory.EXTENSION, 'Stopping sync before logout');
                    stopAutoSync();
                    
                    // 然後登出
                    await useSessionStore.getState().logout(context);
                    vscode.window.showInformationMessage(messages.auth.logoutSuccess);
                } catch (error) {
                    logger.logError(LogCategory.EXTENSION, error, 'Logout failed');
                    vscode.window.showErrorMessage(messages.auth.logoutFailed);
                    throw error;
                }
            });
        } catch (error) {
            logger.logError(LogCategory.EXTENSION, error, 'Logout command error');
        }
    });

    let loginCommand = vscode.commands.registerCommand('stockmon.login', async () => {
        try {
            // 詢問用戶是否使用外部登入頁面
            const loginMethod = await vscode.window.showQuickPick(
                [
                    { label: '$(globe) 使用網頁登入', description: '在瀏覽器中打開登入頁面', id: 'web' },
                    { label: '$(person) 直接輸入帳號密碼', description: '在VSCode中輸入帳號密碼', id: 'direct' }
                ],
                { placeHolder: '選擇登入方式' }
            );

            if (!loginMethod) {
                return;
            }

            if (loginMethod.id === 'web') {
                // 使用外部登入頁面
                await useExternalLogin();
            } else {
                // 使用直接輸入帳號密碼的方式
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

                // 顯示登入中的進度條
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: messages.auth.loggingIn,
                    cancellable: false
                }, async (progress) => {
                    try {
                        // 執行登入
                        const response = await axios.post(urls.auth.login, {
                            username,
                            password
                        });

                        if (response.data && response.data.token) {
                            const token = response.data.token;
                            const userInfo = response.data.user;

                            // 處理登入成功
                            await useSessionStore.getState().setAuthToken(token, context);

                            // 更新會話信息
                            const clientUuid = useSessionStore.getState().clientUuid || useSessionStore.getState().getOrCreateUuid(context);
                            const sessionInfo = {
                                uuid: clientUuid,
                                is_authenticated: true,
                                channel_type: 'stock',
                                user: userInfo?.username || username
                            };
                            await useSessionStore.getState().setSessionInfo(sessionInfo, context);

                            vscode.window.showInformationMessage(messages.auth.loginSuccess);

                            // 開始自動同步
                            startAutoSync();

                            // 上傳本地股票資料到雲端
                            try {
                                await uploadLocalStocksToServer();
                            } catch (error) {
                                logger.logError(LogCategory.SYNC, error, '上傳本地股票資料失敗');
                                // 不中斷登入流程，僅記錄錯誤
                            }

                            // 同步服務器上的股票
                            await syncUserStocksFromServer();
                        } else {
                            throw new Error(messages.auth.loginFailed);
                        }
                    } catch (error: any) {
                        let errorMessage = messages.auth.loginFailed;
                        // 檢查是否是認證錯誤
                        if (error.response && error.response.status === 401) {
                            errorMessage = messages.auth.loginFailed;
                        } else if (error.message) {
                            errorMessage = `${messages.auth.loginFailed}: ${error.message}`;
                        }
                        logger.logError(LogCategory.AUTH, error, 'Login error');
                        vscode.window.showErrorMessage(errorMessage);
                        throw error;
                    }
                });
            }
        } catch (error) {
            logger.logError(LogCategory.AUTH, error, 'Login command error');
        }
    });

    let showSessionInfoCommand = vscode.commands.registerCommand('stockmon.showSessionInfo', () => {
        const sessionState = useSessionStore.getState();
        const isAuthenticated = sessionState.isAuthenticated;
        const username = sessionState.sessionInfo?.user || 'Guest';
        const uuid = sessionState.sessionInfo?.uuid || sessionState.clientUuid || 'Unknown';

        // 確保logger已初始化
        if (logger) {
            logger.log(LogCategory.EXTENSION, `Session Info - isAuthenticated: ${isAuthenticated}, username: ${username}, uuid: ${uuid}`);
            logger.log(LogCategory.EXTENSION, `Session token: ${sessionState.authToken ? '(token exists)' : '(no token)'}`);
            logger.log(LogCategory.EXTENSION, `Full session info: ${JSON.stringify(sessionState.sessionInfo, null, 2)}`);
        }

        vscode.window.showInformationMessage(
            `Session Info: ${isAuthenticated ? 'Authenticated' : 'Not Authenticated'}, User: ${username}, UUID: ${uuid}`
        );
    });

    // 添加命令到訂閱中
    context.subscriptions.push(logoutCommand);
    context.subscriptions.push(loginCommand);
    context.subscriptions.push(showSessionInfoCommand);

    logger.info(LogCategory.COMMAND, 'Auth commands registered successfully');
}