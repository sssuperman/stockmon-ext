import { WebSocket } from 'ws';

export interface StockInventory {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    isRealtime: boolean;
    shares?: number;
    profit?: number;
    profitPercent?: number;
    type?: string;
    exchange?: string;
    market?: string;
    bid?: number;
    ask?: number;
    size?: number;
    volume?: number;
    isClose?: boolean;
    time?: string;
    serial?: number;
    cost?: StockCostData;
    alerts: PriceAlert[];
    isSubscribed: boolean;
}

export interface StockSearchResult {
    symbol: string;
    name: string;
}

export interface WebSocketMessage {
    type: string;
    message?: string;
    symbol?: string;
    data?: any;
    symbols?: string[];
    channel_type?: string;
    session_uuid?: string;
    is_authenticated?: boolean;
}

export interface StockUpdate {
    type: 'stock_update';
    symbol: string;
    data: StockInventory;
}

export interface ClientUuidMessage {
    type: 'client_uuid';
    uuid: string;
}

export interface PriceAlert {
    price: number;
    type: 'above' | 'below';
    triggered: boolean;
}

export interface ExtendedWebSocket {
    isConnected(): boolean;
    reconnect(): void;
    readyState: number;
    on(event: 'message', listener: (data: any) => void): void;
    on(event: 'open', listener: () => void): void;
    on(event: 'close', listener: (code: number, reason: string) => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
    send(data: string): void;
    close(): void;
}

export interface WebSocketConfig {
    host: string;
    port: number;
    reconnectInterval: number;
    maxReconnectAttempts: number;
    heartbeatInterval: number;
    path?: string;
}

export interface SessionInfo {
    uuid: string;
    is_authenticated: boolean;
    channel_type: string;
    user?: string;
}

export interface WebSocketAuthMessage {
    type: string;
    session_uuid: string;
    is_authenticated: boolean;
    channel_type: string;
}

export interface SubscriptionMessage {
    action: 'subscribe' | 'unsubscribe';
    symbols: string[];
}

export interface StockCostData {
    quantity: number;
    cost: number;
    averageCost: number;
}

export interface ServerStockData {
    stock_id: number;
    stock_symbol: string;
    stock_name: string;
    quantity: number;
    average_cost: number;
    current_price?: number;
    created_at: string;
    updated_at: string;
}

export interface SyncQueueItem {
    type: 'ADD' | 'UPDATE' | 'DELETE';
    symbol: string;
    data?: StockCostData;
    timestamp: number;
} 

export enum WebSocketState {
    CLOSED = 'CLOSED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    RECONNECTING = 'RECONNECTING',
    ERROR = 'ERROR'
}
