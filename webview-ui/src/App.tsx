import React, { useEffect, useState, useRef } from 'react';
import { StockList } from './components/StockList';
import { StockDetail } from './components/StockDetail';
import { Header } from './components/Header';
import FeedbackButton, { SessionInfo } from './components/FeedbackButton';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import './App.css';
import { vscode, registerMessageHandler, postMessage } from "./utilities/vscode";
import { WebSocketState, StockInventory, IndiceData } from '../../src/types';

// 註冊提示組件
const RegistrationPrompt: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
    return (
        <div className="registration-prompt">
            <div className="prompt-content">
                <div className="prompt-icon">☁️</div>
                <div className="prompt-text">
                    <h3>跨裝置同步您的持股！</h3>
                    <p>註冊後您可以將持股資料同步到雲端，實現多台電腦間的無縫同步體驗。</p>
                    <div className="prompt-benefits">
                        <div className="benefit-item">
                            <span className="benefit-icon">🔄</span>
                            <span>跨裝置同步</span>
                        </div>
                        <div className="benefit-item">
                            <span className="benefit-icon">🔒</span>
                            <span>安全存儲</span>
                        </div>
                        <div className="benefit-item">
                            <span className="benefit-icon">📱</span>
                            <span>多平台支持</span>
                        </div>
                    </div>
                </div>
                <VSCodeButton onClick={onLogin} className="register-button">
                    立即註冊/登入
                </VSCodeButton>
            </div>
        </div>
    );
};

const App: React.FC = () => {
    const [stocks, setStocks] = useState<StockInventory[]>([]);
    const [wsState, setWsState] = useState<WebSocketState>(WebSocketState.CLOSED);
    const [sessionInfo, setSessionInfo] = useState<SessionInfo>({ is_authenticated: false });
    const [twseIndex, setTwseIndex] = useState<StockInventory | null>(null);
    const [selectedStock, setSelectedStock] = useState<StockInventory | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
    const [indices, setIndices] = useState<Record<string, IndiceData>>({});
    const [showPrompt, setShowPrompt] = useState<boolean>(true); // 控制是否顯示註冊提示
    const [highlightAddButton, setHighlightAddButton] = useState<boolean>(false); // 控制是否高亮添加按鈕

    // 更新 sessionInfo 的處理函數
    const updateSessionInfo = (newSessionInfo: any) => {
        if (!newSessionInfo) {
            setSessionInfo({ is_authenticated: false });
            return;
        }
        
        // 確保 sessionInfo 格式正確
        setSessionInfo({
            user: newSessionInfo.user || '',
            email: newSessionInfo.email || '',
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
                    if (message.indices) {
                        setIndices(message.indices);
                    }
                    break;
                case 'updateStocks':
                    setStocks(message.stocks || []);
                    break;
                case 'updateTwseIndex':
                    setTwseIndex(message.index);
                    break;
                case 'updateIndices':
                    setIndices(message.indices || {});
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
                case 'showEmptyState':
                    // 如果收到空狀態提示消息，設置高亮添加按鈕狀態
                    setHighlightAddButton(message.highlightAddButton || false);
                    // 確保顯示列表視圖
                    setViewMode('list');
                    break;
                case 'feedbackResponse':
                    // 處理從擴展返回的反饋響應
                    console.log('Feedback response:', message.data);
                    break;
            }
        });

        // Request initial data
        postMessage({ command: 'getStocks' });
        // 請求指數數據
        postMessage({ command: 'getIndices' });
    }, []);

    // 當 sessionInfo 變更時，更新顯示提示的狀態
    useEffect(() => {
        // 只有在用戶未登錄時才顯示提示
        setShowPrompt(!sessionInfo.is_authenticated);
    }, [sessionInfo.is_authenticated]);

    // 當高亮狀態改變時，設置定時器取消高亮
    useEffect(() => {
        if (highlightAddButton) {
            const timer = setTimeout(() => {
                setHighlightAddButton(false);
            }, 3000); // 3秒後取消高亮
            
            return () => clearTimeout(timer);
        }
    }, [highlightAddButton]);

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

    const handleLogin = () => {
        postMessage({ command: 'login' });
    };

    const handleDismissPrompt = () => {
        setShowPrompt(false);
    };

    return (
        <div className="container">
            <Header wsState={wsState} sessionInfo={sessionInfo} />
            
            {/* 未登錄且顯示提示時，展示註冊提示 */}
            {!sessionInfo.is_authenticated && showPrompt && viewMode === 'list' && (
                <RegistrationPrompt onLogin={handleLogin} />
            )}
            
            {viewMode === 'list' && (
                <>
                    <StockList 
                        stocks={stocks} 
                        onDelete={handleDeleteStock} 
                        twseIndex={twseIndex}
                        onSelectStock={handleStockSelect}
                        indices={indices}
                        highlightAddButton={highlightAddButton}
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

            <FeedbackButton sessionInfo={sessionInfo} />
        </div>
    );
};

export default App; 