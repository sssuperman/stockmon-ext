import * as vscode from 'vscode';

interface Environment {
    API_BASE_URL: string;
    WS_HOST: string;
    WS_PORT: number;
    WS_PATH: string;
    WS_PROTOCOL: string;
}

// 從設定中獲取開發環境配置
function getDevelopmentConfig(): Environment {
    const config = vscode.workspace.getConfiguration('stockmon');
    const devConfig = config.get('developmentConfig') as {
        apiBaseUrl: string;
        wsHost: string;
        wsPort: number;
    };

    return {
        API_BASE_URL: devConfig.apiBaseUrl,
        WS_HOST: devConfig.wsHost,
        WS_PORT: devConfig.wsPort,
        WS_PATH: '/ws/stock/',
        WS_PROTOCOL: 'ws'
    };
}

const environments: { [key: string]: Environment | (() => Environment) } = {
    development: getDevelopmentConfig,
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
    'production') as keyof typeof environments;

// 獲取當前環境的配置
const currentConfig = typeof environments[currentEnv] === 'function'
    ? (environments[currentEnv] as () => Environment)()
    : environments[currentEnv] as Environment;

// 在控制台輸出當前環境，用於調試
console.log('Current environment:', currentEnv);
console.log('Environment config:', currentConfig);

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
    const newConfig = typeof environments[env] === 'function'
        ? (environments[env] as () => Environment)()
        : environments[env] as Environment;
    Object.assign(config, {
        ...newConfig,
        WS_CONFIG: config.WS_CONFIG
    });
} 