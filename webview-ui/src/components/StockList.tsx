import React, { useState, useRef, useEffect, useMemo } from 'react';
import { VSCodeDivider, VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { StockInventory, IndiceData } from '../../../src/types';
import { vscode } from '../utilities/vscode';
import './StockList.css';
import { BsGrid3X3GapFill, BsTable, BsPlusCircle } from 'react-icons/bs';
import { IndiceBar } from './StockListIndiceBar';
import TableView from './StockListTableView';
import CardView from './StockListCardView';
import IndexDisplay from './IndexDisplay';

interface StockListProps {
    stocks: StockInventory[];
    onDelete: (symbol: string) => void;
    twseIndex: StockInventory | null;
    onSelectStock: (stock: StockInventory) => void;
    indices?: Record<string, IndiceData>;
    highlightAddButton?: boolean;
}

export const StockList: React.FC<StockListProps> = ({ 
    stocks, 
    onDelete, 
    twseIndex, 
    onSelectStock,
    indices = {},
    highlightAddButton = false
}) => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const prevStocksRef = useRef(stocks);
    const prevIndexRef = useRef(twseIndex);
    const prevIndicesRef = useRef<Record<string, IndiceData>>({});
    const [updatedStocks, setUpdatedStocks] = useState<Set<string>>(new Set());
    const [updatedIndices, setUpdatedIndices] = useState<Record<string, boolean>>({});
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    // 添加用於保存拖拽後的股票順序
    const [tableData, setTableData] = useState<StockInventory[]>([]);

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

    // 當 stocks 變化時更新 tableData
    useEffect(() => {
        setTableData([...stocks]);
    }, [stocks]);

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

    // 處理添加股票按鈕點擊
    const handleAddStock = () => {
        vscode.postMessage({ command: 'addStock' });
    };

    // 空狀態顯示組件
    const EmptyStockState = () => (
        <div className="empty-stock-container">
            <div className="empty-stock-message">
                <BsPlusCircle className="empty-stock-icon" />
                <h3>您尚未添加任何股票</h3>
                <p>點擊下方按鈕開始添加您的第一個持股</p>
                <VSCodeButton 
                    onClick={handleAddStock} 
                    className={`empty-stock-button ${highlightAddButton ? 'highlight-button' : ''}`}
                >
                    添加股票
                </VSCodeButton>
            </div>
        </div>
    );

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
                    className={`view-mode-button add-stock ${highlightAddButton ? 'highlight-button' : ''}`}
                    onClick={handleAddStock}
                    title="添加股票"
                >
                    <BsPlusCircle />
                </button>
            </div>
            
            {/* 指數展示和損益摘要 */}
            <IndexDisplay 
                twseIndex={twseIndex}
                stocks={stocks} 
                updatedIndices={updatedIndices}
                onStockClick={handleStockClick}
            />
            
            <VSCodeDivider />

            {/* 當沒有股票時顯示空狀態 */}
            {stocks.length === 0 ? (
                <EmptyStockState />
            ) : (
                /* 根據視圖模式顯示不同組件 */
                viewMode === 'card' ? (
                    <CardView 
                        stocks={stocks}
                        updatedStocks={updatedStocks}
                        activeMenu={activeMenu}
                        handleStockClick={handleStockClick}
                        handleMenuClick={handleMenuClick}
                        handleSetCost={handleSetCost}
                        handleSetAlert={handleSetAlert}
                        handleDelete={handleDelete}
                    />
                ) : (
                    <TableView 
                        tableData={tableData}
                        updatedStocks={updatedStocks}
                        activeMenu={activeMenu}
                        setTableData={setTableData}
                        handleStockClick={handleStockClick}
                        handleMenuClick={handleMenuClick}
                        handleSetCost={handleSetCost}
                        handleSetAlert={handleSetAlert}
                        handleDelete={handleDelete}
                    />
                )
            )}
        </div>
    );
}; 