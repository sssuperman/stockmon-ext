import React, { useState } from 'react';
import { WebSocketState } from '../types';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { vscode } from '../utilities/vscode';
import './Header.css';
import { SessionInfo } from './FeedbackButton';

interface HeaderProps {
    wsState: WebSocketState;
    sessionInfo?: SessionInfo;
}

export const Header: React.FC<HeaderProps> = ({ wsState, sessionInfo }) => {
    const [showUserInfo, setShowUserInfo] = useState(false);
    
    // 處理登入
    const handleLogin = () => {
        vscode.postMessage({ command: 'login' });
    };

    // 處理登出
    const handleLogout = () => {
        vscode.postMessage({ command: 'confirmLogout' });
    };
    
    // 處理顯示持股組合
    const handleShowPortfolio = () => {
        vscode.postMessage({ command: 'showPortfolioView' });
    };

    // WebSocket 狀態相關
    const getConnectionStatus = () => {
        switch (wsState) {
            case WebSocketState.CONNECTED:
                return { icon: '🟢', text: 'Connected', className: 'status-badge connected' };
            case WebSocketState.CONNECTING:
                return { icon: '🟡', text: 'Connecting', className: 'status-badge connecting' };
            case WebSocketState.RECONNECTING:
                return { icon: '🟠', text: 'Reconnecting', className: 'status-badge connecting' };
            default:
                return { icon: '🔴', text: 'Offline', className: 'status-badge offline' };
        }
    };

    const connectionStatus = getConnectionStatus();
    
    // 獲取使用者頭像顯示
    const getUserAvatar = () => {
        if (!sessionInfo?.is_authenticated) {
            return { icon: '🔑', text: '' };
        }
        
        const username = sessionInfo.user || 'User';
        const firstLetter = username.charAt(0).toUpperCase();
        return { icon: '', text: firstLetter };
    };
    
    const userAvatar = getUserAvatar();

    return (
        <div className="header">
            <div className="header-left">
                <div className={connectionStatus.className} title={connectionStatus.text}>
                    <span className="status-icon">{connectionStatus.icon}</span>
                    <span className="status-text">{connectionStatus.text}</span>
                </div>
            </div>
            
            <div className="header-right">
                {/* 持股管理按鈕 */}
                <VSCodeButton 
                    appearance="icon"
                    onClick={handleShowPortfolio}
                    title="管理您的持股"
                    className="portfolio-button"
                >
                    <span className="button-icon">📊</span>
                </VSCodeButton>
                
                {!sessionInfo?.is_authenticated ? (
                    <VSCodeButton 
                        appearance="icon"
                        onClick={handleLogin}
                        title="點擊登入"
                        className="login-button"
                    >
                        <span className="button-icon">🔑</span>
                    </VSCodeButton>
                ) : (
                    <>
                        <div 
                            className="user-avatar-container"
                            onMouseEnter={() => setShowUserInfo(true)}
                            onMouseLeave={() => setShowUserInfo(false)}
                        >
                            <div className="user-avatar">
                                {userAvatar.text}
                            </div>
                            
                            {showUserInfo && (
                                <div className="user-info-tooltip">
                                    <div className="tooltip-item">
                                        <span className="tooltip-label">使用者：</span>
                                        <span className="tooltip-value">{sessionInfo.user || 'User'}</span>
                                    </div>
                                    {sessionInfo.email && (
                                        <div className="tooltip-item">
                                            <span className="tooltip-label">電子郵件：</span>
                                            <span className="tooltip-value">{sessionInfo.email}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <VSCodeButton 
                            appearance="icon"
                            onClick={handleLogout}
                            title="登出"
                            className="logout-button"
                        >
                            <span className="button-icon">↪</span>
                        </VSCodeButton>
                    </>
                )}
            </div>
        </div>
    );
}; 