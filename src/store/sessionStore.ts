import { create } from 'zustand';
import { SessionInfo } from '../types';
import axios from 'axios';
import { urls } from '../config';
import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { useWebSocketStore } from './websocketStore';
import { isTokenExpired } from '../utilities/tokenUtils';
import { LoggerService, LogCategory } from '../utilities/loggerService';

interface SessionState {
  sessionInfo: SessionInfo | null;
  authToken: string | null;
  clientUuid: string;
  isAuthenticated: boolean;

  // Methods
  login: (username: string, password: string, context: vscode.ExtensionContext) => Promise<string>;
  logout: (context: vscode.ExtensionContext) => Promise<void>;
  initSession: (clientUuid: string, authToken: string | null) => Promise<SessionInfo>;
  setSessionInfo: (sessionInfo: SessionInfo | null, context: vscode.ExtensionContext) => Promise<void>;
  setAuthToken: (token: string | null, context: vscode.ExtensionContext) => Promise<void>;
  loadFromGlobalState: (context: vscode.ExtensionContext) => Promise<void>;
  getOrCreateUuid: (context: vscode.ExtensionContext) => string
  resetUuid: (context: vscode.ExtensionContext) => void
  showSessionInfoAndAuthToken: (loggerOrOutputChannel: LoggerService | vscode.OutputChannel) => void
  isValidSession: () => boolean;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessionInfo: null,
  authToken: null,
  clientUuid: '',
  isAuthenticated: false,

  login: async (username: string, password: string, context: vscode.ExtensionContext) => {
    const logger = LoggerService.getInstance();
    try {
        logger.log(LogCategory.SESSION, `Attempting login for user: ${username}`);
        
        const clientUuid = get().getOrCreateUuid(context);
        logger.log(LogCategory.SESSION, `Logging in with clientUuid: ${clientUuid}`);
        
        const response = await axios.post(urls.auth.login, {
            username,
            password
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Client-UUID': clientUuid
            }
        });

        if (response.data && response.data.access_token) {
            const token = response.data.access_token;
            logger.log(LogCategory.SESSION, 'Received access token from server');

            // 先設置 token
            await get().setAuthToken(token, context);
            logger.log(LogCategory.SESSION, 'Auth token saved');

            const sessionInfo: SessionInfo = {
                uuid: clientUuid,
                is_authenticated: true,
                channel_type: 'stock',
                user: username
            };

            // 設置 session info
            await get().setSessionInfo(sessionInfo, context);
            logger.log(LogCategory.SESSION, 'Session info saved');

            // 更新認證狀態
            set({ isAuthenticated: true });
            logger.log(LogCategory.SESSION, 'Authentication state updated');

            // 驗證所有狀態
            const currentState = get();
            logger.log(LogCategory.SESSION, '=== Verifying Login State ===');
            logger.log(LogCategory.SESSION, `Auth token in store: ${!!currentState.authToken}`);
            logger.log(LogCategory.SESSION, `Session info in store: ${JSON.stringify(currentState.sessionInfo)}`);
            logger.log(LogCategory.SESSION, `Is authenticated: ${currentState.isAuthenticated}`);

            // 驗證 global state
            const savedToken = context.globalState.get<string>('authToken');
            const savedSession = context.globalState.get<SessionInfo>('sessionInfo');
            logger.log(LogCategory.SESSION, `Auth token in global state: ${!!savedToken}`);
            logger.log(LogCategory.SESSION, `Session info in global state: ${JSON.stringify(savedSession)}`);

            logger.log(LogCategory.SESSION, `Login successful, token received`);
            return token;
        }
        throw new Error('Login failed: Invalid response format');
    } catch (error) {
        logger.logError(LogCategory.SESSION, error, 'Login failed');
        throw error;
    }
  },

  logout: async (context: vscode.ExtensionContext) => {
    const logger = LoggerService.getInstance();
    const { authToken } = get();
    if (authToken) {
      await axios.post(
        urls.auth.logout,
        {},
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Client-UUID': get().clientUuid
          }
        }
      );

      const sessionInfo: SessionInfo = {
        uuid: get().clientUuid,
        is_authenticated: false,
        channel_type: 'anonymous'
      };

      await get().setSessionInfo(sessionInfo, context);
      await get().setAuthToken(null, context);
      set({ isAuthenticated: false });
      logger.log(LogCategory.SESSION, 'Logout successful, session cleared');
    }
  },

  initSession: async (clientUuid: string, authToken: string | null) => {
    const logger = LoggerService.getInstance();
    try {
        logger.log(LogCategory.SESSION, `Initializing session with clientUuid: ${clientUuid}`);
        
        const response = await axios.post<SessionInfo>(urls.session, {
            uuid: clientUuid
        }, {
            headers: authToken ? {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            } : {
                'Content-Type': 'application/json'
            }
        });

        logger.log(LogCategory.SESSION, `Server response: ${JSON.stringify(response.data)}`);

        const sessionInfo: SessionInfo = {
            uuid: clientUuid,
            is_authenticated: response.data.is_authenticated,
            channel_type: response.data.channel_type,
            user: response.data.user
        };

        logger.log(LogCategory.SESSION, `Setting session info: ${JSON.stringify(sessionInfo)}`);

        // 保持現有的 authToken，只更新 session 信息
        set({ 
            sessionInfo, 
            isAuthenticated: response.data.is_authenticated,
            // 不要在這裡設置 authToken，因為它應該已經存在
        });

        logger.log(LogCategory.SESSION, `Session initialized successfully: ${JSON.stringify(sessionInfo)}`);
        return sessionInfo;
    } catch (error) {
        logger.logError(LogCategory.SESSION, error, 'Session initialization failed');
        throw error;
    }
  },

  setSessionInfo: async (sessionInfo: SessionInfo | null, context: vscode.ExtensionContext) => {
    const logger = LoggerService.getInstance();
    try {
        logger.log(LogCategory.SESSION, `Setting session info: ${JSON.stringify(sessionInfo)}`);
        
        // 先更新 global state
        await context.globalState.update('sessionInfo', sessionInfo);
        logger.log(LogCategory.SESSION, 'Session info updated in global state');
        
        // 然後更新 store state，同時更新 isAuthenticated 狀態
        set({ 
            sessionInfo,
            isAuthenticated: sessionInfo?.is_authenticated || false
        });
        logger.log(LogCategory.SESSION, `Session info updated in store state, isAuthenticated set to: ${sessionInfo?.is_authenticated || false}`);
        
        // 驗證是否正確設置認證狀態
        logger.log(LogCategory.SESSION, `=== AUTHENTICATION STATE CHECK ===`);
        logger.log(LogCategory.SESSION, `Session info: ${JSON.stringify(sessionInfo)}`);
        logger.log(LogCategory.SESSION, `is_authenticated in session: ${sessionInfo?.is_authenticated}`);
        
        // 獲取當前狀態，確認 isAuthenticated 設置正確
        const currentState = get();
        logger.log(LogCategory.SESSION, `Current isAuthenticated value: ${currentState.isAuthenticated}`);
        logger.log(LogCategory.SESSION, `Auth token present: ${!!currentState.authToken}`);
        
        // 檢查全局狀態是否一致
        const savedSession = await context.globalState.get<SessionInfo>('sessionInfo');
        const savedToken = await context.globalState.get<string>('authToken');
        logger.log(LogCategory.SESSION, `Global state - session.is_authenticated: ${savedSession?.is_authenticated}`);
        logger.log(LogCategory.SESSION, `Global state - token present: ${!!savedToken}`);
        logger.log(LogCategory.SESSION, `=== END AUTHENTICATION CHECK ===`);
        
        logger.log(LogCategory.SESSION, 'Session info updated successfully');
    } catch (error) {
        logger.logError(LogCategory.SESSION, error, 'Failed to set session info');
        throw error;
    }
  },

  setAuthToken: async (token: string | null, context: vscode.ExtensionContext) => {
    const logger = LoggerService.getInstance();
    try {
        logger.log(LogCategory.SESSION, `Setting auth token: ${token ? 'token present' : 'null'}`);
        
        // 同步更新 store 和 global state
        set({ authToken: token });
        await context.globalState.update('authToken', token);
        
        // 立即驗證
        const currentState = get();
        const savedToken = context.globalState.get<string | null>('authToken');
        
        logger.log(LogCategory.SESSION, `Store token: ${currentState.authToken ? 'present' : 'null'}`);
        logger.log(LogCategory.SESSION, `Saved token: ${savedToken ? 'present' : 'null'}`);
        
        if (token !== savedToken) {
            logger.log(LogCategory.SESSION, 'Warning: Token mismatch between store and global state');
        }
    } catch (error) {
        logger.logError(LogCategory.SESSION, error, 'Error setting auth token');
        throw error;
    }
  },

  loadFromGlobalState: async (context: vscode.ExtensionContext) => {
    const logger = LoggerService.getInstance();
    
    try {
        // 只讀取全局狀態
        const sessionInfo = context.globalState.get<SessionInfo | null>('sessionInfo', null);
        const authToken = context.globalState.get<string | null>('authToken', null);
        const clientUuid = context.globalState.get<string>('uuid', '');

        logger.log(LogCategory.SESSION, '=== Loading Global State ===');
        logger.log(LogCategory.SESSION, `Found sessionInfo: ${JSON.stringify(sessionInfo)}`);
        logger.log(LogCategory.SESSION, `Found authToken: ${authToken ? 'present' : 'null'}`);
        logger.log(LogCategory.SESSION, `Found clientUuid: ${clientUuid}`);

        // 檢查 token 是否有效
        let isAuthenticated = sessionInfo?.is_authenticated || false;
        
        if (authToken) {
            try {
                // 檢查 token 是否過期
                const tokenExpired = isTokenExpired(authToken);
                if (tokenExpired) {
                    logger.warning(LogCategory.SESSION, 'Auth token is expired, setting isAuthenticated to false');
                    isAuthenticated = false;
                } else {
                    logger.log(LogCategory.SESSION, 'Auth token is valid');
                }
            } catch (error) {
                logger.warning(LogCategory.SESSION, `Failed to check token expiration: ${error}, assuming token is invalid`);
                isAuthenticated = false;
            }
        } else {
            // 沒有 token，設置為未認證
            logger.warning(LogCategory.SESSION, 'No auth token found, setting isAuthenticated to false');
            isAuthenticated = false;
        }

        // 直接設置狀態
        set({
            sessionInfo,
            authToken,
            clientUuid,
            isAuthenticated
        });

        // 驗證設置後的狀態
        const currentState = get();
        logger.log(LogCategory.SESSION, '=== Current State After Loading ===');
        logger.log(LogCategory.SESSION, `Store sessionInfo: ${JSON.stringify(currentState.sessionInfo)}`);
        logger.log(LogCategory.SESSION, `Store authToken: ${currentState.authToken ? 'present' : 'null'}`);
        logger.log(LogCategory.SESSION, `Store clientUuid: ${currentState.clientUuid}`);
        logger.log(LogCategory.SESSION, `Store isAuthenticated: ${currentState.isAuthenticated}`);

    } catch (error) {
        logger.logError(LogCategory.SESSION, error, 'Failed to load from global state');
        throw error;
    }
  },
  getOrCreateUuid: (context: vscode.ExtensionContext) => {
    const state = get();
    if (state.clientUuid) {
        return state.clientUuid;
    }

    try {
        let uuid = context.globalState.get<string>('uuid');

        if (!uuid) {
            uuid = uuidv4();
            Promise.resolve(context.globalState.update('uuid', uuid));
            set({ clientUuid: uuid });
        } else {
            set({ clientUuid: uuid });
        }

        return uuid;
    } catch (error) {
        console.error('Error managing UUID:', error);
        const newUuid = uuidv4();
        set({ clientUuid: newUuid });
        Promise.resolve(context.globalState.update('uuid', newUuid)).catch((error: Error) => 
            console.error('Failed to save UUID to globalState:', error)
        );
        return newUuid;
    }
  },

  resetUuid: (context: vscode.ExtensionContext) => {
    try {
      const newUuid = uuidv4();
      context.globalState.update('uuid', newUuid);
      set({ clientUuid: newUuid });
      console.log('UUID reset to:', newUuid);
    } catch (error) {
      console.error('Error resetting UUID:', error);
    }
  },
  showSessionInfoAndAuthToken: (loggerOrOutputChannel: LoggerService | vscode.OutputChannel) => {
    // Handle both LoggerService and legacy OutputChannel
    let logger: LoggerService;
    if (loggerOrOutputChannel instanceof LoggerService) {
      logger = loggerOrOutputChannel;
    } else {
      // If it's an OutputChannel, we'll use our singleton logger instead
      logger = LoggerService.getInstance();
    }
    
    const { sessionInfo, authToken, clientUuid, isAuthenticated } = get();
    
    logger.log(LogCategory.SESSION, '=== Session Information ===');
    logger.log(LogCategory.SESSION, `Client UUID: ${clientUuid}`);
    logger.log(LogCategory.SESSION, `Auth Token: ${authToken ? 'present' : 'null'}`);
    logger.log(LogCategory.SESSION, `Is Authenticated: ${isAuthenticated}`);
    logger.log(LogCategory.SESSION, `Session Info: ${JSON.stringify(sessionInfo, null, 2)}`);
    
    // Show the logger output
    logger.show();
  },

  isValidSession: () => {
    const state = get();
    const logger = LoggerService.getInstance();
    
    // 檢查是否有必要的狀態
    if (!state.authToken || !state.sessionInfo) {
        logger.warning(LogCategory.SESSION, 'Session invalid: Missing token or session info');
        return false;
    }

    // 檢查 token 是否過期
    try {
        if (isTokenExpired(state.authToken)) {
            logger.warning(LogCategory.SESSION, 'Session invalid: Token expired');
            return false;
        }
    } catch (error) {
        logger.logError(LogCategory.SESSION, error, 'Session invalid: Token validation error');
        return false;
    }

    // 檢查 session 狀態
    if (!state.sessionInfo.is_authenticated) {
        logger.warning(LogCategory.SESSION, 'Session invalid: Not authenticated');
        return false;
    }

    logger.debug(LogCategory.SESSION, 'Session is valid');
    return true;
  },

})); 