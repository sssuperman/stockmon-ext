import React, { useState, useRef, useEffect } from 'react';
import { VSCodeButton, VSCodeDivider } from '@vscode/webview-ui-toolkit/react';
import { StockInventory } from '../../../src/types';
import { vscode } from '../utilities/vscode';
import './StockList.css';

interface StockListProps {
    stocks: StockInventory[];
    onDelete: (symbol: string) => void;
    twseIndex: StockInventory | null;
}

export const StockList: React.FC<StockListProps> = ({ stocks, onDelete, twseIndex }) => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const prevStocksRef = useRef(stocks);
    const prevIndexRef = useRef(twseIndex);
    const [updatedStocks, setUpdatedStocks] = useState<Set<string>>(new Set());
    const [updatedIndex, setUpdatedIndex] = useState<boolean>(false);


    useEffect(() => {
        // 檢查是否有新的或更新的股票
        const newUpdates = new Set<string>();
        stocks.forEach(stock => {
            const prevStock = prevStocksRef.current.find(s => s.symbol === stock.symbol);
            if (!prevStock || prevStock.price !== stock.price) {
                newUpdates.add(stock.symbol);
            }
        });

        // 檢查指數是否更新
        if (twseIndex && prevIndexRef.current?.price !== twseIndex.price) {
            setUpdatedIndex(true);
            setTimeout(() => {
                setUpdatedIndex(false);
            }, 1000);
        }

        if (newUpdates.size > 0) {
            setUpdatedStocks(newUpdates);
            setTimeout(() => {
                setUpdatedStocks(new Set());
            }, 1000);
        }

        prevStocksRef.current = stocks;
        prevIndexRef.current = twseIndex;
    }, [stocks, twseIndex]);

    // 添加調試信息輸出
    useEffect(() => {
        console.log('StockList received twseIndex:', twseIndex);
        console.log('StockList received stocks:', stocks);
    }, [twseIndex, stocks]);

    const handleMenuClick = (symbol: string) => {
        setActiveMenu(activeMenu === symbol ? null : symbol);
    };

    const handleSetCost = (symbol: string) => {
        vscode.postMessage({ 
            command: 'setCost',
            symbol: symbol 
        });
        setActiveMenu(null);
    };

    const handleSetAlert = (symbol: string) => {
        vscode.postMessage({ command: 'setPriceAlert', symbol });
        setActiveMenu(null);
    };

    const handleDelete = (symbol: string) => {
        vscode.postMessage({ 
            command: 'confirmDelete',
            symbol: symbol 
        });
        setActiveMenu(null);
    };

    const formatNumber = (num: number) => {
        return num.toFixed(2);
    };

    const formatPercent = (num: number) => {
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

    // 新增顯示格式化函數
    const formatVolume = (volume: number) => {
        if (volume >= 1000000) {
            return `${(volume / 1000000).toFixed(2)}M`;
        }
        if (volume >= 1000) {
            return `${(volume / 1000).toFixed(0)}K`;
        }
        return volume.toString();
    };

    const formatTime = (time: string | number) => {
        if (typeof time === 'number') {
            return new Date(time * 1000).toLocaleTimeString();
        }
        return time;
    };

    // 渲染台股指數的組件
    const IndexCard = () => {
        if (!twseIndex) return null;

        return (
            <div className={`index-card ${updatedIndex ? 'flash-update' : ''}`}>
                <div className="stock-header">
                    <div className="stock-info">
                        <div className="stock-title-row">
                            <span className="stock-name">{twseIndex.name}</span>
                            <span className="stock-volume">
                                成交量: {(twseIndex.volume / 1000).toFixed(0)}K
                            </span>
                        </div>
                        <div className="stock-price-row">
                            <div className="stock-chart-container">
                                {twseIndex.open !== undefined && (
                                    <KLineBar
                                        open={twseIndex.open}
                                        high={twseIndex.high}
                                        low={twseIndex.low}
                                        close={twseIndex.price}
                                        width={15}
                                        height={18}
                                    />
                                )}
                            </div>
                            <div className="price-info">
                                <div className="price-main">
                                    <div className="stock-price">{formatNumber(twseIndex.price)}</div>
                                </div>
                                <div className="price-change">
                                    <div className={`stock-change ${twseIndex.change >= 0 ? 'profit-up' : 'profit-down'}`}>
                                        <span className="change-arrow">
                                            {twseIndex.change >= 0 ? '▲' : '▼'}
                                        </span>
                                        <span className="change-value">
                                            {formatNumber(Math.abs(twseIndex.change))}
                                        </span>
                                    </div>
                                    <div className={`change-percent ${twseIndex.change >= 0 ? 'profit-up' : 'profit-down'}`}>
                                        {formatPercent(twseIndex.changePercent)}
                                    </div>
                                </div>
                            </div>
                            <div className="price-details">
                                <div>開:{formatNumber(twseIndex.open)}</div>
                                <div>高:{formatNumber(twseIndex.high)}</div>
                                <div>低:{formatNumber(twseIndex.low)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // 更新股票卡片內容
    const StockCard: React.FC<{ stock: StockInventory }> = ({ stock }) => {
        return (
            <div className={`stock-card ${updatedStocks.has(stock.symbol) ? 'flash-update' : ''}`}>
                <div className="stock-header">
                    <div className="stock-info">
                        <div className="stock-title-row">
                            <span className="stock-name">{stock.name}</span>
                            <span className="stock-symbol">{stock.symbol}</span>
                        </div>
                        <div className="stock-price-row">
                            <div className="stock-chart-container">
                                <KLineBar
                                    open={stock.open}
                                    high={stock.high}
                                    low={stock.low}
                                    close={stock.lastPrice || stock.price}
                                    width={15}
                                    height={18}
                                />
                            </div>
                            <div className="price-info">
                                <div className="price-main">
                                    <div className="stock-price">{formatNumber(stock.lastPrice || stock.price)}</div>
                                </div>
                                <div className="price-change">
                                    <div className={`stock-change ${stock.change >= 0 ? 'profit-up' : 'profit-down'}`}>
                                        <span className="change-arrow">
                                            {stock.change >= 0 ? '▲' : '▼'}
                                        </span>
                                        <span className="change-value">{formatNumber(Math.abs(stock.change))}</span>
                                    </div>
                                    <div className={`change-percent ${stock.change >= 0 ? 'profit-up' : 'profit-down'}`}>
                                        {formatPercent(stock.changePercent)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 新增交易資訊區域 */}
                <div className="trading-info">
                    <div className="price-details">
                        <div>開:{formatNumber(stock.open)}</div>
                        <div>高:{formatNumber(stock.high)}</div>
                        <div>低:{formatNumber(stock.low)}</div>
                    </div>
                    <div className="volume-info">
                        <div>量:{formatVolume(stock.volume)}</div>
                        <div>均價:{formatNumber(stock.avgPrice)}</div>
                    </div>
                    {stock.lastTrade && (
                        <div className="last-trade">
                            <div>最新:{formatNumber(stock.lastTrade.price)}</div>
                            <div>張數:{stock.lastTrade.size || '-'}</div>
                            <div>時間:{formatTime(stock.lastTrade.time)}</div>
                        </div>
                    )}
                </div>

                {/* 五檔價格資訊 */}
                {(stock.bids?.length > 0 || stock.asks?.length > 0) && (
                    <div className="order-book">
                        <div className="asks">
                            {stock.asks?.slice(0, 5).map((ask, index) => (
                                <div key={`ask-${index}`} className="order-row">
                                    <span>{formatNumber(ask.price)}</span>
                                    <span>{ask.size}</span>
                                </div>
                            ))}
                        </div>
                        <div className="bids">
                            {stock.bids?.slice(0, 5).map((bid, index) => (
                                <div key={`bid-${index}`} className="order-row">
                                    <span>{formatNumber(bid.price)}</span>
                                    <span>{bid.size}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 成本和獲利資訊 */}
                {stock.cost && (
                    <div className="stock-details">
                        <div className="cost-info">
                            <div>成本: {formatNumber(stock.cost.averageCost)}</div>
                            <div>股數: {stock.cost.quantity}</div>
                        </div>
                        {stock.profit !== undefined && stock.profitPercent !== undefined && (
                            <div className={`profit-info ${stock.profit >= 0 ? 'profit-up' : 'profit-down'}`}>
                                <div>損益: {formatNumber(stock.profit)}</div>
                                <div>({formatPercent(stock.profitPercent)})</div>
                            </div>
                        )}
                    </div>
                )}

                <div className="stock-actions">
                    <div className="menu-container">
                        <VSCodeButton
                            appearance="icon"
                            onClick={() => handleMenuClick(stock.symbol)}
                            aria-label="More options"
                        >
                            ⋮
                        </VSCodeButton>
                        {activeMenu === stock.symbol && (
                            <div className="menu-dropdown">
                                <VSCodeButton onClick={() => handleSetCost(stock.symbol)}>
                                    Set Cost
                                </VSCodeButton>
                                <VSCodeButton onClick={() => handleSetAlert(stock.symbol)}>
                                    Set Alert
                                </VSCodeButton>
                                <VSCodeButton onClick={() => handleDelete(stock.symbol)}>
                                    Delete
                                </VSCodeButton>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="stock-container">
            <div className="index-section">
                <IndexCard />
            </div>
            <VSCodeDivider />
            <div className="stock-grid">
                {stocks.map((stock) => (
                    <StockCard key={stock.symbol} stock={stock} />
                ))}
            </div>
        </div>
    );
}; 