import * as vscode from 'vscode';

interface Environment {
    API_BASE_URL: string;
    WS_HOST: string;
    WS_PORT: number;
    WS_PATH: string;
    WS_PROTOCOL: string;
}

// 從設定中獲取代理伺服器配置
function getProxyConfig(): Environment {
    const config = vscode.workspace.getConfiguration('stockmon');
    
    // 直接從設定中獲取各個代理設定項
    const apiBaseUrl = config.get<string>('proxyApiBaseUrl') || 'http://127.0.0.1/api';
    const wsHost = config.get<string>('proxyWsHost') || '127.0.0.1';
    const wsPort = config.get<number>('proxyWsPort') || 80;
    const wsProtocol = wsPort === 443 ? 'wss' : 'ws';

    console.log('Proxy config loaded:', { apiBaseUrl, wsHost, wsPort, wsProtocol });

    return {
        API_BASE_URL: apiBaseUrl,
        WS_HOST: wsHost,
        WS_PORT: wsPort,
        WS_PATH: '/ws/stock/',
        WS_PROTOCOL: wsProtocol
    };
}

// 生產環境配置
const productionConfig: Environment = {
    API_BASE_URL: 'https://srv.stockmon.info/api',
    WS_HOST: 'srv.stockmon.info',
    WS_PORT: 443,
    WS_PATH: '/ws/stock/',
    WS_PROTOCOL: 'wss'
};

// 獲取當前配置
function getCurrentConfig(): Environment {
    const config = vscode.workspace.getConfiguration('stockmon');
    const useProxy = config.get<boolean>('useProxy') || false;
    
    console.log('Current configuration - useProxy:', useProxy);
    
    if (useProxy) {
        return getProxyConfig();
    } else {
        return productionConfig;
    }
}

// 獲取當前配置
const currentConfig = getCurrentConfig();

// 在控制台輸出當前配置，用於調試
console.log('Current config:', currentConfig);

export const config = {
    ...currentConfig,
    // 其他通用配置
    WS_CONFIG: {
        reconnectInterval: 3000,
        maxReconnectAttempts: 8,
        heartbeatInterval: 30000
    }
};

// 重命名為 extensionConfig.ts，包含 VSCode 相關配置
export const urls = {
    auth: {
        login: `${config.API_BASE_URL}/auth/login/`,
        logout: `${config.API_BASE_URL}/auth/logout`,
        extensionLogin: `${config.API_BASE_URL.replace('/api', '')}/login/`,
        checkCallback: (extensionId: string) => `${config.API_BASE_URL}/auth/extension/check-callback?extension_id=${extensionId}`
    },
    session: `${config.API_BASE_URL}/session/`,
    stocks: {
        list: `${config.API_BASE_URL}/user/stocks`,
        search: `${config.API_BASE_URL}/stocks/search`,
        create: `${config.API_BASE_URL}/user/stocks`,
        update: (symbol: string) => `${config.API_BASE_URL}/user/stocks/symbol/${symbol}`,
        delete: (symbol: string) => `${config.API_BASE_URL}/user/stocks/symbol/${symbol}`,
        detail: (symbol: string) => `${config.API_BASE_URL}/stocks/${symbol}`,
        batch: `${config.API_BASE_URL}/user/batch-upload`,
        synchronize: `${config.API_BASE_URL}/sync/synchronize`,
        syncStatus: `${config.API_BASE_URL}/sync/status`,
        conflicts: `${config.API_BASE_URL}/sync/conflicts`,
        resolveConflict: `${config.API_BASE_URL}/sync/resolve-conflict`,
        candles5m: (symbol: string) => `${config.API_BASE_URL}/stocks/${symbol}/candles/5m`,
        multiCandles5m: `${config.API_BASE_URL}/stocks/candles/multi/5m/async`
    },
    alerts: {
        list: `${config.API_BASE_URL}/user/alerts`,
        create: `${config.API_BASE_URL}/user/alerts`,
        delete: (id: number) => `${config.API_BASE_URL}/user/alerts/${id}`
    },
    feedback: {
        submit: `${config.API_BASE_URL}/feedback/submit/`,
        types: `${config.API_BASE_URL}/feedback/types/`
    }
};

// 更新代理設定功能
export async function setUseProxy(useProxy: boolean): Promise<void> {
    console.log(`Setting useProxy to: ${useProxy}`);
    
    // 更新設定
    await vscode.workspace.getConfiguration('stockmon').update('useProxy', useProxy, true);
    
    // 重新載入配置
    const newConfig = useProxy ? getProxyConfig() : productionConfig;
    console.log('Loaded new configuration:', newConfig);
    
    // 確保所有必要的屬性都存在
    if (!newConfig.API_BASE_URL || !newConfig.WS_HOST || !newConfig.WS_PORT || !newConfig.WS_PROTOCOL) {
        console.error('Invalid configuration detected:', newConfig);
        vscode.window.showErrorMessage(`Invalid configuration. Please check your settings.`);
    }
    
    // 更新全局配置
    Object.assign(config, {
        ...newConfig,
        WS_CONFIG: config.WS_CONFIG
    });
    
    console.log('Updated global configuration:', config);
} 