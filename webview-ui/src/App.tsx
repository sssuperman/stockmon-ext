import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { StockList } from './components/StockList';
import { StockDetail } from './components/StockDetail';
import { AlertList } from './components/alert/AlertList';
import { Header } from './components/Header';
import FeedbackButton, { SessionInfo } from './components/FeedbackButton';
import { VSCodeButton, VSCodeDivider } from '@vscode/webview-ui-toolkit/react';
import './App.css';
import { vscode, registerMessageHandler, postMessage } from "./utilities/vscode";
import { WebSocketState, StockInventory, IndiceData } from './types';
import { StockAlertItem } from './store/alertTypes';

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

// Tab切換按鈕組件 - 提取為獨立常量組件
const TabButton = React.memo(({ 
    mode, 
    activeMode, 
    onSwitch, 
    children 
}: { 
    mode: 'list' | 'alert', 
    activeMode: 'list' | 'detail' | 'alert', 
    onSwitch: (mode: 'list' | 'alert') => void,
    children: React.ReactNode
}) => (
    <button 
        className={`tab-button ${activeMode === mode ? 'active' : ''}`}
        onClick={() => onSwitch(mode)}
    >
        {children}
    </button>
), (prevProps, nextProps) => {
    // 只有當 activeMode 變化且與此按鈕相關時才重新渲染
    return prevProps.activeMode === nextProps.activeMode || 
           (prevProps.activeMode !== prevProps.mode && nextProps.activeMode !== nextProps.mode);
});

// Tab切換組件 - 提取為獨立常量組件
const TabSelector = React.memo(({ activeMode, onSwitch }: { 
    activeMode: 'list' | 'detail' | 'alert', 
    onSwitch: (mode: 'list' | 'alert') => void 
}) => (
    <div className="tab-selector">
        <TabButton mode="list" activeMode={activeMode} onSwitch={onSwitch}>
            持股清單
        </TabButton>
        <TabButton mode="alert" activeMode={activeMode} onSwitch={onSwitch}>
            股價提醒
        </TabButton>
    </div>
), (prevProps, nextProps) => prevProps.activeMode === nextProps.activeMode);

const App: React.FC = () => {
    const [stocks, setStocks] = useState<StockInventory[]>([]);
    const [wsState, setWsState] = useState<WebSocketState>(WebSocketState.CLOSED);
    const [sessionInfo, setSessionInfo] = useState<SessionInfo>({ is_authenticated: false });
    const [twseIndex, setTwseIndex] = useState<StockInventory | null>(null);
    const [selectedStock, setSelectedStock] = useState<StockInventory | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'detail' | 'alert'>('list');
    const [indices, setIndices] = useState<Record<string, IndiceData>>({});
    const [alerts, setAlerts] = useState<StockAlertItem[]>([]);
    const [showPrompt, setShowPrompt] = useState<boolean>(true); // 控制是否顯示註冊提示
    const [highlightAddButton, setHighlightAddButton] = useState<boolean>(false); // 控制是否高亮添加按鈕
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [lastTabSwitch, setLastTabSwitch] = useState<number>(0);

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
                    if (message.alerts) {
                        setAlerts(message.alerts);
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
                case 'updateAlerts':
                    setAlerts(message.alerts || []);
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
                case 'alertCreated':
                case 'alertUpdated':
                case 'alertReset':
                    // 提醒操作成功後刷新提醒列表
                    if (message.success) {
                        vscode.postMessage({ command: 'fetchAlerts' });
                    }
                    break;
                case 'alertDeleted':
                    // 刪除提醒成功後刷新提醒列表
                    if (message.success) {
                        vscode.postMessage({ command: 'fetchAlerts' });
                        // 也可以從本地列表中移除
                        setAlerts(prevAlerts => prevAlerts.filter(alert => alert.id !== message.alertId));
                    }
                    break;
                case 'showEmptyState':
                    // 如果收到空狀態提示消息，設置高亮添加按鈕狀態
                    setHighlightAddButton(message.highlightAddButton || false);
                    // 確保顯示列表視圖
                    setViewMode('list');
                    break;
                case 'showAlertView':
                    // 切換到提醒視圖
                    setViewMode('alert');
                    // 獲取最新提醒
                    if (sessionInfo.is_authenticated) {
                        vscode.postMessage({ command: 'fetchAlerts' });
                    }
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
        // 請求提醒數據
        if (sessionInfo.is_authenticated) {
            postMessage({ command: 'getAlerts' });
        }
    }, []);

    // 當 sessionInfo 變更時，更新顯示提示的狀態
    useEffect(() => {
        // 只有在用戶未登錄時才顯示提示
        setShowPrompt(!sessionInfo.is_authenticated);
        
        // 如果用戶登入了，請求提醒數據
        if (sessionInfo.is_authenticated) {
            postMessage({ command: 'getAlerts' });
        }
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

    // 優化切換視圖函數，避免不必要的重新渲染
    const handleSwitchView = useCallback((mode: 'list' | 'alert') => {
        // 避免相同模式的重複切換
        if (viewMode === mode) return;
        
        const now = Date.now();
        // 如果距離上次切換不到300ms，則忽略此次點擊
        if (now - lastTabSwitch < 300) return;
        
        setLastTabSwitch(now);
        setViewMode(mode);
        
        // 如果切換到提醒視圖，且用戶已登入，則獲取最新提醒數據
        if (mode === 'alert' && sessionInfo.is_authenticated) {
            // 設置加載狀態指示器
            setIsLoading(true);
            postMessage({ command: 'fetchAlerts' });
        }
    }, [viewMode, sessionInfo.is_authenticated, lastTabSwitch]);

    // 使用 useMemo 創建 TabSelector 實例並緩存它
    const tabSelectorComponent = useMemo(() => {
        return (viewMode === 'list' || viewMode === 'alert') ? (
            <TabSelector activeMode={viewMode} onSwitch={handleSwitchView} />
        ) : null;
    }, [viewMode, handleSwitchView]);

    // 使用 useMemo 降低重新渲染成本
    const renderActiveView = useCallback(() => {
        if (viewMode === 'list') {
            return (
                <StockList 
                    stocks={stocks} 
                    onDelete={handleDeleteStock} 
                    twseIndex={twseIndex}
                    onSelectStock={handleStockSelect}
                    indices={indices}
                    highlightAddButton={highlightAddButton}
                    key="stock-list"
                />
            );
        } else if (viewMode === 'detail' && selectedStock) {
            return (
                <StockDetail 
                    stock={selectedStock} 
                    onBack={handleBackToList} 
                    key={`stock-detail-${selectedStock.symbol}`}
                />
            );
        } else if (viewMode === 'alert') {
            return (
                <AlertList 
                    alerts={alerts}
                    isAuthenticated={sessionInfo.is_authenticated}
                    key="alert-list"
                />
            );
        }
        return null;
    }, [viewMode, stocks, twseIndex, selectedStock, alerts, indices, sessionInfo.is_authenticated, highlightAddButton]);

    // 使用 useMemo 避免重新渲染 RegistrationPrompt
    const renderRegistrationPrompt = useCallback(() => {
        if (!sessionInfo.is_authenticated && showPrompt && (viewMode === 'list' || viewMode === 'alert')) {
            return <RegistrationPrompt onLogin={handleLogin} />;
        }
        return null;
    }, [sessionInfo.is_authenticated, showPrompt, viewMode, handleLogin]);

    return (
        <div className="container">
            <Header wsState={wsState} sessionInfo={sessionInfo} />
            
            {/* 未登錄且顯示提示時，展示註冊提示 */}
            {renderRegistrationPrompt()}
            
            {/* 顯示Tab選擇器 */}
            {tabSelectorComponent}
            
            {/* 顯示當前視圖 */}
            {renderActiveView()}

            <FeedbackButton sessionInfo={sessionInfo} />
        </div>
    );
};

export default App; 