import React from 'react';
import { VSCodeButton, VSCodeDivider } from '@vscode/webview-ui-toolkit/react';
import { StockInventory } from '../types';
import './StockList.css'; // Reusing the same CSS
import { BsArrowLeft } from 'react-icons/bs';

interface StockDetailProps {
    stock: StockInventory;
    onBack: () => void;
}

export const StockDetail: React.FC<StockDetailProps> = ({ stock, onBack }) => {
    console.log('Rendering StockDetail with stock:', stock);
    
    const handleBack = () => {
        console.log('Back button clicked');
        onBack();
    };

    const formatNumber = (num: any): string => {
        if (typeof num !== 'number' || isNaN(num)) {
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

    const formatVolume = (volume: any): string => {
        if (typeof volume !== 'number' || isNaN(volume)) {
            return '0';
        }
        if (volume >= 1000000) {
            return `${(volume / 1000000).toFixed(2)}M`;
        } else if (volume >= 1000) {
            return `${(volume / 1000).toFixed(0)}K`;
        }
        return volume.toString();
    };

    // 計算內外盤比例
    const calculateMarketRatio = () => {
        // 使用可選鏈和默認值處理可能不存在的屬性
        // 優先使用直接的 inVolume 和 outVolume，如果不存在則從 total 中獲取
        const inVolume = stock.inVolume ?? stock.total?.tradeVolumeAtBid ?? 0;
        const outVolume = stock.outVolume ?? stock.total?.tradeVolumeAtAsk ?? 0;
        const totalVolume = inVolume + outVolume;
        
        if (totalVolume === 0) {
            return { inRatio: 50, outRatio: 50 };
        }
        
        const inRatio = Math.round((inVolume / totalVolume) * 100);
        const outRatio = 100 - inRatio;
        
        return { inRatio, outRatio };
    };

    // 五檔資料視覺化組件
    const OrderBookVisual: React.FC<{
        bids: Array<{ price: number; size: number }>;
        asks: Array<{ price: number; size: number }>;
    }> = ({ bids, asks }) => {
        // 分別計算買賣方的最大量，確保兩邊的比例一致
        const maxBidSize = Math.max(...bids.map(b => b.size), 1);
        const maxAskSize = Math.max(...asks.map(a => a.size), 1);
        const maxSize = Math.max(maxBidSize, maxAskSize);

        const getBarWidth = (size: number) => {
            // 降低最大寬度為60%，並設定最小寬度
            const percentage = (size / maxSize) * 60;
            // 如果數量很小，返回較小的寬度
            if (percentage < 10) {
                return `${Math.max(percentage, 8)}%`;
            }
            return `${percentage}%`;
        };

        // 計算委買委賣總量
        const totalBidSize = bids.reduce((sum, bid) => sum + bid.size, 0);
        const totalAskSize = asks.reduce((sum, ask) => sum + ask.size, 0);
        
        // 計算委買委賣比例
        const totalSize = totalBidSize + totalAskSize;
        const bidRatio = totalSize > 0 ? Math.round((totalBidSize / totalSize) * 100) : 50;
        const askRatio = totalSize > 0 ? Math.round((totalAskSize / totalSize) * 100) : 50;

        return (
            <div className="order-book-container">
                {/* 內外盤比例顯示 */}
                <div className="market-ratio-bar">
                    <div 
                        className="in-volume-ratio" 
                        style={{ width: `${calculateMarketRatio().inRatio}%` }}
                    >
                        {calculateMarketRatio().inRatio}%
                    </div>
                    <div 
                        className="out-volume-ratio" 
                        style={{ width: `${calculateMarketRatio().outRatio}%` }}
                    >
                        {calculateMarketRatio().outRatio}%
                    </div>
                </div>
                
                {/* 委買委賣標題 */}
                <div className="order-book-header">
                    <div className="header-cell">委買量</div>
                    <div className="header-cell">買價</div>
                    <div className="header-cell">賣價</div>
                    <div className="header-cell">委賣量</div>
                </div>
                
                {/* 五檔資料 */}
                <div className="order-book-rows">
                    {Array.from({ length: 5 }).map((_, index) => {
                        const bid = bids[index] || { price: 0, size: 0 };
                        const ask = asks[index] || { price: 0, size: 0 };
                        return (
                            <div key={index} className="order-row">
                                <div className="size-cell bid-cell">
                                    {bid.size > 0 && (
                                        <div 
                                            className="size-bar bid-bar" 
                                            style={{ width: getBarWidth(bid.size) }}
                                        >
                                            {bid.size}
                                        </div>
                                    )}
                                </div>
                                <div className="price-cell bid-price">
                                    {bid.price > 0 && formatNumber(bid.price)}
                                </div>
                                <div className="price-cell ask-price">
                                    {ask.price > 0 && formatNumber(ask.price)}
                                </div>
                                <div className="size-cell ask-cell">
                                    {ask.size > 0 && (
                                        <div 
                                            className="size-bar ask-bar" 
                                            style={{ width: getBarWidth(ask.size) }}
                                        >
                                            {ask.size}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                
                {/* 委買委賣總量 */}
                <div className="order-book-summary">
                    <div className="bid-total">
                        {totalBidSize} ({bidRatio}%)
                    </div>
                    <div className="summary-spacer"></div>
                    <div className="ask-total">
                        ({askRatio}%) {totalAskSize}
                    </div>
                </div>
            </div>
        );
    };

    // 計算振幅
    const calculateAmplitude = () => {
        if (!stock.high || !stock.low || !stock.referencePrice) return 0;
        const range = stock.high - stock.low;
        return (range / stock.referencePrice) * 100;
    };

    // 計算量縮
    const calculateVolumeChange = () => {
        const volume = stock.volume ?? 0;
        const previousVolume = stock.previousVolume ?? 0;
        
        if (previousVolume === 0) return 0;
        
        return ((volume - previousVolume) / previousVolume) * 100;
    };

    // 計算高低價差
    const calculateHighLowDiff = () => {
        if (!stock.high || !stock.low) return 0;
        return stock.high - stock.low;
    };

    return (
        <div className="stock-detail">
            <div className="detail-header">
                <VSCodeButton appearance="icon" onClick={handleBack} aria-label="Back">
                    <BsArrowLeft />
                </VSCodeButton>
                <h2>{stock.name} ({stock.symbol})</h2>
            </div>

            {/* 五檔資料區域 */}
            {(stock.bids && stock.asks && (stock.bids.length > 0 || stock.asks.length > 0)) && (
                <div className="detail-section">
                    <OrderBookVisual 
                        bids={stock.bids || []}
                        asks={stock.asks || []}
                    />
                </div>
            )}

            {/* 交易資訊區域 */}
            <div className="detail-section trading-info-grid">
                <div className="trading-info-row">
                    <div className="trading-info-item">
                        <div className="info-label">單量</div>
                        <div className="info-value">{formatVolume(stock.lastTrade?.size ?? 0)}</div>
                    </div>
                    <div className="trading-info-item">
                        <div className="info-label">倉量</div>
                        <div className="info-value">{formatVolume(stock.volume ?? 0)}</div>
                    </div>
                </div>
                <div className="trading-info-row">
                    <div className="trading-info-item">
                        <div className="info-label">總量</div>
                        <div className="info-value">{formatVolume(stock.volume ?? 0)}</div>
                    </div>
                    <div className="trading-info-item">
                        <div className="info-label">量縮</div>
                        <div className="info-value">{formatPercent(calculateVolumeChange())}</div>
                    </div>
                </div>
                <div className="trading-info-row">
                    <div className="trading-info-item">
                        <div className="info-label">振幅</div>
                        <div className="info-value">{formatPercent(calculateAmplitude())}</div>
                    </div>
                    <div className="trading-info-item">
                        <div className="info-label">高低價差</div>
                        <div className="info-value">{formatNumber(calculateHighLowDiff())}</div>
                    </div>
                </div>
                <div className="trading-info-row">
                    <div className="trading-info-item">
                        <div className="info-label">開盤</div>
                        <div className={`info-value ${(stock.open ?? 0) >= (stock.referencePrice ?? 0) ? 'profit-up' : 'profit-down'}`}>
                            {formatNumber(stock.open ?? 0)}
                        </div>
                    </div>
                    <div className="trading-info-item">
                        <div className="info-label">參考價</div>
                        <div className="info-value">{formatNumber(stock.referencePrice ?? 0)}</div>
                    </div>
                </div>
                <div className="trading-info-row">
                    <div className="trading-info-item">
                        <div className="info-label">最高</div>
                        <div className="info-value profit-up">{formatNumber(stock.high ?? 0)}</div>
                    </div>
                    <div className="trading-info-item">
                        <div className="info-label">最低</div>
                        <div className="info-value profit-down">{formatNumber(stock.low ?? 0)}</div>
                    </div>
                </div>
            </div>

            {/* 內外盤資訊 */}
            <div className="detail-section">
                <div className="market-info-grid">
                    <div className="market-info-item">
                        <div className="info-label">內盤</div>
                        <div className="info-value profit-up">{formatVolume(stock.inVolume ?? stock.total?.tradeVolumeAtBid ?? 0)}</div>
                    </div>
                    <div className="market-info-item">
                        <div className="info-label">外盤</div>
                        <div className="info-value profit-down">{formatVolume(stock.outVolume ?? stock.total?.tradeVolumeAtAsk ?? 0)}</div>
                    </div>
                    <div className="market-info-item">
                        <div className="info-label">中立盤</div>
                        <div className="info-value">{formatVolume(stock.neutralVolume ?? (stock.volume ?? 0) - (stock.inVolume ?? stock.total?.tradeVolumeAtBid ?? 0) - (stock.outVolume ?? stock.total?.tradeVolumeAtAsk ?? 0))}</div>
                    </div>
                </div>
            </div>
        </div>
    );
};