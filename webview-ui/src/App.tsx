import React, { useEffect, useState } from 'react';
import { StockList } from './components/StockList';
import { StockDetail } from './components/StockDetail';
import { Header } from './components/Header';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import './App.css';
import { vscode, registerMessageHandler, postMessage } from "./utilities/vscode";
import { WebSocketState, StockInventory } from '../../src/types';

const App: React.FC = () => {
    const [stocks, setStocks] = useState<StockInventory[]>([]);
    const [wsState, setWsState] = useState<WebSocketState>(WebSocketState.CLOSED);
    const [sessionInfo, setSessionInfo] = useState<{ user?: string; is_authenticated: boolean }>({ is_authenticated: false });
    const [twseIndex, setTwseIndex] = useState<StockInventory | null>(null);
    const [selectedStock, setSelectedStock] = useState<StockInventory | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');

    // 更新 sessionInfo 的處理函數
    const updateSessionInfo = (newSessionInfo: any) => {
        if (!newSessionInfo) {
            setSessionInfo({ is_authenticated: false });
            return;
        }
        
        // 確保 sessionInfo 格式正確
        setSessionInfo({
            user: newSessionInfo.user || '',
            is_authenticated: Boolean(newSessionInfo.is_authenticated)
        });
        
        console.log('Session info updated:', newSessionInfo);
    };

    useEffect(() => {
        // Register message handler
        registerMessageHandler((message) => {
            console.log('Received message from extension:', message);
            
            switch (message.type) {
                case 'init':
                case 'update':
                    setStocks(message.stocks || []);
                    if (message.twseIndex) {
                        setTwseIndex(message.twseIndex);
                    }
                    if (message.sessionInfo) {
                        updateSessionInfo(message.sessionInfo);
                    }
                    break;
                case 'updateStocks':
                    setStocks(message.stocks || []);
                    break;
                case 'updateTwseIndex':
                    setTwseIndex(message.index);
                    break;
                case 'updateWebSocketState':
                    setWsState(message.state);
                    break;
                case 'updateSessionInfo':
                    updateSessionInfo(message.sessionInfo);
                    break;
                case 'showStockDetail':
                    if (message.symbol) {
                        setStocks(prevStocks => {
                            const stock = prevStocks.find(s => s.symbol === message.symbol);
                            if (stock) {
                                setSelectedStock(stock);
                                setViewMode('detail');
                            }
                            return prevStocks;
                        });
                    }
                    break;
            }
        });

        // Request initial data
        postMessage({ command: 'getStocks' });
    }, []);

    const handleDeleteStock = (symbol: string) => {
        postMessage({ command: 'deleteStock', symbol });
    };

    const handleStockSelect = (stock: StockInventory) => {
        console.log('Stock selected in App:', stock);
        setSelectedStock(stock);
        setViewMode('detail');
    };

    const handleBackToList = () => {
        console.log('Back to list called');
        setViewMode('list');
    };

    return (
        <div className="container">
            <Header wsState={wsState} sessionInfo={sessionInfo} />
            
            {viewMode === 'list' && (
                <>
                    <StockList 
                        stocks={stocks} 
                        onDelete={handleDeleteStock} 
                        twseIndex={twseIndex}
                        onSelectStock={handleStockSelect}
                        key="stock-list"
                    />
                </>
            )}
            
            {viewMode === 'detail' && selectedStock && (
                <StockDetail 
                    stock={selectedStock} 
                    onBack={handleBackToList} 
                    key={`stock-detail-${selectedStock.symbol}`}
                />
            )}
        </div>
    );
};

export default App; 