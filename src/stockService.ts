import axios from 'axios';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { SessionInfo, WebSocketAuthMessage, StockCostData, PriceAlert, StockSearchResult } from './types';
import { v4 as uuidv4 } from 'uuid';
import { StateManager } from './stateManager';
import { LanguageManager } from './i18n/languageManager';
import { StockPanel } from './stockPanel';

// 添加 WebSocket 連接狀態枚舉
export enum WebSocketState {
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    RECONNECTING = 'RECONNECTING',
    CLOSING = 'CLOSING',
    CLOSED = 'CLOSED'
}

// 添加 WebSocket 配置接口
interface WebSocketConfig {
    host: string;
    port: number;
    reconnectInterval: number;
    maxReconnectAttempts: number;
    heartbeatInterval: number;
    path?: string;
}

// WebSocket implementation for VSCode extension
class ExtensionWebSocket {
    private static instance: ExtensionWebSocket | null = null;
    private socket: WebSocket | null = null;
    private onOpenHandlers: (() => void)[] = [];
    private onMessageHandlers: ((data: WebSocket.Data) => void)[] = [];
    private onErrorHandlers: ((error: Error) => void)[] = [];
    private onCloseHandlers: ((code: number, reason: string) => void)[] = [];
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private reconnectAttempts: number = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private config: WebSocketConfig;
    private _state: WebSocketState = WebSocketState.CLOSED;
    private onStateChangeHandlers: ((state: WebSocketState) => void)[] = [];
    private outputChannel: vscode.OutputChannel;
    
    public readyState: number = 0;
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    private constructor(config: WebSocketConfig, outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Constructor called`);
        this.config = config;
    }

    public static getInstance(config: WebSocketConfig, outputChannel: vscode.OutputChannel): ExtensionWebSocket {
        if (!ExtensionWebSocket.instance) {
            outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Creating new instance`);
            ExtensionWebSocket.instance = new ExtensionWebSocket(config, outputChannel);
        } else {
            outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Returning existing instance`);
            // 更新現有實例的配置，但保留事件處理器
            ExtensionWebSocket.instance.config = config;
            ExtensionWebSocket.instance.outputChannel = outputChannel;
        }
        return ExtensionWebSocket.instance;
    }

    public static resetInstance(): void {
        if (ExtensionWebSocket.instance) {
            ExtensionWebSocket.instance.close();
            ExtensionWebSocket.instance = null;
        }
    }

    private clearAllHandlers(): void {
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Clearing all handlers`);
        this.onOpenHandlers = [];
        this.onMessageHandlers = [];
        this.onErrorHandlers = [];
        this.onCloseHandlers = [];
        this.onStateChangeHandlers = [];
    }

    get state(): WebSocketState {
        return this._state;
    }

    private setState(newState: WebSocketState): void {
        if (this._state !== newState) {
            this._state = newState;
            this.onStateChangeHandlers.forEach(handler => handler(newState));
        }
    }

    public onStateChange(handler: (state: WebSocketState) => void): void {
        this.onStateChangeHandlers.push(handler);
    }

    private getReconnectDelay(): number {
        if (this.reconnectAttempts < 3) {
            return 3000; // 前三次每3秒
        } else {
            // 從第四次開始，每次加倍
            return 3000 * Math.pow(2, this.reconnectAttempts - 2);
        }
    }

    private handleConnectionError() {
        const maxAttempts = 8; // 總共嘗試8次 (3次快速重試 + 5次延遲重試)
        
        if (this.reconnectAttempts < maxAttempts) {
            this.setState(WebSocketState.RECONNECTING);
            this.reconnectAttempts++;
            
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
            }

            const delay = this.getReconnectDelay();
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Reconnect attempt ${this.reconnectAttempts} with delay ${delay}ms`);
            
            this.reconnectTimer = setTimeout(() => {
                this.connect();
            }, delay);
        } else {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Max reconnection attempts reached`);
            this.setState(WebSocketState.CLOSED);
        }
    }

    private handleConnectionStateChange(newState: WebSocketState): void {
        this.setState(newState);
        this.readyState = this.getReadyStateFromState(newState);
        
        switch (newState) {
            case WebSocketState.CONNECTED:
                this.reconnectAttempts = 0;
                this.startHeartbeat();
                this.onOpenHandlers.forEach(handler => handler());
                break;
            case WebSocketState.CLOSED:
            case WebSocketState.CLOSING:
                this.stopHeartbeat();
                break;
        }
    }

    private getReadyStateFromState(state: WebSocketState): number {
        switch (state) {
            case WebSocketState.CONNECTING:
            case WebSocketState.RECONNECTING:
                return ExtensionWebSocket.CONNECTING;
            case WebSocketState.CONNECTED:
                return ExtensionWebSocket.OPEN;
            case WebSocketState.CLOSING:
                return ExtensionWebSocket.CLOSING;
            case WebSocketState.CLOSED:
                return ExtensionWebSocket.CLOSED;
            default:
                return ExtensionWebSocket.CLOSED;
        }
    }

    public connect(): void {
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Connect called`);
        
        if (this.socket) {
            this.close();
        }

        try {
            this.handleConnectionStateChange(WebSocketState.CONNECTING);

            const wsUrl = `wss://${this.config.host}:${this.config.port}${this.config.path}`;
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Connecting to ${wsUrl}`);
            
            this.socket = new WebSocket(wsUrl, {
                perMessageDeflate: false
            });

            this.socket.on('open', () => {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Connection opened`);
                this.handleConnectionStateChange(WebSocketState.CONNECTED);
            });

            this.socket.on('message', (data: WebSocket.Data) => {
                this.onMessageHandlers.forEach(handler => handler(data));
            });

            this.socket.on('error', (error: Error) => {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Connection error: ${error.message}`);
                this.onErrorHandlers.forEach(handler => handler(error));
                this.handleConnectionError();
            });

            this.socket.on('close', (code: number, reason: string) => {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Connection closed: ${code} - ${reason}`);
                this.handleConnectionStateChange(WebSocketState.CLOSED);
                this.onCloseHandlers.forEach(handler => handler(code, reason));
                this.handleConnectionError();
            });

        } catch (error) {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Connection error: ${error}`);
            this.handleConnectionError();
        }
    }

    private startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.heartbeatInterval = setInterval(() => {
            if (this.readyState === ExtensionWebSocket.OPEN) {
                try {
                    this.send(JSON.stringify({
                        action: 'ping'
                    }));
                } catch (error) {
                    this.handleConnectionError();
                }
            }
        }, this.config.heartbeatInterval);
    }

    private stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    public on(event: 'open' | 'message' | 'error' | 'close', handler: any): void {
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Registering handler for event: ${event}`);
        switch (event) {
            case 'open':
                this.onOpenHandlers.push(handler);
                if (this.readyState === ExtensionWebSocket.OPEN) {
                    handler();
                }
                break;
            case 'message':
                this.onMessageHandlers.push(handler);
                break;
            case 'error':
                this.onErrorHandlers.push(handler);
                break;
            case 'close':
                this.onCloseHandlers.push(handler);
                break;
        }
    }

    public send(data: string): void {
        if (this.readyState !== ExtensionWebSocket.OPEN) {
            throw new Error('WebSocket is not open');
        }
        if (this.socket) {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] [ExtensionWebSocket] Sending message: ${data}`);
            this.socket.send(data);
        }
    }

    public close(): void {
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            this.setState(WebSocketState.CLOSING);
            this.readyState = ExtensionWebSocket.CLOSING;
            this.socket.close();
            this.socket = null;
            this.setState(WebSocketState.CLOSED);
            this.readyState = ExtensionWebSocket.CLOSED;
        }
    }
}

export interface StockData {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;  // 漲跌百分比
    isRealtime: boolean;  // 標示是否為即時價格
    cost?: number;        // 成本價格
    shares?: number;      // 持有股數
    profit?: number;      // 盈虧金額
    profitPercent?: number; // 盈虧百分比
    type?: string;        // 股票類型
    exchange?: string;    // 交易所
    market?: string;      // 市場
    bid?: number;         // 買價
    ask?: number;         // 賣價
    size?: number;        // 單筆交易量
    volume?: number;      // 總交易量
    isClose?: boolean;    // 是否收盤
    time?: string;        // 時間
    serial?: number;      // 序號
}

export enum DataSource {
    WEBSOCKET = 'WEBSOCKET'
}

export class StockService {
    private priceAlerts: Map<string, PriceAlert[]>;
    private readonly AUTH_URL = 'https://srv.stockmon.info/api/auth/login';
    private readonly SESSION_URL = 'https://srv.stockmon.info/api/session';
    private readonly API_BASE_URL = 'https://srv.stockmon.info/api';
    private readonly WS_CONFIG: WebSocketConfig = {
        host: 'srv.stockmon.info',
        port: 443,
        reconnectInterval: 3000,
        maxReconnectAttempts: 8,
        heartbeatInterval: 30000,
        path: '/ws/stock/'
    };
    private outputChannel: vscode.OutputChannel;
    private stockCosts: Map<string, StockCostData>;
    private lastStockData: StockData[] = [];
    private webSocket: ExtensionWebSocket | null = null;
    private subscriptions: Set<string> = new Set();
    private wsMessageHandler: ((data: WebSocket.Data) => void) | null = null;
    private authToken: string | null = null;
    private sessionInfo: SessionInfo | null = null;
    private onOpenHandlers: (() => void)[] = [];
    private clientUuid: string;
    private stateManager: StateManager;
    private statusBarItem: vscode.StatusBarItem;
    private languageManager: LanguageManager;
    private context: vscode.ExtensionContext;
    private onUpdateHandlers: (() => void)[] = [];  // 新增更新事件處理器列表
    private onWebSocketStateChangeHandlers: ((state: WebSocketState) => void)[] = [];  // 新增 WebSocket 狀態變更處理器列表

    constructor(context: vscode.ExtensionContext, statusBarItem: vscode.StatusBarItem) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('Stock Mon');
        this.statusBarItem = statusBarItem;
        this.languageManager = LanguageManager.getInstance();
        this.stateManager = StateManager.getInstance(context);
        
        // 從 StateManager 讀取儲存的資料
        this.stockCosts = this.stateManager.getStockCosts();
        this.priceAlerts = this.stateManager.getPriceAlerts();
        this.clientUuid = this.stateManager.getClientUuid();
        this.sessionInfo = this.stateManager.getSessionInfo();
        this.authToken = this.stateManager.getAuthToken();
        this.subscriptions = this.stateManager.getSubscriptions();
        this.lastStockData = this.stateManager.getLastStockData();  // 讀取最後行情
        
        // 輸出初始狀態
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Initial state:`);
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Client UUID: ${this.clientUuid}`);
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Auth Token: ${this.authToken ? 'present' : 'not present'}`);
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Session Info: ${JSON.stringify(this.sessionInfo)}`);
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Subscriptions: ${Array.from(this.subscriptions).join(', ')}`);
        
        // 初始化基本股票資料
        this.initializeBasicStockData();
        
        // 在構造函數中只初始化一次 WebSocket
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Initializing WebSocket from constructor`);
        this.initWebSocket().then(() => {
            if (this.webSocket) {
                this.webSocket.onStateChange((state: WebSocketState) => {
                    this.handleWebSocketStateChange(state);
                });
            }
        }).catch(error => {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Failed to initialize WebSocket: ${error}`);
        });
    }

    public getContext(): vscode.ExtensionContext {
        return this.context;
    }

    // 初始化基本股票資料的方法
    private initializeBasicStockData(symbols?: string[]): void {
        // 如果沒有提供特定的股票代號，則從 StateManager 獲取
        if (!symbols) {
            const subscriptions = this.stateManager.getSubscriptions();
            symbols = Array.from(subscriptions);
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Getting symbols from state: ${symbols.join(', ')}`);
        } else {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Using provided symbols: ${symbols.join(', ')}`);
        }

        // 只為新的股票建立基本資料
        symbols.forEach(symbol => {
            // 檢查是否已經存在這個股票的資料
            const existingIndex = this.lastStockData.findIndex(s => s.symbol === symbol);
            if (existingIndex === -1) {  // 只有當股票不存在時才初始化
                const stockCost = this.stockCosts.get(symbol);
                const stockData: StockData = {
                    symbol,
                    name: symbol,
                    price: 0,
                    change: 0,
                    changePercent: 0,
                    isRealtime: false
                };

                if (stockCost) {
                    stockData.cost = stockCost.cost;
                    stockData.shares = stockCost.shares;
                    stockData.profit = 0;
                    stockData.profitPercent = 0;
                }

                this.lastStockData.push(stockData);
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Initialized basic data for symbol: ${symbol}`);
            } else {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Symbol ${symbol} already exists in lastStockData`);
            }
        });
    }

    public onWebSocketOpen(handler: () => void): void {
        this.onOpenHandlers.push(handler);
        // 如果 WebSocket 已經是開啟狀態，立即執行 handler
        if (this.webSocket?.readyState === ExtensionWebSocket.OPEN) {
            handler();
        }
    }

    private async initSession(): Promise<void> {
        try {
            if (this.sessionInfo) {
                return;
            }
            
            const response = await axios.post<SessionInfo>(this.SESSION_URL, {
                uuid: this.clientUuid
            }, {
                headers: this.authToken ? {
                    'Authorization': `Bearer ${this.authToken}`
                } : undefined
            });

            this.sessionInfo = {
                uuid: this.clientUuid,
                is_authenticated: response.data.is_authenticated,
                channel_type: response.data.channel_type
            };
            
            await this.stateManager.setSessionInfo(this.sessionInfo);
            
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Session initialized: ${this.sessionInfo.uuid}`);
        } catch (error) {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Failed to initialize session: ${error}`);
            throw error;
        }
    }

    private async initWebSocket(): Promise<void> {
        try {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Initializing WebSocket from constructor`);
            
            // 如果已經有活動的連接，不要創建新的
            if (this.webSocket?.readyState === ExtensionWebSocket.OPEN || 
                this.webSocket?.readyState === ExtensionWebSocket.CONNECTING) {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] WebSocket connection already exists`);
                return;
            }
            
            // 確保有 session
            if (!this.sessionInfo) {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] No session, initializing`);
                await this.initSession();
                // 如果還是沒有 session，則不繼續
                if (!this.sessionInfo) {
                    this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Cannot initialize WebSocket: No valid session`);
                    return;
                }
            }

            // 構建 WebSocket URL，包含 session UUID
            const wsUrl = new URL(`wss://${this.WS_CONFIG.host}:${this.WS_CONFIG.port}${this.WS_CONFIG.path}`);
            wsUrl.searchParams.append('uuid', this.clientUuid);
            if (this.authToken) {
                wsUrl.searchParams.append('token', this.authToken);
            }

            this.WS_CONFIG.path = wsUrl.pathname + wsUrl.search;
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] WebSocket URL: ${wsUrl.toString()}`);
            
            // 使用單例模式獲取 WebSocket 實例
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Getting WebSocket instance`);
            this.webSocket = ExtensionWebSocket.getInstance(this.WS_CONFIG, this.outputChannel);
            
            // 設置事件處理器
            this.webSocket.on('message', (data: WebSocket.Data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Received message: ${data.toString()}`);
                    
                    switch (message.type) {
                        case 'connection_established':
                            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Connection established: ${message.message}`);
                            this.sessionInfo = {
                                uuid: message.session.uuid,
                                is_authenticated: message.authenticated,
                                channel_type: 'stock',
                                user: message.user
                            };
                            // 保存 session 資訊
                            this.stateManager.updateSessionInfo(this.sessionInfo);
                            
                            // 在連接建立後立即重新訂閱
                            this.subscriptions = this.stateManager.getSubscriptions();
                            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Current subscriptions from state: ${Array.from(this.subscriptions).join(', ')}`);
                            if (this.subscriptions.size > 0) {
                                const symbols = Array.from(this.subscriptions);
                                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Resubscribing to stocks from state: ${symbols.join(', ')}`);
                                this.sendSubscription(symbols, true);
                            } else {
                                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] No subscriptions to restore`);
                            }
                            break;

                        case 'subscription_success':
                            this.outputChannel.appendLine(
                                `[${new Date().toLocaleString()}] Subscription successful for: ${message.symbols.join(', ')}`
                            );
                            break;

                        case 'subscription_error':
                            this.outputChannel.appendLine(
                                `[${new Date().toLocaleString()}] Subscription error: ${message.message}`
                            );
                            break;

                        case 'unsubscribe_success':
                            this.outputChannel.appendLine(
                                `[${new Date().toLocaleString()}] Unsubscription successful for: ${message.symbols.join(', ')}`
                            );
                            break;

                        case 'stock_update':
                            if (message.symbol && message.price) {
                                this.outputChannel.appendLine(
                                    `[${new Date().toLocaleString()}] Stock update received for ${message.symbol}: ${message.price}`
                                );
                                const stockData: Partial<StockData> = {
                                    symbol: message.symbol,
                                    name: message.name || message.symbol,
                                    price: message.price,
                                    change: message.change || 0,
                                    changePercent: message.changePercent || 0,
                                    isRealtime: true,
                                    type: message.type,
                                    exchange: message.exchange,
                                    market: message.market,
                                    volume: message.volume,
                                    time: new Date(message.time * 1000).toLocaleString(),
                                    serial: message.time
                                };
                                
                                this.handleStockData(stockData);
                                if (this.wsMessageHandler) {
                                    this.wsMessageHandler(data);
                                }
                            } else {
                                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Invalid stock_update message: missing required fields`);
                            }
                            break;

                        case 'pong':
                            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Heartbeat response received`);
                            break;

                        case 'error':
                            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Server error: ${message.message}`);
                            break;

                        default:
                            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Unknown message type: ${message.type}`);
                    }
                } catch (error) {
                    this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Error handling message: ${error}`);
                }
            });

            this.webSocket.on('open', async () => {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] WebSocket connection opened with UUID: ${this.clientUuid}`);
                // 通知所有註冊的 open handlers
                this.onOpenHandlers.forEach(handler => {
                    try {
                        handler();
                    } catch (error) {
                        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Error in open handler: ${error}`);
                    }
                });
                
                // 確保在連接建立後重新訂閱
                const subscriptions = this.stateManager.getSubscriptions();
                if (subscriptions.size > 0) {
                    const symbols = Array.from(subscriptions);
                    this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Resubscribing to stocks on open: ${symbols.join(', ')}`);
                    this.sendSubscription(symbols, true);
                }
            });

            this.webSocket.on('error', (error: Error) => {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] WebSocket error: ${error.message}`);
            });

            this.webSocket.on('close', (code: number, reason: string) => {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] WebSocket closed with code ${code}: ${reason}`);
            });

            // 開始連接
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Starting WebSocket connection`);
            this.webSocket.connect();

        } catch (error) {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Failed to initialize WebSocket: ${error}`);
            throw error;
        }
    }

    private resubscribeAll(): void {
        // 重新訂閱所有股票
        if (this.subscriptions.size > 0) {
            const symbols = Array.from(this.subscriptions);
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Resubscribing to: ${symbols.join(', ')}`);
            this.sendSubscription(symbols, true);
        }
    }

    private sendSubscription(symbols: string | string[], subscribe: boolean): void {
        if (this.webSocket?.readyState === ExtensionWebSocket.OPEN) {
            const symbolArray = Array.isArray(symbols) ? symbols : [symbols];
            const message = {
                action: subscribe ? 'subscribe' : 'unsubscribe',
                symbols: symbolArray
            };
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Preparing to send ${subscribe ? 'subscribe' : 'unsubscribe'} message for: ${symbolArray.join(', ')}`);
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] WebSocket state: ${this.webSocket.readyState}`);
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Message content: ${JSON.stringify(message)}`);
            
            try {
                this.webSocket.send(JSON.stringify(message));
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Successfully sent ${subscribe ? 'subscribe' : 'unsubscribe'} message for: ${symbolArray.join(', ')}`);
            } catch (error) {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Error sending subscription message: ${error}`);
            }
        } else {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Cannot send subscription: WebSocket not ready (state: ${this.webSocket?.readyState})`);
        }
    }

    public updateSubscriptions(newSymbols: string[]): void {
        // 找出需要取消訂閱的股票
        const toUnsubscribe = Array.from(this.subscriptions).filter(symbol => !newSymbols.includes(symbol));
        
        // 找出需要新訂閱的股票
        const toSubscribe = newSymbols.filter(symbol => !this.subscriptions.has(symbol));
        
        // 取消訂閱
        if (toUnsubscribe.length > 0) {
            this.sendSubscription(toUnsubscribe, false);
            toUnsubscribe.forEach(symbol => {
                this.subscriptions.delete(symbol);
                this.stateManager.updateSubscription(symbol, false);
                // 從 lastStockData 中移除被取消訂閱的股票
                this.lastStockData = this.lastStockData.filter(stock => stock.symbol !== symbol);
            });
        }
        
        // 新增訂閱
        if (toSubscribe.length > 0) {
            this.sendSubscription(toSubscribe, true);
            toSubscribe.forEach(symbol => {
                this.subscriptions.add(symbol);
                this.stateManager.updateSubscription(symbol, true);
            });
        }
        
        // 更新基本股票資料
        this.initializeBasicStockData(newSymbols);
    }

    public getWebSocketState(): WebSocketState {
        return this.webSocket?.state || WebSocketState.CLOSED;
    }

    public setMessageHandler(handler: ((data: WebSocket.Data) => void) | null): void {
        this.wsMessageHandler = handler;
    }

    private handleStockData(data: any): void {
        try {
            const stockData: StockData = {
                symbol: data.symbol,
                name: data.name || data.symbol,
                price: data.price || 0,
                change: data.change || 0,
                changePercent: data.changePercent || 0,
                isRealtime: true
            };

            // 更新股票資訊
            const existingIndex = this.lastStockData.findIndex(s => s.symbol === stockData.symbol);
            if (existingIndex === -1) {
                this.lastStockData.push(stockData);
            } else {
                this.lastStockData[existingIndex] = {
                    ...this.lastStockData[existingIndex],
                    ...stockData
                };
            }

            // 檢查是否有設定成本並計算損益
            const stockCost = this.getCost(stockData.symbol);
            if (stockCost) {
                stockData.cost = stockCost.cost;
                stockData.shares = stockCost.shares;
                if (stockData.price !== undefined) {
                    stockData.profit = (stockData.price - stockCost.cost) * stockCost.shares;
                    stockData.profitPercent = ((stockData.price - stockCost.cost) / stockCost.cost) * 100;
                }
            }

            // 檢查價格提醒
            if (stockData.price !== undefined) {
                this.checkPriceAlerts(stockData);
            }

            // 更新狀態列
            this.updateStatusBarWithStockInfo();

            // 儲存最後的股票資料
            this.stateManager.updateStockData(stockData);

            // 觸發更新事件
            this.onUpdateHandlers.forEach(handler => handler());

        } catch (error) {
            console.error('Error handling stock data:', error);
        }
    }

    async getStockPrice(symbols: string[]): Promise<StockData[]> {
        return new Promise((resolve) => {
            const result: StockData[] = symbols.map(symbol => ({
                symbol,
                name: symbol,  // 添加 name 屬性
                price: 0,
                change: 0,
                changePercent: 0,
                isRealtime: false
            }));
            
            const handler = (data: any) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.type === 'stock_data') {
                        const stockData: Partial<StockData> = {
                            symbol: message.symbol,
                            name: message.name || message.symbol,  // 添加 name 屬性
                            price: message.price,
                            change: message.change || 0,
                            changePercent: message.changePercent || 0,
                            isRealtime: true,
                            type: message.type,
                            exchange: message.exchange,
                            market: message.market,
                            volume: message.volume,
                            time: new Date(message.time * 1000).toLocaleString(),
                        };

                        const index = result.findIndex(s => s.symbol === message.symbol);
                        if (index >= 0) {
                            result[index] = { ...result[index], ...stockData } as StockData;
                        }
                    }
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };

            // 設置訊息處理器
            this.setMessageHandler(handler);

            // 訂閱股票
            this.sendSubscription(symbols, true);

            // 5秒後返回結果
            setTimeout(() => {
                this.setMessageHandler(null);
                resolve(result);
            }, 5000);
        });
    }

    // 計算總損益
    public calculateTotalProfit(): { totalProfit: number; totalProfitPercent: number } {
        let totalProfit = 0;
        let totalCost = 0;

        // 如果沒有股票數據，返回預設值
        if (!this.lastStockData || this.lastStockData.length === 0) {
            return { totalProfit: 0, totalProfitPercent: 0 };
        }

        this.lastStockData.forEach(stock => {
            if (stock.cost !== undefined && stock.shares !== undefined) {
                const profit = (stock.price - stock.cost) * stock.shares;
                totalProfit += profit;
                totalCost += stock.cost * stock.shares;
            }
        });

        const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

        return { totalProfit, totalProfitPercent };
    }

    // 取得最後一次的股票資料
    public getLastStockData(): StockData[] {
        return this.lastStockData;
    }

    // 設定股票到價提醒
    setPriceAlert(symbol: string, targetPrice: number, isAbove: boolean): void {
        const alerts = this.priceAlerts.get(symbol) || [];
        alerts.push({
            symbol,
            targetPrice,
            isAbove,
            triggered: false
        });
        this.priceAlerts.set(symbol, alerts);
        this.stateManager.updatePriceAlert(symbol, alerts);
    }

    // 取得股票的所有到價提醒
    getPriceAlerts(symbol: string): PriceAlert[] {
        return this.priceAlerts.get(symbol) || [];
    }

    // 刪除股票的到價提醒
    removePriceAlert(symbol: string, targetPrice: number, isAbove: boolean): void {
        const alerts = this.priceAlerts.get(symbol) || [];
        const filteredAlerts = alerts.filter(
            alert => !(alert.targetPrice === targetPrice && alert.isAbove === isAbove)
        );
        if (filteredAlerts.length > 0) {
            this.priceAlerts.set(symbol, filteredAlerts);
        } else {
            this.priceAlerts.delete(symbol);
        }
        this.stateManager.updatePriceAlert(symbol, filteredAlerts);
    }

    // 檢查是否需要觸發到價提醒
    checkPriceAlerts(stockData: StockData): PriceAlert[] {
        const alerts = this.priceAlerts.get(stockData.symbol) || [];
        const triggeredAlerts: PriceAlert[] = [];

        alerts.forEach(alert => {
            if (!alert.triggered) {
                if (alert.isAbove && stockData.price >= alert.targetPrice) {
                    alert.triggered = true;
                    triggeredAlerts.push(alert);
                } else if (!alert.isAbove && stockData.price <= alert.targetPrice) {
                    alert.triggered = true;
                    triggeredAlerts.push(alert);
                }
            }
        });

        return triggeredAlerts;
    }

    // 重設所有提醒的觸發狀態
    resetAlertTriggers(): void {
        this.priceAlerts.forEach(alerts => {
            alerts.forEach(alert => {
                alert.triggered = false;
            });
        });
    }

    // 設定股票成本和股數
    setCost(symbol: string, cost: number, shares: number): void {
        const stockCost: StockCostData = { cost, shares };
        this.stockCosts.set(symbol, stockCost);
        this.stateManager.updateStockCost(symbol, stockCost);
    }

    // 批次設定多個股票成本和股數
    setCosts(costs: Array<{symbol: string; cost: number; shares: number}>): void {
        costs.forEach(({symbol, cost, shares}) => {
            const stockCost: StockCostData = { cost, shares };
            this.stockCosts.set(symbol, stockCost);
            this.stateManager.updateStockCost(symbol, stockCost);
        });
    }

    // 取得股票成本和股數
    getCost(symbol: string): StockCostData | undefined {
        return this.stockCosts.get(symbol);
    }

    // 取得所有到價提醒
    getAllPriceAlerts(): Map<string, PriceAlert[]> {
        return this.priceAlerts;
    }

    // 手動觸發價格提醒檢查
    manualCheckPriceAlerts(symbol: string): PriceAlert[] {
        const stockData = this.lastStockData.find(stock => stock.symbol === symbol);
        if (!stockData) {
            return [];
        }

        // 重設該股票的提醒觸發狀態
        const alerts = this.priceAlerts.get(symbol) || [];
        alerts.forEach(alert => {
            alert.triggered = false;
        });

        // 檢查並返回觸發的提醒
        return this.checkPriceAlerts(stockData);
    }
        
    public subscribe(symbol: string): void {
        if (!this.webSocket || this.webSocket.readyState !== ExtensionWebSocket.OPEN) {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Cannot subscribe: WebSocket not connected`);
            return;
        }

        // 如果已經訂閱了，就不要重複訂閱
if (this.subscriptions.has(symbol)) {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Already subscribed to: ${symbol}`);
            return;
        }

        this.subscriptions.add(symbol);
        this.stateManager.updateSubscription(symbol, true);
        this.sendSubscription([symbol], true);
    }

    public unsubscribe(symbol: string): void {
        if (!this.webSocket || this.webSocket.readyState !== ExtensionWebSocket.OPEN) {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Cannot unsubscribe: WebSocket not connected`);
            return;
        }

        // 如果沒有訂閱，就不需要取消訂閱
        if (!this.subscriptions.has(symbol)) {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Not subscribed to: ${symbol}`);
            return;
        }

        this.subscriptions.delete(symbol);
        this.stateManager.updateSubscription(symbol, false);
        this.sendSubscription([symbol], false);
    }

    public async clearAllSubscriptions(): Promise<void> {
        if (this.webSocket?.readyState === ExtensionWebSocket.OPEN && this.subscriptions.size > 0) {
            const symbols = Array.from(this.subscriptions);
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Unsubscribing from all stocks: ${symbols.join(', ')}`);
            this.sendSubscription(symbols, false);
        }
        
        this.subscriptions.clear();
        await this.stateManager.clearSubscriptions();
        // 清空 lastStockData
        this.lastStockData = [];
        await this.stateManager.clearLastStockData();
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] All subscriptions cleared`);
    }

    public async logout(): Promise<void> {
        try {
            // 如果有 token，呼叫登出 API
            if (this.authToken) {
                await axios.post(
                    `${this.API_BASE_URL}/auth/logout`,
                    {},
                    {
                        headers: {
                            'Authorization': `Bearer ${this.authToken}`,
                            'X-Client-UUID': this.clientUuid
                        }
                    }
                );
            }

            // 立即更新 session 資訊
            this.sessionInfo = {
                uuid: this.clientUuid,
                is_authenticated: false,
                channel_type: 'anonymous'
            };
            await this.stateManager.setSessionInfo(this.sessionInfo);

            // 清除 token
            this.authToken = null;
            await this.stateManager.setAuthToken(null);

            // 更新狀態列
            this.handleWebSocketStateChange(this.getWebSocketState());

        } catch (error) {
            console.error('登出時發生錯誤:', error);
            throw error;
        }
    }

    public isAuthenticated(): boolean {
        return this.stateManager.isAuthenticated();
    }

    public async login(username: string, password: string): Promise<boolean> {
        this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Login attempt for user: ${username}`);
        try {
            const response = await axios.post(this.AUTH_URL, {
                username,
                password
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Client-UUID': this.clientUuid
                }
            });

            if (response.data && response.data.access_token) {
                this.authToken = response.data.access_token;
                await this.stateManager.setAuthToken(this.authToken);
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Login successful for user: ${username}`);
                
                // 立即更新 session 資訊
                this.sessionInfo = {
                    uuid: this.clientUuid,
                    is_authenticated: true,
                    channel_type: 'stock',
                    user: username
                };
                await this.stateManager.setSessionInfo(this.sessionInfo);
                
                // 重置 WebSocket 實例
                ExtensionWebSocket.resetInstance();
                this.webSocket = null;
                
                // 重新建立 WebSocket 連接，這次會帶上新的 auth token
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Initializing new WebSocket connection with auth token`);
                await this.initWebSocket();
                
                return true;
            }
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Login failed: Invalid response format`);
            return false;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const errorMessage = error.response?.data?.error || error.message;
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Login error (${error.response?.status}): ${errorMessage}`);
                if (error.response?.status === 401) {
                    this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Authentication failed for user: ${username}`);
                } else {
                    this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Server error: ${errorMessage}`);
                }
            } else {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Unexpected error during login: ${error}`);
            }
            return false;
        }
    }

    /**
     * 搜尋股票
     * @param query 搜尋關鍵字（股票代號或名稱）
     * @returns 搜尋結果列表
     */
    public async searchStocks(query: string): Promise<StockSearchResult[]> {
        try {
            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Searching stocks with query: ${query}`);
            
            // 確保查詢字串不為空
            if (!query || query.trim().length === 0) {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Empty search query`);
                return [];
            }

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'X-Client-UUID': this.clientUuid
            };

            // 如果有 auth token，加入到 headers
            if (this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const response = await axios.get(`${this.API_BASE_URL}/stocks/search`, {
                params: {
                    query: query.trim()
                },
                headers,
                timeout: 10000 // 設置 10 秒超時
            });

            this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Search response status: ${response.status}`);

            if (response.data && Array.isArray(response.data.items)) {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Found ${response.data.items.length} results`);
                return response.data.items;
            } else {
                this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Invalid response format: ${JSON.stringify(response.data)}`);
                return [];
            }
        } catch (error) {
            // 詳細的錯誤處理
            if (axios.isAxiosError(error)) {
                const statusCode = error.response?.status;
                const errorMessage = error.response?.data?.error || error.message;
                this.outputChannel.appendLine(
                    `[${new Date().toLocaleString()}] Axios error during stock search: ` +
                    `Status: ${statusCode}, Message: ${errorMessage}`
                );

                if (statusCode === 401) {
                    this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Authentication error during search`);
                } else if (statusCode === 404) {
                    this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Search endpoint not found`);
                } else if (error.code === 'ECONNREFUSED') {
                    this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Connection refused: Server might be down`);
                } else if (error.code === 'ETIMEDOUT') {
                    this.outputChannel.appendLine(`[${new Date().toLocaleString()}] Request timed out`);
                }
            } else {
                this.outputChannel.appendLine(
                    `[${new Date().toLocaleString()}] Unexpected error during stock search: ${error}`
                );
            }

            // 重新拋出一個更具體的錯誤
            throw new Error(`Stock search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private handleWebSocketStateChange(state: WebSocketState): void {
        const messages = this.languageManager.getMessage();
        
        switch (state) {
            case WebSocketState.CONNECTING:
                this.statusBarItem.text = `$(loading~spin) ${messages.connection.connecting}`;
                this.statusBarItem.tooltip = messages.connection.connectingToService;
                // 將所有股票標記為非即時
                this.lastStockData.forEach(stock => stock.isRealtime = false);
                break;
            case WebSocketState.CONNECTED:
                if (this.isAuthenticated()) {
                    // 已登入狀態顯示綠色勾勾
                    this.statusBarItem.text = `$(check) $(pass)`;
                    this.statusBarItem.tooltip = `${messages.connection.connected} (${messages.auth.loggedInAs}: ${this.sessionInfo?.user})`;
                } else {
                    // 未登入狀態只顯示普通勾勾
                    this.statusBarItem.text = `$(check)`;
                    this.statusBarItem.tooltip = messages.connection.connected;
                }
                // 連接成功後立即更新股票資訊
                this.updateStatusBarWithStockInfo();
                break;
            case WebSocketState.RECONNECTING:
                this.statusBarItem.text = `$(loading~spin) ${messages.connection.reconnecting}`;
                this.statusBarItem.tooltip = messages.connection.reconnecting;
                // 將所有股票標記為非即時
                this.lastStockData.forEach(stock => stock.isRealtime = false);
                break;
            case WebSocketState.CLOSING:
                this.statusBarItem.text = `$(loading~spin) ${messages.connection.closing}`;
                this.statusBarItem.tooltip = messages.connection.closing;
                // 將所有股票標記為非即時
                this.lastStockData.forEach(stock => stock.isRealtime = false);
                break;
            case WebSocketState.CLOSED:
                this.statusBarItem.text = `$(error) ${messages.connection.disconnected}`;
                this.statusBarItem.tooltip = messages.connection.clickToReconnect;
                // 將所有股票標記為非即時
                this.lastStockData.forEach(stock => stock.isRealtime = false);
                break;
        }
        this.statusBarItem.show();
        
        // 保存更新後的股票數據
        this.stateManager.setLastStockData(this.lastStockData);
        
        // 通知所有註冊的更新處理器
        this.onUpdateHandlers.forEach(handler => handler());

        // 通知所有註冊的 WebSocket 狀態變更處理器
        this.onWebSocketStateChangeHandlers.forEach(handler => handler(state));
    }

    // 新增一個方法來更新股票資訊
    private updateStatusBarWithStockInfo(): void {
        const stockData = this.getLastStockData();
        if (stockData.length > 0) {
            const { totalProfit, totalProfitPercent } = this.calculateTotalProfit();
            const totalProfitColor = totalProfit >= 0 ? '$(arrow-up)' : '$(arrow-down)';
            const formattedTotalProfit = Math.abs(totalProfit).toFixed(2);
            const formattedTotalProfitPercent = Math.abs(totalProfitPercent).toFixed(2);
            
            // 更新狀態欄，在勾勾後面加上總損益
            this.statusBarItem.text = `$(check) ${totalProfitColor}${formattedTotalProfit}(${formattedTotalProfitPercent}%)`;
            
            // 建立 tooltip
            const tooltipContent = new vscode.MarkdownString();
            tooltipContent.isTrusted = true;
            tooltipContent.supportHtml = true;

            tooltipContent.appendMarkdown(`# 股票收益統計 ${new Date().toLocaleDateString('zh-TW')}\n`);
            tooltipContent.appendMarkdown('---\n\n');
            
            stockData.forEach(stock => {
                const priceColor = stock.change >= 0 ? '↑' : '↓';
                const profitColor = (stock.profit || 0) >= 0 ? '↑' : '↓';
                
                tooltipContent.appendMarkdown(`### ${stock.symbol}\n`);
                tooltipContent.appendMarkdown(`**現價:** ${stock.price.toFixed(2)} ${priceColor}${Math.abs(stock.change).toFixed(2)}\n\n`);
                
                if (stock.cost !== undefined) {
                    tooltipContent.appendMarkdown(`**成本:** ${stock.cost.toFixed(2)} | **股數:** ${stock.shares}\n\n`);
                    tooltipContent.appendMarkdown(`**損益:** ${profitColor}${Math.abs(stock.profit || 0).toFixed(2)}(${Math.abs(stock.profitPercent || 0).toFixed(2)}%)\n`);
                }
                tooltipContent.appendMarkdown('---\n\n');
            });

            tooltipContent.appendMarkdown(`### 投資組合總計\n`);
            tooltipContent.appendMarkdown(`**總損益:** ${totalProfitColor === '$(arrow-up)' ? '↑' : '↓'}${formattedTotalProfit}\n\n`);
            tooltipContent.appendMarkdown(`**總報酬率:** ${totalProfitColor === '$(arrow-up)' ? '↑' : '↓'}${formattedTotalProfitPercent}%\n\n`);
            tooltipContent.appendMarkdown('---\n\n');
            tooltipContent.appendMarkdown('*點擊以開啟詳細資訊面板*');
            
            this.statusBarItem.tooltip = tooltipContent;
        }
    }

    public async reinitializeWebSocket(): Promise<void> {
        // 重置 WebSocket 實例
        ExtensionWebSocket.resetInstance();
        this.webSocket = null;
        
        // 重新初始化 WebSocket
        await this.initWebSocket();
    }

    // 新增註冊更新事件處理器的方法
    public onUpdate(handler: () => void): void {
        this.onUpdateHandlers.push(handler);
    }

    // 新增註冊 WebSocket 狀態變更處理器的方法
    public onWebSocketStateChange(handler: (state: WebSocketState) => void): void {
        this.onWebSocketStateChangeHandlers.push(handler);
    }
}
