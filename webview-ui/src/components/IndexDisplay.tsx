import React from 'react';
import { StockInventory, IndiceData } from '../../../src/types';

interface IndexDisplayProps {
    twseIndex: StockInventory | null;
    stocks: StockInventory[];
    updatedIndices: Record<string, boolean>;
    onStockClick: (stock: StockInventory) => void;
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

const formatVolume = (volume: any): string => {
    if (typeof volume !== 'number' || isNaN(volume)) {
        return '0';
    }
    
    if (volume >= 1000000) {
        return `${(volume / 1000000).toFixed(2)}M`;
    }
    if (volume >= 1000) {
        return `${(volume / 1000).toFixed(0)}K`;
    }
    return volume.toString();
};

// K 棒圖元件
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
    const barWidth = width * 0.6;
    const barX = (width - barWidth) / 2;

    return (
        <svg width={width} height={height}>
            <line
                x1={width / 2}
                y1={lineY}
                x2={width / 2}
                y2={lineHeight}
                stroke={barColor}
                strokeWidth="1"
            />
            <rect
                x={barX}
                y={barY}
                width={barWidth}
                height={Math.max(1, barHeight)}
                fill={barColor}
            />
        </svg>
    );
};

// 台股指數卡片
const IndexCard: React.FC<{ 
    stock: StockInventory; 
    isUpdated: boolean; 
    onStockClick: (stock: StockInventory) => void 
}> = ({ stock, isUpdated, onStockClick }) => {
    const price = typeof stock.price === 'number' ? stock.price : 0;
    const change = typeof stock.change === 'number' ? stock.change : 0;
    const changePercent = typeof stock.changePercent === 'number' ? stock.changePercent : 0;
    const volume = typeof stock.volume === 'number' ? stock.volume : 0;
    const open = typeof stock.open === 'number' ? stock.open : price;
    const high = typeof stock.high === 'number' ? stock.high : price;
    const low = typeof stock.low === 'number' ? stock.low : price;

    return (
        <div 
            className={`index-card ${isUpdated ? 'flash-update' : ''}`}
            onClick={() => onStockClick(stock)}
            style={{ cursor: 'pointer' }}
        >
            <div className="stock-header">
                <div className="stock-info">
                    <div className="stock-title-row">
                        <span className="stock-name">{stock.name}</span>
                        <span className="stock-symbol">{stock.symbol}</span>
                    </div>
                </div>
                <div className="stock-price-row">
                    <div className="stock-chart-container">
                        {open !== undefined && (
                            <KLineBar
                                open={open}
                                high={high}
                                low={low}
                                close={price}
                                width={15}
                                height={18}
                            />
                        )}
                    </div>
                    <div className="price-info">
                        <div className="price-main">
                            <div className="stock-price">{formatNumber(price)}</div>
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
                <div className="stock-volume">
                    成交量: {formatVolume(volume)}
                </div>
            </div>
        </div>
    );
};

// 總體損益摘要組件
const SummarySection: React.FC<{ stocks: StockInventory[] }> = ({ stocks }) => {
    // 計算總體今日損益和總損益
    const calculateTotalProfits = () => {
        let totalDailyProfit = 0;
        let totalProfit = 0;
        let totalInvestment = 0;
        let totalMarketValue = 0;

        stocks.forEach(stock => {
            const quantity = stock.cost?.quantity || 0;
            const price = typeof stock.price === 'number' ? stock.price : 0;
            const change = typeof stock.change === 'number' ? stock.change : 0;
            const profit = typeof stock.profit === 'number' ? stock.profit : 0;
            
            // 計算今日損益 = 股數 * 漲跌幅
            const dailyProfit = quantity * change;
            totalDailyProfit += dailyProfit;
            
            // 累計總損益
            totalProfit += profit;
            
            // 計算總投資成本和市值
            if (stock.cost) {
                const averageCost = typeof stock.cost.averageCost === 'number' 
                    ? stock.cost.averageCost 
                    : typeof stock.cost.averageCost === 'string' 
                        ? parseFloat(stock.cost.averageCost) 
                        : 0;
                
                totalInvestment += averageCost * quantity;
                totalMarketValue += price * quantity;
            }
        });

        // 計算總體損益百分比
        const totalProfitPercent = totalInvestment > 0 
            ? (totalProfit / totalInvestment) * 100 
            : 0;
        
        // 計算今日損益百分比
        const totalDailyProfitPercent = totalInvestment > 0 
            ? (totalDailyProfit / totalInvestment) * 100 
            : 0;

        return {
            totalDailyProfit,
            totalDailyProfitPercent,
            totalProfit,
            totalProfitPercent,
            totalInvestment,
            totalMarketValue
        };
    };
    
    const {
        totalDailyProfit,
        totalDailyProfitPercent,
        totalProfit,
        totalProfitPercent,
        totalInvestment,
        totalMarketValue
    } = calculateTotalProfits();

    // 如果沒有持股，不顯示摘要
    if (stocks.length === 0 || !stocks.some(stock => stock.cost && stock.cost.quantity > 0)) {
        return null;
    }

    return (
        <div className="portfolio-summary">
            <div className="summary-container">
                {/* 今日損益區塊 */}
                <div className="summary-block">
                    <div className="summary-title">
                        今日損益
                        <span className="summary-icon">
                            <svg width="16" height="16" viewBox="0 0 16 16">
                                <rect x="2" y="2" width="3" height="12" fill={totalDailyProfit >= 0 ? "var(--vscode-terminal-ansiRed)" : "var(--vscode-terminal-ansiGreen)"} />
                                <rect x="6" y="5" width="3" height="9" fill={totalDailyProfit >= 0 ? "var(--vscode-terminal-ansiRed)" : "var(--vscode-terminal-ansiGreen)"} />
                                <rect x="10" y="8" width="3" height="6" fill={totalDailyProfit >= 0 ? "var(--vscode-terminal-ansiRed)" : "var(--vscode-terminal-ansiGreen)"} />
                            </svg>
                        </span>
                    </div>
                    <div className={`summary-amount ${totalDailyProfit >= 0 ? 'profit-up' : 'profit-down'}`}>
                        {totalDailyProfit >= 0 ? '+' : ''}{formatNumber(totalDailyProfit)}
                    </div>
                    <div className={`summary-percent ${totalDailyProfit >= 0 ? 'profit-up' : 'profit-down'}`}>
                        {formatPercent(totalDailyProfitPercent)}
                    </div>
                </div>

                {/* 累積損益區塊 */}
                <div className="summary-block">
                    <div className="summary-title">
                        累積損益
                        <span className="summary-icon">
                            <svg width="16" height="16" viewBox="0 0 16 16">
                                <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                                <path 
                                    d={`M8,2 A6,6 0 ${totalProfit >= 0 ? '0,1' : '0,0'} 8,14 A6,6 0 ${totalProfit >= 0 ? '0,1' : '0,0'} 8,2`} 
                                    fill={totalProfit >= 0 ? "var(--vscode-terminal-ansiRed)" : "var(--vscode-terminal-ansiGreen)"} 
                                />
                            </svg>
                        </span>
                    </div>
                    <div className={`summary-amount ${totalProfit >= 0 ? 'profit-up' : 'profit-down'}`}>
                        {totalProfit >= 0 ? '+' : ''}{formatNumber(totalProfit)}
                    </div>
                    <div className={`summary-percent ${totalProfit >= 0 ? 'profit-up' : 'profit-down'}`}>
                        {formatPercent(totalProfitPercent)}
                    </div>
                </div>

                {/* 股票市值區塊 */}
                <div className="summary-block">
                    <div className="summary-title">
                        股票市值
                        <span className="summary-icon">
                            <svg width="16" height="16" viewBox="0 0 16 16">
                                <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                                <path 
                                    d={`M8,2 A6,6 0 0,1 14,8 A6,6 0 0,1 8,14`} 
                                    fill="var(--vscode-terminal-ansiRed)" 
                                    opacity="0.7"
                                />
                                <path 
                                    d={`M8,2 A6,6 0 0,0 2,8 A6,6 0 0,0 8,14`} 
                                    fill="var(--vscode-terminal-ansiGreen)" 
                                    opacity="0.7"
                                />
                            </svg>
                        </span>
                    </div>
                    <div className="summary-amount">
                        {formatNumber(totalMarketValue)}
                    </div>
                    <div className="summary-cost">
                        成本 {formatNumber(totalInvestment)}
                    </div>
                </div>
            </div>
        </div>
    );
};

export const IndexDisplay: React.FC<IndexDisplayProps> = ({
    twseIndex,
    stocks,
    updatedIndices,
    onStockClick,
}) => {
    return (
        <>
            <div className="index-section">
                {/* 只显示TWSE加權指數 */}
                {twseIndex && (
                    <IndexCard 
                        stock={twseIndex} 
                        isUpdated={updatedIndices[twseIndex.symbol]} 
                        onStockClick={onStockClick} 
                    />
                )}
            </div>
            
            {/* 添加總體損益摘要區塊 */}
            <SummarySection stocks={stocks} />
        </>
    );
};

export default IndexDisplay; 