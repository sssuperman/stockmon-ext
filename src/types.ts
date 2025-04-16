import { WebSocket } from 'ws';

interface OrderBook {
    price: number;
    size: number;
}

interface TradeInfo {
    bid?: number;
    ask?: number;
    price: number;
    size?: number;
    volume?: number;
    time: number;
    serial?: number;
}

interface TotalInfo {
    tradeValue: number;
    tradeVolume: number;
    tradeVolumeAtBid: number;
    tradeVolumeAtAsk: number;
    transaction: number;
    time: number;
}

export interface StockInventory {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    value: number;
    avgPrice: number;
    amplitude: number;
    date: string;
    time: string;
    serial: number;
    isRealtime: boolean;
    type: string;
    exchange: string;
    market: string;
    alerts: (PriceAlert | StockAlert)[];
    isSubscribed: boolean;
    cost?: StockCostData;
    profit?: number;
    profitPercent?: number;
    
    // New fields for fast channel
    lastPrice?: number;
    lastSize?: number;
    referencePrice?: number;
    previousClose?: number;
    bids?: OrderBook[];
    asks?: OrderBook[];
    total?: TotalInfo;
    lastTrade?: TradeInfo;
    lastTrial?: TradeInfo;
    isClose?: boolean;
    
    // 內外盤和量縮相關屬性
    inVolume?: number;      // 內盤成交量
    outVolume?: number;     // 外盤成交量
    neutralVolume?: number; // 中性盤成交量
    previousVolume?: number; // 前一交易日成交量
    
    // 添加同步相關欄位
    syncVersion?: number;
    lastSyncTimestamp?: number;
    clientUuid?: string;
    hasConflict?: boolean;
    conflictData?: ConflictData;
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

export interface StockAlert {
    id: string;
    type: string;
    message: string;
    timestamp: string;
    threshold?: number;
    currentValue?: number;
    price?: number;
    formattedTime?: string;
    timezone?: string;
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
    action: 'add' | 'update' | 'delete';
    symbol: string;
    quantity?: number;
    averageCost?: number;
    timestamp: number;
    version?: number;
    last_sync_timestamp?: number;
}

export enum WebSocketState {
    CLOSED = 'CLOSED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    RECONNECTING = 'RECONNECTING',
    ERROR = 'ERROR'
}

// 添加同步相關的類型定義
export interface SyncStatus {
  status: string;
  last_sync_time: string | null;
  pending_changes: number;
  client_uuid: string | null;
  recent_actions: SyncAction[];
}

export interface SyncAction {
  action: string;
  status: string;
  timestamp: string;
  details: any;
}

export interface ConflictData {
  client_version: {
    version: number;
    quantity?: number;
    average_cost?: number;
    last_sync_timestamp: number;
    client_uuid: string;
  };
  server_version: {
    version: number;
    quantity: number;
    average_cost: number | null;
    last_sync_timestamp: number;
    client_uuid: string;
  };
}

export interface UserStockResponse {
  stock_symbol: string;
  stock_name: string;
  quantity: number;
  average_cost: number | null;
  created_at: string;
  updated_at: string;
  is_cost_set: boolean;
  is_quantity_set: boolean;
  version: number;
  last_sync_timestamp: number;
  client_uuid: string | null;
  has_conflict: boolean;
  conflict_resolution?: string;
  conflict_data?: ConflictData;
}

export interface ConflictResolutionData {
  symbol: string;
  resolution_method: 'use_server' | 'use_client' | 'merge';
  quantity?: number;
  average_cost?: number;
  client_uuid?: string;
}

export interface CandleData {
  timestamp: string;      // 時間戳
  timeframe: string;      // 時間週期
  open_price: number;     // 開盤價
  high_price: number;     // 最高價
  low_price: number;      // 最低價
  close_price: number;    // 收盤價
  volume: number;         // 成交量
  amount: number;         // 成交金額
}

export interface IndiceData {
  symbol: string;
  name: string;
  index: number;
  change?: number;
  changePercent?: number;
  exchange: string;
  time: number;
  formattedTime?: string;
  previousClose?: number;
  isRealtime: boolean;
  date?: string;
}
