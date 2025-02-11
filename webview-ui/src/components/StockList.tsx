import React, { useState } from 'react';
import { VSCodeButton, VSCodeDivider } from '@vscode/webview-ui-toolkit/react';
import { StockInventory } from '../../../src/types';
import { vscode } from '../utilities/vscode';

interface StockListProps {
    stocks: StockInventory[];
    onDelete: (symbol: string) => void;
}

export const StockList: React.FC<StockListProps> = ({ stocks, onDelete }) => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null);

    const handleMenuClick = (symbol: string) => {
        setActiveMenu(activeMenu === symbol ? null : symbol);
    };

    const handleSetCost = (symbol: string) => {
        vscode.postMessage({ command: 'setCost', symbol });
        setActiveMenu(null);
    };

    const handleSetAlert = (symbol: string) => {
        vscode.postMessage({ command: 'setPriceAlert', symbol });
        setActiveMenu(null);
    };

    const handleDelete = (symbol: string) => {
        onDelete(symbol);
        setActiveMenu(null);
    };

    const formatNumber = (num: number) => {
        return num.toFixed(2);
    };

    const formatPercent = (num: number) => {
        return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
    };

    return (
        <div className="stock-grid">
            {stocks.map((stock) => (
                <div key={stock.symbol} className="stock-card">
                    <div className="stock-header">
                        <div className="stock-title">
                            <div className="stock-symbol">{stock.symbol}</div>
                            <div className="stock-name">{stock.name}</div>
                        </div>
                        <div className="stock-price-container">
                            <div className="stock-price">{formatNumber(stock.price)}</div>
                            <div className={`stock-change ${stock.change >= 0 ? 'profit-up' : 'profit-down'}`}>
                                {formatNumber(stock.change)} ({formatPercent(stock.changePercent)})
                            </div>
                        </div>
                    </div>

                    {stock.cost && (
                        <>
                            <VSCodeDivider />
                            <div className="stock-details">
                                <div className="cost-info">
                                    <div>Cost: {formatNumber(stock.cost.averageCost)}</div>
                                    <div>Shares: {stock.cost.quantity}</div>
                                </div>
                                {stock.profit !== undefined && stock.profitPercent !== undefined && (
                                    <div className={`profit-info ${stock.profit >= 0 ? 'profit-up' : 'profit-down'}`}>
                                        <div>Profit: {formatNumber(stock.profit)}</div>
                                        <div>({formatPercent(stock.profitPercent)})</div>
                                    </div>
                                )}
                            </div>
                        </>
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
            ))}
        </div>
    );
}; 