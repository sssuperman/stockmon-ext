import * as vscode from 'vscode';
import { SessionInfo, PriceAlert, StockCostData, StockData } from './types';

export class StateManager {
    private static instance: StateManager;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public static getInstance(context: vscode.ExtensionContext): StateManager {
        if (!StateManager.instance) {
            StateManager.instance = new StateManager(context);
        }
        return StateManager.instance;
    }

    // Client UUID 管理
    public getClientUuid(): string {
        let clientUuid = this.context.globalState.get<string>('clientUuid', '');
        if (!clientUuid) {
            clientUuid = this.generateUuid();
            this.setClientUuid(clientUuid);
        }
        return clientUuid;
    }

    public setClientUuid(uuid: string): void {
        this.context.globalState.update('clientUuid', uuid);
    }

    private generateUuid(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Session 管理
    public getSessionInfo(): SessionInfo | null {
        const sessionInfo = this.context.globalState.get<SessionInfo | undefined>('sessionInfo', undefined);
        return sessionInfo || null;
    }

    public setSessionInfo(sessionInfo: SessionInfo | null): Thenable<void> {
        return this.context.globalState.update('sessionInfo', sessionInfo);
    }

    public updateSessionInfo(sessionInfo: SessionInfo): Thenable<void> {
        return this.setSessionInfo(sessionInfo);
    }

    // Auth Token 管理
    public getAuthToken(): string | null {
        const token = this.context.globalState.get<string | undefined>('authToken', undefined);
        return token || null;
    }

    public setAuthToken(token: string | null): Thenable<void> {
        return this.context.globalState.update('authToken', token);
    }

    public isAuthenticated(): boolean {
        return this.getAuthToken() !== null;
    }

    // Stock Costs 管理
    public getStockCosts(): Map<string, StockCostData> {
        const savedCosts = this.context.globalState.get<[string, StockCostData][]>('stockCosts', []);
        return new Map(savedCosts);
    }

    public setStockCosts(costs: Map<string, StockCostData>): Thenable<void> {
        return this.context.globalState.update('stockCosts', Array.from(costs.entries()));
    }

    public updateStockCost(symbol: string, cost: StockCostData): Thenable<void> {
        const costs = this.getStockCosts();
        costs.set(symbol, cost);
        return this.setStockCosts(costs);
    }

    // Price Alerts 管理
    public getPriceAlerts(): Map<string, PriceAlert[]> {
        const savedAlerts = this.context.globalState.get<[string, PriceAlert[]][]>('priceAlerts', []);
        return new Map(savedAlerts);
    }

    public setPriceAlerts(alerts: Map<string, PriceAlert[]>): Thenable<void> {
        return this.context.globalState.update('priceAlerts', Array.from(alerts.entries()));
    }

    public updatePriceAlert(symbol: string, alerts: PriceAlert[]): Thenable<void> {
        const allAlerts = this.getPriceAlerts();
        if (alerts.length > 0) {
            allAlerts.set(symbol, alerts);
        } else {
            allAlerts.delete(symbol);
        }
        return this.setPriceAlerts(allAlerts);
    }

    // 最後行情管理
    public getLastStockData(): StockData[] {
        return this.context.globalState.get<StockData[]>('lastStockData', []);
    }

    public setLastStockData(stockData: StockData[]): Thenable<void> {
        return this.context.globalState.update('lastStockData', stockData);
    }

    public updateStockData(stockData: StockData): Thenable<void> {
        const lastData = this.getLastStockData();
        const index = lastData.findIndex(s => s.symbol === stockData.symbol);
        if (index >= 0) {
            lastData[index] = stockData;
        } else {
            lastData.push(stockData);
        }
        return this.setLastStockData(lastData);
    }

    public clearLastStockData(): Thenable<void> {
        return this.context.globalState.update('lastStockData', []);
    }

    // 清除所有狀態
    public async clearAll(): Promise<void> {
        await this.setAuthToken(null);
        await this.setSessionInfo(null);
        await this.setStockCosts(new Map());
        await this.setPriceAlerts(new Map());
        await this.setSubscriptions(new Set());
        await this.clearLastStockData();
    }

    // Subscriptions 管理
    public getSubscriptions(): Set<string> {
        const savedSubscriptions = this.context.globalState.get<string[]>('subscriptions', []);
        return new Set(savedSubscriptions);
    }

    public setSubscriptions(subscriptions: Set<string>): Thenable<void> {
        return this.context.globalState.update('subscriptions', Array.from(subscriptions));
    }

    /**
     * 更新股票的訂閱狀態
     * @param symbol 股票代號
     * @param isSubscribed true 表示添加訂閱，false 表示取消訂閱
     * @returns Promise<void>
     */
    public updateSubscription(symbol: string, isSubscribed: boolean): Thenable<void> {
        const subscriptions = this.getSubscriptions();
        if (isSubscribed) {
            subscriptions.add(symbol);
        } else {
            subscriptions.delete(symbol);
        }
        return this.setSubscriptions(subscriptions);
    }

    /**
     * 添加一個股票訂閱，如果該股票已經被訂閱則不做任何操作
     * @param symbol 股票代號
     * @returns Promise<void>
     */
    public addSubscription(symbol: string): Thenable<void> {
        const subscriptions = this.getSubscriptions();
        if (!subscriptions.has(symbol)) {
            subscriptions.add(symbol);
            return this.setSubscriptions(subscriptions);
        }
        return Promise.resolve();
    }

    public clearSubscriptions(): Thenable<void> {
        return this.context.globalState.update('subscriptions', []);
    }
} 
