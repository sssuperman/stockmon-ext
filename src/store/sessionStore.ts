import { create } from 'zustand';
import { SessionInfo } from '../types';
import axios from 'axios';
import { urls } from '../config';
import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

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
  loadFromGlobalState: (context: vscode.ExtensionContext) => void;
  getOrCreateUuid: (context: vscode.ExtensionContext) => string
  resetUuid: (context: vscode.ExtensionContext) => void
  showSessionInfoAndAuthToken: (outputChannel: vscode.OutputChannel) => void
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessionInfo: null,
  authToken: null,
  clientUuid: '',
  isAuthenticated: false,

  login: async (username: string, password: string, context: vscode.ExtensionContext) => {
    const clientUuid = get().getOrCreateUuid(context);
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
      get().setAuthToken(token, context);

      const sessionInfo: SessionInfo = {
        uuid: clientUuid,
        is_authenticated: true,
        channel_type: 'stock',
        user: username
      };
      get().setSessionInfo(sessionInfo, context);

      set({ isAuthenticated: true });
      return token;
    }
    throw new Error('Login failed: Invalid response format');
  },

  logout: async (context: vscode.ExtensionContext) => {
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
    }
  },

  initSession: async (clientUuid: string, authToken: string | null) => {
    const response = await axios.post<SessionInfo>(urls.session, {
      uuid: clientUuid
    }, {
      headers: authToken ? {
        'Authorization': `Bearer ${authToken}`
      } : undefined
    });

    const sessionInfo: SessionInfo = {
      uuid: clientUuid,
      is_authenticated: response.data.is_authenticated,
      channel_type: response.data.channel_type
    };

    set({ sessionInfo, isAuthenticated: response.data.is_authenticated });
    return sessionInfo;
  },

  setSessionInfo: async (sessionInfo: SessionInfo | null, context: vscode.ExtensionContext) => {
    set({ sessionInfo });
    await context.globalState.update('sessionInfo', sessionInfo);
  },

  setAuthToken: async (token: string | null, context: vscode.ExtensionContext) => {
    set({ authToken: token });
    await context.globalState.update('authToken', token);
  },

  loadFromGlobalState: (context: vscode.ExtensionContext) => {
    const sessionInfo = context.globalState.get<SessionInfo | null>('sessionInfo', null);
    const authToken = context.globalState.get<string | null>('authToken', null);
    const clientUuid = context.globalState.get<string>('uuid', '');

    set({
      sessionInfo,
      authToken,
      clientUuid,
      isAuthenticated: sessionInfo?.is_authenticated || false
    });
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
  showSessionInfoAndAuthToken: (outputChannel: vscode.OutputChannel) => {
    const { sessionInfo } = get();
    outputChannel.appendLine(`Session Info: ${JSON.stringify(sessionInfo)}`);
    const { authToken } = get();
    outputChannel.appendLine(`Auth Token: ${authToken}`);
  },

})); 