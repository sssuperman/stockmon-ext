import * as vscode from 'vscode';

interface Environment {
    API_BASE_URL: string;
    WS_HOST: string;
    WS_PORT: number;
    WS_PATH: string;
    WS_PROTOCOL: string;
}

const environments: { [key: string]: Environment } = {
    development: {
        API_BASE_URL: 'http://localhost:8000/api',
        WS_HOST: 'localhost',
        WS_PORT: 8000,
        WS_PATH: '/ws/stock/',
        WS_PROTOCOL: 'ws'
    },
    sandbox: {
        API_BASE_URL: 'http://localhost:8000/api',
        WS_HOST: 'localhost',
        WS_PORT: 8000,
        WS_PATH: '/ws/stock/',
        WS_PROTOCOL: 'ws'
    },
    production: {
        API_BASE_URL: 'https://srv.stockmon.info/api',
        WS_HOST: 'srv.stockmon.info',
        WS_PORT: 443,
        WS_PATH: '/ws/stock/',
        WS_PROTOCOL: 'wss'
    }
};

// 從環境變數或 VS Code 設置中獲取當前環境
const currentEnv = (process.env.STOCKMON_ENV || 
    vscode.workspace.getConfiguration('stockmon').get('environment') || 
    'development') as keyof typeof environments;

// 在控制台輸出當前環境，用於調試
console.log('Current environment:', currentEnv);
console.log('Environment config:', environments[currentEnv]);

export const config = {
    ...environments[currentEnv],
    // 其他通用配置
    WS_CONFIG: {
        reconnectInterval: 3000,
        maxReconnectAttempts: 8,
        heartbeatInterval: 30000
    }
};

// 方便的 URL 生成器
export const urls = {
    auth: {
        login: `${config.API_BASE_URL}/auth/login`,
        logout: `${config.API_BASE_URL}/auth/logout`
    },
    session: `${config.API_BASE_URL}/session`,
    stocks: {
        list: `${config.API_BASE_URL}/user/stocks`,
        search: `${config.API_BASE_URL}/stocks/search`,
        create: `${config.API_BASE_URL}/user/stocks`,
        update: (symbol: string) => `${config.API_BASE_URL}/user/stocks/symbol/${symbol}`,
        delete: (symbol: string) => `${config.API_BASE_URL}/user/stocks/symbol/${symbol}`
    },
    alerts: {
        list: `${config.API_BASE_URL}/user/alerts`,
        create: `${config.API_BASE_URL}/user/alerts`,
        delete: (id: number) => `${config.API_BASE_URL}/user/alerts/${id}`
    }
};

// 更新環境切換功能以支援 sandbox
export async function switchEnvironment(env: 'development' | 'sandbox' | 'production'): Promise<void> {
    await vscode.workspace.getConfiguration('stockmon').update('environment', env, true);
    // 重新載入配置
    Object.assign(config, {
        ...environments[env],
        WS_CONFIG: config.WS_CONFIG
    });
} 