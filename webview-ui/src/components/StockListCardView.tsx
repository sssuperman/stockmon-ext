import React, { useState, useEffect, useMemo } from "react";
import { BsThreeDotsVertical, BsArrowClockwise } from "react-icons/bs";
import { StockInventory, CandleData } from "../../../src/types";

interface CardViewProps {
    stocks: StockInventory[];
    updatedStocks: Set<string>;
    activeMenu: string | null;
    handleStockClick: (stock: StockInventory) => void;
    handleMenuClick: (symbol: string) => void;
    handleSetCost: (symbol: string) => void;
    handleSetAlert: (symbol: string) => void;
    handleDelete: (symbol: string) => void;
    klineData?: Record<string, CandleData[]>;
    loadingKline: boolean;
    handleRefreshKline: () => void;
}

// 輔助函數
const formatNumber = (num: any): string => {
    if (typeof num !== 'number' || isNaN(num)) {
        if (typeof num === 'string') {
            const parsedNum = parseFloat(num);
            if (!isNaN(parsedNum)) {
                return parsedNum.toFixed(2);
            }
        }
        return '0.00';
    }
    return num.toFixed(2);
};

const formatPercent = (num: any): string => {
    if (typeof num !== 'number' || isNaN(num)) {
        return '+0.00%';
    }
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
};

// 添加 K 棒圖元件
const KLineBar: React.FC<{
    open: number;
    high: number;
    low: number;
    close: number;
    width: number;
    height: number;
}> = ({ open, high, low, close, width, height }) => {
    const isUp = close >= open;
    const barColor = isUp ? 'var(--vscode-terminal-ansiRed)' : 'var(--vscode-terminal-ansiGreen)';
    
    // 計算價格範圍和比例
    const priceRange = high - low;
    const scale = height / (priceRange || 1);
    
    // 計算 K 棒位置和大小
    const barHeight = Math.abs(close - open) * scale;
    const barY = (high - Math.max(open, close)) * scale;
    const lineY = 0;
    const lineHeight = height;
    const barWidth = width * 0.6; // K棒寬度為總寬度的60%
    const barX = (width - barWidth) / 2;

    return (
        <svg width={width} height={height}>
            {/* 中心線（最高到最低） */}
            <line
                x1={width / 2}
                y1={lineY}
                x2={width / 2}
                y2={lineHeight}
                stroke={barColor}
                strokeWidth="1"
            />
            {/* K棒實體 */}
            <rect
                x={barX}
                y={barY}
                width={barWidth}
                height={Math.max(1, barHeight)} // 確保至少有1px高度
                fill={barColor}
            />
        </svg>
    );
};

// 添加折線圖組件，替換K線圖組件
const MiniLineChart: React.FC<{
    candles?: CandleData[];
    width: number;
    height: number;
    isLoading?: boolean;
    onRefresh?: () => void;
    change?: number; // 添加change參數用於確定顏色
    referencePrice?: number; // 添加referencePrice參數
}> = ({ candles, width, height, isLoading, onRefresh, change, referencePrice }) => {
    if (isLoading) {
        return (
            <div className="mini-kline-placeholder" style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="loading-spinner" style={{ fontSize: '12px' }}>數據加載中...</div>
            </div>
        );
    }
    
    if (!candles || candles.length === 0) {
        return (
            <div className="mini-kline-placeholder" style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ marginBottom: '5px', fontSize: '12px' }}>暫無價格數據</div>
                    {onRefresh && (
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                onRefresh();
                            }}
                            className="refresh-kline-button"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                            <BsArrowClockwise style={{ marginRight: '4px' }} /> 
                            <span style={{ fontSize: '12px' }}>重新載入</span>
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // 取最近的30筆數據或全部（如果少於30筆）
    const recentCandles = candles.slice(-30);
    
    // 僅使用收盤價繪製折線圖
    const closePrices = recentCandles.map(c => c.close_price);
    
    // 計算價格範圍，為了更好的視覺效果，設置些許間距
    let maxPrice = Math.max(...closePrices) * 1.01;
    let minPrice = Math.min(...closePrices) * 0.99;
    
    // 如果有參考價格，確保它在可視範圍內
    if (referencePrice && typeof referencePrice === 'number') {
        if (referencePrice > maxPrice) {
            maxPrice = referencePrice * 1.01;
        }
        if (referencePrice < minPrice) {
            minPrice = referencePrice * 0.99;
        }
    }
    
    const priceRange = maxPrice - minPrice;
    
    // 計算每點的x座標
    const pointWidth = width / (recentCandles.length - 1);
    
    // 生成折線圖的點
    const points = recentCandles.map((candle, index) => {
        const x = index * pointWidth;
        const y = height - ((candle.close_price - minPrice) / priceRange * height);
        return `${x},${y}`;
    }).join(' ');
    
    // 使用傳入的change參數來確定顏色，如果沒有提供change，則使用K線數據判斷
    let isUp = false;
    
    // 優先使用傳入的change參數
    if (typeof change === 'number') {
        isUp = change >= 0;
    } else {
        // 如果沒有提供change，則比較第一個和最後一個k線收盤價
        const firstPrice = recentCandles[0]?.close_price;
        const lastPrice = recentCandles[recentCandles.length - 1]?.close_price;
        isUp = lastPrice >= firstPrice;
    }
    
    const lineColor = isUp ? 'var(--vscode-terminal-ansiRed)' : 'var(--vscode-terminal-ansiGreen)';
    
    // 計算參考價格線的y座標
    let referencePriceY = null;
    if (referencePrice && typeof referencePrice === 'number' && priceRange > 0) {
        referencePriceY = height - ((referencePrice - minPrice) / priceRange * height);
    }
    
    return (
        <svg width={width} height={height} className="mini-line-chart">
            {/* 繪製參考價格線 */}
            {referencePriceY !== null && (
                <>
                    <line
                        x1={0}
                        y1={referencePriceY}
                        x2={width}
                        y2={referencePriceY}
                        stroke="var(--vscode-editor-foreground)"
                        strokeWidth="0.8"
                        strokeDasharray="2,2"
                        opacity="0.6"
                    />
                    {/* 添加參考價格標籤 */}
                </>
            )}
            
            {/* 繪製折線 */}
            <polyline
                points={points}
                fill="none"
                stroke={lineColor}
                strokeWidth="1.5"
            />
            
            {/* 標記最後一個點 */}
            <circle 
                cx={points.split(' ').pop()?.split(',')[0]} 
                cy={points.split(' ').pop()?.split(',')[1]}
                r="3"
                fill={lineColor}
            />
        </svg>
    );
};

// 股票卡片組件
const StockCard: React.FC<{
    stock: StockInventory;
    upToDateStock?: StockInventory;
    activeDomain?: string | null;
    onSelected: () => void;
    klineData?: CandleData[];
    isKlineLoading?: boolean;
    onRefreshKline?: () => void;
}> = ({ stock, upToDateStock, activeDomain, onSelected, klineData, isKlineLoading, onRefreshKline }) => {
    const price = typeof stock.price === 'number' ? stock.price : 0;
    const lastPrice = typeof stock.lastPrice === 'number' ? stock.lastPrice : price;
    const change = typeof stock.change === 'number' ? stock.change : 0;
    const changePercent = typeof stock.changePercent === 'number' ? stock.changePercent : 0;
    const open = typeof stock.open === 'number' ? stock.open : price;
    const high = typeof stock.high === 'number' ? stock.high : price;
    const low = typeof stock.low === 'number' ? stock.low : price;
    const volume = typeof stock.volume === 'number' ? stock.volume : 0;
    const avgPrice = typeof stock.avgPrice === 'number' ? stock.avgPrice : price;
    const referencePrice = typeof stock.referencePrice === 'number' ? stock.referencePrice : 
                          (typeof stock.previousClose === 'number' ? stock.previousClose : undefined);

    // 處理 averageCost 可能是字符串的情況
    let averageCost = 0;
    if (stock.cost) {
        if (typeof stock.cost.averageCost === 'number') {
            averageCost = stock.cost.averageCost;
        } else if (typeof stock.cost.averageCost === 'string') {
            averageCost = parseFloat(stock.cost.averageCost);
            if (isNaN(averageCost)) averageCost = 0;
        }
    }
    
    const quantity = stock.cost && typeof stock.cost.quantity === 'number' ? stock.cost.quantity : 0;
    const profit = typeof stock.profit === 'number' ? stock.profit : 0;
    const profitPercent = typeof stock.profitPercent === 'number' ? stock.profitPercent : 0;

    return (
        <div 
            className={`stock-card ${upToDateStock ? 'flash-update' : ''}`} 
            onClick={onSelected}
            style={{ cursor: 'pointer' }}
        >
            <div className="stock-header">
                <div className="stock-info">
                    <div className="stock-title-row">
                        <span className="stock-name">{stock.name}</span>
                        <span className="stock-symbol">{stock.symbol}</span>
                    </div>
                    <div className="stock-price-row">
                        <div className="stock-chart-container">
                            <KLineBar
                                open={open}
                                high={high}
                                low={low}
                                close={lastPrice || price}
                                width={15}
                                height={18}
                            />
                        </div>
                        <div className="price-info">
                            <div className="price-main">
                                <div className="stock-price">{formatNumber(lastPrice || price)}</div>
                            </div>
                            <div className="price-change">
                                <div className={`stock-change ${change >= 0 ? 'profit-up' : 'profit-down'}`}>
                                    <span className="change-arrow">
                                        {change >= 0 ? '▲' : '▼'}
                                    </span>
                                    <span className="change-value">
                                        {formatNumber(Math.abs(change))}
                                    </span>
                                </div>
                                <div className={`change-percent ${change >= 0 ? 'profit-up' : 'profit-down'}`}>
                                    {formatPercent(changePercent)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 使用折線圖代替 K 線圖，並傳入change參數和referencePrice */}
            <div className="stock-kline-container">
                <div className="mini-kline-container" onClick={(e) => e.stopPropagation()}>
                    <MiniLineChart 
                        candles={klineData} 
                        width={280} 
                        height={60} 
                        isLoading={isKlineLoading}
                        onRefresh={onRefreshKline}
                        change={change}
                        referencePrice={referencePrice}
                    />
                </div>
            </div>

            <div className="stock-actions">
                <div className="menu-container">
                    <button 
                        className="menu-button" 
                        onClick={(e) => {
                            e.stopPropagation(); // 阻止事件冒泡
                            onSelected();
                        }}
                    >
                        <BsThreeDotsVertical />
                    </button>
                    {activeDomain === stock.symbol && (
                        <div className="menu-dropdown">
                            <button 
                                className="menu-item" 
                                onClick={(e) => {
                                    e.stopPropagation(); // 阻止事件冒泡
                                    onSelected();
                                }}
                            >
                                設定成本
                            </button>
                            <button 
                                className="menu-item" 
                                onClick={(e) => {
                                    e.stopPropagation(); // 阻止事件冒泡
                                    onSelected();
                                }}
                            >
                                設定價格提醒
                            </button>
                            <button 
                                className="menu-item delete" 
                                onClick={(e) => {
                                    e.stopPropagation(); // 阻止事件冒泡
                                    onSelected();
                                }}
                            >
                                刪除
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const CardView: React.FC<CardViewProps> = ({
    stocks,
    updatedStocks,
    activeMenu,
    handleStockClick,
    handleMenuClick,
    handleSetCost,
    handleSetAlert,
    handleDelete,
    klineData,
    loadingKline,
    handleRefreshKline,
}) => {
    return (
        <div className="stock-grid">
            {stocks.map((stock) => (
                <StockCard 
                    key={stock.symbol} 
                    stock={stock}
                    upToDateStock={updatedStocks.has(stock.symbol) ? stock : undefined}
                    activeDomain={activeMenu}
                    onSelected={() => handleStockClick(stock)}
                    klineData={klineData?.[stock.symbol]}
                    isKlineLoading={loadingKline}
                    onRefreshKline={handleRefreshKline}
                />
            ))}
        </div>
    );
};

export default CardView; 