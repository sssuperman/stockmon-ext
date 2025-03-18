import React, { useState, useRef, useEffect } from 'react';
import { VSCodeButton, VSCodeDivider } from '@vscode/webview-ui-toolkit/react';
import { StockInventory, IndiceData } from '../../../src/types';
import { vscode } from '../utilities/vscode';
import './StockList.css';
import { BsGrid3X3GapFill, BsTable, BsPlusCircle, BsThreeDotsVertical } from 'react-icons/bs';
import { IndiceBar } from './IndiceBar';

interface StockListProps {
    stocks: StockInventory[];
    onDelete: (symbol: string) => void;
    twseIndex: StockInventory | null;
    onSelectStock: (stock: StockInventory) => void;
    indices?: Record<string, IndiceData>;
}

export const StockList: React.FC<StockListProps> = ({ 
    stocks, 
    onDelete, 
    twseIndex, 
    onSelectStock,
    indices = {} 
}) => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const prevStocksRef = useRef(stocks);
    const prevIndexRef = useRef(twseIndex);
    const prevIndicesRef = useRef<Record<string, IndiceData>>({});
    const [updatedStocks, setUpdatedStocks] = useState<Set<string>>(new Set());
    const [updatedIndices, setUpdatedIndices] = useState<Record<string, boolean>>({});
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');

    useEffect(() => {
        // 檢查是否有新的或更新的股票
        const newUpdates = new Set<string>();
        stocks.forEach(stock => {
            const prevStock = prevStocksRef.current.find(s => s.symbol === stock.symbol);
            if (!prevStock || prevStock.price !== stock.price) {
                newUpdates.add(stock.symbol);
            }
        });

        // 檢查指數是否更新（只在加权指数实际更新时标记）
        if (twseIndex && prevIndexRef.current?.price !== twseIndex.price) {
            setUpdatedIndices(prev => ({
                ...prev,
                [twseIndex.symbol]: true
            }));
            
            // 一段时间后清除更新标记
            setTimeout(() => {
                setUpdatedIndices(prev => {
                    const newState = {...prev};
                    delete newState[twseIndex.symbol];
                    return newState;
                });
            }, 1000);
        }
        
        // 检查其他指数是否更新
        Object.entries(indices).forEach(([symbol, indice]) => {
            const prevIndice = prevIndicesRef.current[symbol];
            if (!prevIndice || prevIndice.index !== indice.index) {
                setUpdatedIndices(prev => ({
                    ...prev,
                    [symbol]: true
                }));
                
                // 一段时间后清除更新标记
                setTimeout(() => {
                    setUpdatedIndices(prev => {
                        const newState = {...prev};
                        delete newState[symbol];
                        return newState;
                    });
                }, 1000);
            }
        });
        
        // 更新前一次的指数值
        prevIndicesRef.current = {...indices};
        
        // 更新前一次的加权指数值
        prevIndexRef.current = twseIndex;
        
        // 更新前一次的股票值
        prevStocksRef.current = stocks;

        if (newUpdates.size > 0) {
            setUpdatedStocks(newUpdates);
            setTimeout(() => {
                setUpdatedStocks(new Set());
            }, 1000);
        }
    }, [stocks, twseIndex, indices]);

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

    const handleStockClick = (stock: StockInventory) => {
        console.log('Stock clicked:', stock);
        onSelectStock(stock);
    };

    const formatNumber = (num: any): string => {
        if (typeof num !== 'number' || isNaN(num)) {
            // 嘗試將字符串轉換為數字
            if (typeof num === 'string') {
                const parsedNum = parseFloat(num);
                if (!isNaN(parsedNum)) {
                    return parsedNum.toFixed(2);
                }
            }
            console.warn(`formatNumber received non-number value: ${num} (${typeof num})`);
            return '0.00';
        }
        return num.toFixed(2);
    };

    const formatPercent = (num: any): string => {
        if (typeof num !== 'number' || isNaN(num)) {
            console.warn(`formatPercent received non-number value: ${num} (${typeof num})`);
            return '+0.00%';
        }
        return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
    };

    // 添加 formatVolume 函數
    const formatVolume = (volume: any): string => {
        if (typeof volume !== 'number' || isNaN(volume)) {
            console.warn(`formatVolume received non-number value: ${volume} (${typeof volume})`);
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

    // 添加 formatTime 函數
    const formatTime = (time: string | number): string => {
        if (typeof time === 'number') {
            return new Date(time * 1000).toLocaleTimeString();
        }
        return String(time);
    };

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

    // 新增總體損益摘要組件
    const SummarySection = () => {
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

    // 渲染台股指數的組件
    const IndexCard = ({ stock, isUpdated, onStockClick }: { stock: StockInventory; isUpdated: boolean; onStockClick: (stock: StockInventory) => void }) => {
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

    // 更新股票卡片內容
    const StockCard = ({ stock }: { stock: StockInventory }) => {
        const isUpdated = updatedStocks.has(stock.symbol);
        
        const price = typeof stock.price === 'number' ? stock.price : 0;
        const lastPrice = typeof stock.lastPrice === 'number' ? stock.lastPrice : price;
        const change = typeof stock.change === 'number' ? stock.change : 0;
        const changePercent = typeof stock.changePercent === 'number' ? stock.changePercent : 0;
        const open = typeof stock.open === 'number' ? stock.open : price;
        const high = typeof stock.high === 'number' ? stock.high : price;
        const low = typeof stock.low === 'number' ? stock.low : price;
        const volume = typeof stock.volume === 'number' ? stock.volume : 0;
        const avgPrice = typeof stock.avgPrice === 'number' ? stock.avgPrice : price;

        // 檢查成本數據
        console.log(`Stock ${stock.symbol} cost data:`, stock.cost);
        
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
                onClick={() => handleStockClick(stock)}
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
                                handleMenuClick(stock.symbol);
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
                                        handleSetAlert(stock.symbol);
                                    }}
                                >
                                    設定價格提醒
                                </button>
                                <button 
                                    className="menu-item delete" 
                                    onClick={(e) => {
                                        e.stopPropagation(); // 阻止事件冒泡
                                        handleDelete(stock.symbol);
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

    return (
        <div className="stock-container">
            {/* 添加 IndiceBar 組件 */}
            <IndiceBar indices={indices} />
            
            <div className="view-mode-toggle">
                <button 
                    className={`view-mode-button ${viewMode === 'card' ? 'active' : ''}`}
                    onClick={() => setViewMode('card')}
                    title="卡片視圖"
                >
                    <BsGrid3X3GapFill />
                </button>
                <button 
                    className={`view-mode-button ${viewMode === 'table' ? 'active' : ''}`}
                    onClick={() => setViewMode('table')}
                    title="表格視圖"
                >
                    <BsTable />
                </button>
                <button 
                    className="view-mode-button add-stock"
                    onClick={() => vscode.postMessage({ command: 'addStock' })}
                    title="添加股票"
                >
                    <BsPlusCircle />
                </button>
            </div>
            
            <div className="index-section">
                {/* 只显示TWSE加權指數 */}
                {twseIndex && (
                    <IndexCard 
                        stock={twseIndex} 
                        isUpdated={updatedIndices[twseIndex.symbol]} 
                        onStockClick={handleStockClick} 
                    />
                )}
            </div>
            
            {/* 添加總體損益摘要區塊 */}
            <SummarySection />
            
            <VSCodeDivider />

            {viewMode === 'card' ? (
                <div className="stock-grid">
                    {stocks.map((stock) => (
                        <StockCard key={stock.symbol} stock={stock} />
                    ))}
                </div>
            ) : (
                <table className="stock-table">
                    <thead>
                        <tr>
                            <th>庫存股</th>
                            <th>今日損益</th>
                            <th>總損益</th>
                            <th>股數</th>
                            <th className="price-header">
                                <div className="price-title">股價</div>
                                <div className="change-title">漲跌幅</div>
                            </th>
                            <th>成本</th>
                        </tr>
                    </thead>
                    <tbody>
                        {stocks.map((stock) => {
                            const price = typeof stock.price === 'number' ? stock.price : 0;
                            const change = typeof stock.change === 'number' ? stock.change : 0;
                            const changePercent = typeof stock.changePercent === 'number' ? stock.changePercent : 0;
                            
                            // 檢查成本數據
                            console.log(`Table row - Stock ${stock.symbol} cost data:`, stock.cost);
                            
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
                            
                            // 計算今日損益
                            // 直接使用股價漲跌幅與股數計算今日損益
                            const todayProfit = quantity * change;
                            
                            // 今日損益百分比就是股價漲跌幅
                            const todayProfitPercent = changePercent;
                            
                            return (
                                <tr 
                                    key={stock.symbol} 
                                    className={updatedStocks.has(stock.symbol) ? 'flash-update' : ''}
                                    onClick={() => handleStockClick(stock)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <td className="stock-name-symbol-cell">
                                        <div className="stock-name-display">{stock.name}</div>
                                        <div className="stock-symbol-display">{stock.symbol}</div>
                                    </td>
                                    <td className={todayProfit >= 0 ? 'profit-up' : 'profit-down'}>
                                        {stock.cost ? `${formatNumber(todayProfit)} (${formatPercent(todayProfitPercent)})` : '-'}
                                    </td>
                                    <td className={profit >= 0 ? 'profit-up' : 'profit-down'}>
                                        {stock.cost ? `${formatNumber(profit)} (${formatPercent(profitPercent)})` : '-'}
                                    </td>
                                    <td>{stock.cost ? quantity : '-'}</td>
                                    <td className="price-change-cell">
                                        <div className={`price-display ${change >= 0 ? 'profit-up' : 'profit-down'}`}>{formatNumber(price)}</div>
                                        <div className={`change-display ${change >= 0 ? 'profit-up' : 'profit-down'}`}>
                                            {formatNumber(change)} ({formatPercent(changePercent)})
                                        </div>
                                    </td>
                                    <td>{stock.cost ? formatNumber(averageCost) : '-'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </div>
    );
}; 