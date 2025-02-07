import { WebSocket } from 'ws';

export interface StockInfo {
    symbol: string;
    name: string;
    current_price: number;
    previous_close?: number;
    change?: number;
    change_percent?: number;
    volume: number;
    date: string;
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
    data: StockInfo;
}

export interface ClientUuidMessage {
    type: 'client_uuid';
    uuid: string;
}

export interface PriceAlert {
    symbol: string;
    targetPrice: number;
    isAbove: boolean;
    triggered: boolean;
}

export interface StockData {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    isRealtime: boolean;
    cost?: number;
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
    cost: number;
    shares: number;
} 
