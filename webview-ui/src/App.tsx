import React, { useEffect, useState } from 'react';
import { StockList } from './components/StockList';
import { Header } from './components/Header';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import './App.css';
import { vscode } from "./utilities/vscode";
import { WebSocketState, StockInventory } from '../../src/types';

const App: React.FC = () => {
    const [stocks, setStocks] = useState<StockInventory[]>([]);
    const [wsState, setWsState] = useState<WebSocketState>(WebSocketState.CLOSED);
    const [sessionInfo, setSessionInfo] = useState<{ user?: string; is_authenticated: boolean }>({ is_authenticated: false });

    useEffect(() => {
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'updateStocks':
                    setStocks(message.stocks);
                    break;
                case 'updateWebSocketState':
                    setWsState(message.state);
                    break;
                case 'updateSessionInfo':
                    setSessionInfo(message.sessionInfo);
                    break;
            }
        });

        // Request initial data
        vscode.postMessage({ command: 'getStocks' });
    }, []);

    const handleAddStock = () => {
        vscode.postMessage({ command: 'addStock'});
    };

    const handleDeleteStock = (symbol: string) => {
        vscode.postMessage({ command: 'deleteStock', symbol });
    };

    return (
        <div className="container">
            <Header wsState={wsState} sessionInfo={sessionInfo} />
            <div className="actions">
                <VSCodeButton onClick={handleAddStock}>Add Stock</VSCodeButton>
            </div>
            <StockList stocks={stocks} onDelete={handleDeleteStock} />
        </div>
    );
};

export default App; 