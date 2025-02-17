import React, { useEffect, useState } from 'react';
import { StockList } from './components/StockList';
import { Header } from './components/Header';
import { VSCodeButton, VSCodeDivider } from '@vscode/webview-ui-toolkit/react';
import './App.css';
import { vscode } from "./utilities/vscode";
import { WebSocketState, StockInventory } from '../../src/types';

const App: React.FC = () => {
    const [stocks, setStocks] = useState<StockInventory[]>([]);
    const [wsState, setWsState] = useState<WebSocketState>(WebSocketState.CLOSED);
    const [sessionInfo, setSessionInfo] = useState<{ user?: string; is_authenticated: boolean }>({ is_authenticated: false });
    const [twseIndex, setTwseIndex] = useState<StockInventory | null>(null);

    useEffect(() => {
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('Received message in App:', message);
            switch (message.type) {
                case 'updateStocks':
                    console.log('Updating stocks:', message.stocks);
                    setStocks(message.stocks);
                    break;
                case 'updateWebSocketState':
                    console.log('Updating WebSocket state:', message.state);
                    setWsState(message.state);
                    break;
                case 'updateSessionInfo':
                    console.log('Updating session info:', message.sessionInfo);
                    setSessionInfo(message.sessionInfo);
                    break;
                case 'updateTwseIndex':
                    console.log('Updating TWSE index:', message.index);
                    setTwseIndex(message.index);
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
            <StockList stocks={stocks} onDelete={handleDeleteStock} twseIndex={twseIndex} />
        </div>
    );
};

export default App; 