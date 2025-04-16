import { useStockDataStore } from "./store/stockDataStore";
import { useSessionStore } from "./store/sessionStore";
import { useWebSocketStore } from "./store/websocketStore";
import * as vscode from 'vscode';
import { ExtensionContextManager } from './utilities/contextManager';
import { LoggerService, LogCategory } from './utilities/loggerService';
import { WebSocketState } from './types';

export class StatusBarManager {
    private static _instance: StatusBarManager;
    private statusBarItem: vscode.StatusBarItem;
    private unsubscribeHandlers: (() => void)[] = [];
    private logger: LoggerService;

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.name = "StockMon";
        this.statusBarItem.command = 'stockmon.showPanel';
        this.statusBarItem.show();
        this.logger = LoggerService.getInstance();
    }

    public static getInstance(): StatusBarManager {
        if (!StatusBarManager._instance) {
            StatusBarManager._instance = new StatusBarManager();
        }
        return StatusBarManager._instance;
    }

    public register(context: vscode.ExtensionContext): vscode.StatusBarItem {
        context.subscriptions.push(this.statusBarItem);
        
        // 訂閱 WebSocket 狀態變化
        const unsubscribeWsStore = useWebSocketStore.subscribe((state) => {
            this.update();
        });
        
        // 訂閱 Session 狀態變化
        const unsubscribeSessionStore = useSessionStore.subscribe(() => {
            this.update();
        });

        // 訂閱 Stock 數據變化
        const unsubscribeStockStore = useStockDataStore.subscribe(() => {
            this.update();
        });
        
        // 保存取消訂閱處理程序
        this.unsubscribeHandlers.push(
            unsubscribeWsStore, 
            unsubscribeSessionStore, 
            unsubscribeStockStore
        );
        
        // 添加到待清理列表，確保擴展停用時取消所有訂閱
        context.subscriptions.push({
            dispose: () => this.dispose()
        });
        
        // 初始更新狀態欄
        this.update();
        
        return this.statusBarItem;
    }

    public update(): void {
        try {
            const stockState = useStockDataStore.getState();
            const sessionState = useSessionStore.getState();
            const wsState = useWebSocketStore.getState().wsState;
            
            // 計算損益
            const { totalProfit, hasPositions } = stockState.calculateTotalProfit();
            
            // 設置連線圖示
            let connectionIcon = '';
            let connectionTooltip = '';
            
            switch (wsState) {
                case WebSocketState.CONNECTED:
                    connectionIcon = '$(radio-tower)';
                    connectionTooltip = "已連線到股票服務";
                    break;
                case WebSocketState.CONNECTING:
                case WebSocketState.RECONNECTING:
                    connectionIcon = '$(sync~spin)';
                    connectionTooltip = "正在連線到股票服務...";
                    break;
                default:
                    connectionIcon = '$(warning)';
                    connectionTooltip = "未連線到股票服務";
                    break;
            }
            
            // 設置登入圖示
            let loginIcon = sessionState.isAuthenticated ? '$(account)' : '$(sign-in)';
            let loginTooltip = sessionState.isAuthenticated 
                ? `已登入為 ${sessionState.sessionInfo?.user || 'User'}` 
                : '點擊登入';
            
            // 設置損益文字
            let profitText = '';
            let profitColor = undefined;
            
            if (hasPositions) {
                const formattedProfit = Math.round(totalProfit).toLocaleString();
                
                if (totalProfit > 0) {
                    profitColor = new vscode.ThemeColor('charts.red');
                    profitText = `+${formattedProfit}`;
                } else if (totalProfit < 0) {
                    profitColor = new vscode.ThemeColor('charts.green');
                    profitText = `${formattedProfit}`;
                } else {
                    profitText = `${formattedProfit}`;
                }
            }
            
            // 組合狀態欄文字
            if (hasPositions) {
                this.statusBarItem.text = `${connectionIcon} ${profitText} ${loginIcon}`.trim();
            } else if (!sessionState.isAuthenticated && !hasPositions) {
                // 未登入且沒有持股時，顯示為 StockMon
                this.statusBarItem.text = `StockMon`;
            } else {
                this.statusBarItem.text = `${connectionIcon} ${loginIcon}`.trim();
            }
            this.statusBarItem.tooltip = `${connectionTooltip} | ${loginTooltip}`;
            this.statusBarItem.color = profitColor;
            
            // 設置點擊命令 - 始終打開面板
            this.statusBarItem.command = 'stockmon.showPanel';
            
            this.logger.debug(LogCategory.EXTENSION, `StatusBar updated: ${this.statusBarItem.text}`);
            
        } catch (error) {
            this.logger.logError(LogCategory.EXTENSION, error, 'Error updating status bar');
        }
    }

    public dispose(): void {
        this.logger.debug(LogCategory.EXTENSION, 'Disposing status bar manager');
        // 取消所有訂閱
        this.unsubscribeHandlers.forEach(unsubscribe => unsubscribe());
        this.unsubscribeHandlers = [];
        
        // 處置狀態欄項目
        if (this.statusBarItem) {
            this.statusBarItem.dispose();
        }
    }
}