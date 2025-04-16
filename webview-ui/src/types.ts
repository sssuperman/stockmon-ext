// WebSocket connection states
export enum WebSocketState {
    CLOSED = 'CLOSED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    RECONNECTING = 'RECONNECTING',
    ERROR = 'ERROR'
}

// 定義一些共用的子類型
interface OrderBook {
    price: number;
    size: number;
}

interface TotalInfo {
    tradeValue: number;
    tradeVolume: number;
    tradeVolumeAtBid: number;
    tradeVolumeAtAsk: number;
    transaction: number;
    time: number;
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

// Stock inventory item structure
export interface StockInventory {
    symbol: string;
    name: string;
    price?: number;
    change?: number;
    changePercent?: number;
    totalChange?: number;
    volume?: number;
    amount?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    quantity?: number;
    averageCost?: number;
    type?: string;
    exchange?: string;
    market?: string;
    industry?: string;
    updatedAt?: string;
    previousClose?: number;
    canBuyDayTrade?: boolean;
    canDayTrade?: boolean;
    canBelowFlatMarginShortSell?: boolean;
    canBelowFlatSBLShortSell?: boolean;
    isAttention?: boolean;
    isDisposition?: boolean;
    isUnusuallyRecommended?: boolean;
    isSpecificAbnormally?: boolean;
    referencePrice?: number;
    limitUpPrice?: number;
    limitDownPrice?: number;
    securityStatus?: string;
    boardLot?: number;
    tradingCurrency?: string;
    
    // 添加缺少的屬性
    value?: number;
    avgPrice?: number;
    amplitude?: number;
    date?: string;
    time?: string;
    serial?: number;
    isRealtime?: boolean;
    alerts?: PriceAlert[];
    isSubscribed?: boolean;
    
    // 五檔及內外盤相關屬性
    inVolume?: number;      // 內盤成交量
    outVolume?: number;     // 外盤成交量
    neutralVolume?: number; // 中性盤成交量
    previousVolume?: number; // 前一交易日成交量
    bids?: OrderBook[];     // 買方五檔
    asks?: OrderBook[];     // 賣方五檔
    total?: TotalInfo;      // 成交總量資訊
    lastTrade?: TradeInfo;  // 最後成交資訊
    lastTrial?: TradeInfo;  // 試算資訊
    isClose?: boolean;      // 是否收盤
    
    // 其他可能需要的屬性
    syncVersion?: number;
    lastSyncTimestamp?: number;
    clientUuid?: string;
    hasConflict?: boolean;
    conflictData?: any;
    cost?: any;
    profit?: number;
    profitPercent?: number;
}

// Price alert structure
export interface PriceAlert {
    id: number;
    price: number;
    isAbove: boolean;
    symbol?: string;
    name?: string;
}

// Market index data structure
export interface IndiceData {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    previousClose: number;
    volume?: number;
    updatedAt: string;
    index?: number;  // 指數值
    exchange?: string;  // 交易所
    time?: string;  // 時間
    isRealtime?: boolean;  // 是否即時數據
}

// Session information structure
export interface SessionInfo {
    is_authenticated: boolean;
    user?: string;
    email?: string;
}

// Candle data for stock charts
export interface CandleData {
    time: string; // ISO time string
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
} 