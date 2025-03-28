import React from 'react';
import { StockInventory } from '../../../src/types';
import { BsThreeDotsVertical } from 'react-icons/bs';

interface CardViewProps {
    stocks: StockInventory[];
    updatedStocks: Set<string>;
    activeMenu: string | null;
    handleStockClick: (stock: StockInventory) => void;
    handleMenuClick: (symbol: string) => void;
    handleSetCost: (symbol: string) => void;
    handleSetAlert: (symbol: string) => void;
    handleDelete: (symbol: string) => void;
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

// 股票卡片組件
const StockCard: React.FC<{ stock: StockInventory; isUpdated: boolean; onStockClick: (stock: StockInventory) => void; onMenuClick: (symbol: string) => void; activeMenu: string | null; onSetCost: (symbol: string) => void; onSetAlert: (symbol: string) => void; onDelete: (symbol: string) => void }> = ({ 
    stock, 
    isUpdated, 
    onStockClick, 
    onMenuClick, 
    activeMenu, 
    onSetCost, 
    onSetAlert, 
    onDelete 
}) => {
    const price = typeof stock.price === 'number' ? stock.price : 0;
    const lastPrice = typeof stock.lastPrice === 'number' ? stock.lastPrice : price;
    const change = typeof stock.change === 'number' ? stock.change : 0;
    const changePercent = typeof stock.changePercent === 'number' ? stock.changePercent : 0;
    const open = typeof stock.open === 'number' ? stock.open : price;
    const high = typeof stock.high === 'number' ? stock.high : price;
    const low = typeof stock.low === 'number' ? stock.low : price;
    const volume = typeof stock.volume === 'number' ? stock.volume : 0;
    const avgPrice = typeof stock.avgPrice === 'number' ? stock.avgPrice : price;

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
            className={`stock-card ${isUpdated ? 'flash-update' : ''}`} 
            onClick={() => onStockClick(stock)}
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

            <div className="stock-actions">
                <div className="menu-container">
                    <button 
                        className="menu-button" 
                        onClick={(e) => {
                            e.stopPropagation(); // 阻止事件冒泡
                            onMenuClick(stock.symbol);
                        }}
                    >
                        <BsThreeDotsVertical />
                    </button>
                    {activeMenu === stock.symbol && (
                        <div className="menu-dropdown">
                            <button 
                                className="menu-item" 
                                onClick={(e) => {
                                    e.stopPropagation(); // 阻止事件冒泡
                                    onSetCost(stock.symbol);
                                }}
                            >
                                設定成本
                            </button>
                            <button 
                                className="menu-item" 
                                onClick={(e) => {
                                    e.stopPropagation(); // 阻止事件冒泡
                                    onSetAlert(stock.symbol);
                                }}
                            >
                                設定價格提醒
                            </button>
                            <button 
                                className="menu-item delete" 
                                onClick={(e) => {
                                    e.stopPropagation(); // 阻止事件冒泡
                                    onDelete(stock.symbol);
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
}) => {
    return (
        <div className="stock-grid">
            {stocks.map((stock) => (
                <StockCard 
                    key={stock.symbol} 
                    stock={stock} 
                    isUpdated={updatedStocks.has(stock.symbol)}
                    onStockClick={handleStockClick}
                    onMenuClick={handleMenuClick}
                    activeMenu={activeMenu}
                    onSetCost={handleSetCost}
                    onSetAlert={handleSetAlert}
                    onDelete={handleDelete}
                />
            ))}
        </div>
    );
};

export default CardView; 