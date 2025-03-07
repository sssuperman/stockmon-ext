import React from 'react';
import { WebSocketState } from '../../../src/types';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { vscode } from '../utilities/vscode';
import './Header.css';

interface HeaderProps {
    wsState: WebSocketState;
    sessionInfo?: {
        user?: string;
        is_authenticated: boolean;
    };
}

export const Header: React.FC<HeaderProps> = ({ wsState, sessionInfo }) => {
    // 處理登入/登出
    const handleAuth = () => {
        if (sessionInfo?.is_authenticated) {
            vscode.postMessage({ command: 'confirmLogout' });
        } else {
            vscode.postMessage({ command: 'login' });
        }
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
    
    // 登入狀態相關
    const authStatus = {
        icon: sessionInfo?.is_authenticated ? '👤' : '🔑',
        text: sessionInfo?.is_authenticated 
            ? `${sessionInfo.user || 'User'}` 
            : 'Login',
        tooltip: sessionInfo?.is_authenticated 
            ? `Logged in as ${sessionInfo.user || 'User'}` 
            : 'Click to login'
    };

    return (
        <div className="header">
            <div className="header-left">
                <div className={connectionStatus.className} title={connectionStatus.text}>
                    <span className="status-icon">{connectionStatus.icon}</span>
                    <span className="status-text">{connectionStatus.text}</span>
                </div>
            </div>
            
            <div className="header-right">
                <VSCodeButton 
                    appearance="secondary" 
                    onClick={handleAuth}
                    title={authStatus.tooltip}
                    className="auth-button"
                >
                    <span className="auth-icon">{authStatus.icon}</span>
                    <span className="auth-text">{authStatus.text}</span>
                </VSCodeButton>
            </div>
        </div>
    );
}; 