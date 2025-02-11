import React from 'react';
import { WebSocketState } from '../../../src/types';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { vscode } from '../utilities/vscode';

interface HeaderProps {
    wsState: WebSocketState;
    sessionInfo?: {
        user?: string;
        is_authenticated: boolean;
    };
}

export const Header: React.FC<HeaderProps> = ({ wsState, sessionInfo }) => {
    const handleAuth = () => {
        if (sessionInfo?.is_authenticated) {
            vscode.postMessage({ command: 'confirmLogout' });
        } else {
            vscode.postMessage({ command: 'login' });
        }
    };

    const getStatusBadgeClass = () => {
        switch (wsState) {
            case WebSocketState.CONNECTED:
                return 'status-badge connected';
            case WebSocketState.CONNECTING:
            case WebSocketState.RECONNECTING:
                return 'status-badge connecting';
            default:
                return 'status-badge offline';
        }
    };

    return (
        <div className="header">
            <div className={getStatusBadgeClass()}>
                {wsState === WebSocketState.CONNECTED ? 'Connected' : 
                 wsState === WebSocketState.CONNECTING ? 'Connecting' :
                 wsState === WebSocketState.RECONNECTING ? 'Reconnecting' : 'Offline'}
            </div>
            <VSCodeButton appearance="secondary" onClick={handleAuth}>
                {sessionInfo?.is_authenticated 
                  ? `Logged in as ${sessionInfo.user}` 
                  : 'Login'}
            </VSCodeButton>
        </div>
    );
}; 