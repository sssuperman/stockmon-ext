import { create } from 'zustand';
import { StockInventory, StockCostData, PriceAlert, StockSearchResult } from '../types';
import { useWebSocketStore } from './websocketStore';
import axios from 'axios';
import { useSessionStore } from './sessionStore';
import { WebSocketState } from '../types';
import { urls } from 'src/config';
import { ExtensionContextManager } from '../utilities/contextManager';
import { StockPanel } from '../stockPanel';


interface StockDataState {
  // 已訂閱的股票資料列表
  stocks: StockInventory[]
  updateStock: (stock: StockInventory) => void
  // 向 WebSocket 服務器發送訂閱請求並等待確認
  addSubscription: (symbol: string) => Promise<void>
  // 取消股票訂閱
  removeSubscription: (symbol: string) => void
  // 清除所有訂閱
  updateStockCost: (symbol: string, cost: StockCostData) => void
  removeStockCost: (symbol: string) => void
  addPriceAlert: (symbol: string, alert: PriceAlert) => void
  removePriceAlert: (symbol: string, alert: PriceAlert) => void
  subscribeToAllStocks: () => Promise<void>
  loadFromGlobalState: () => void
  saveToGlobalState: () => void
  searchStocks: (query: string) => Promise<StockSearchResult[]>
  // clearAll: () => void
  // 新增台股指數相關
  twseIndex?: StockInventory;  // 用於存放台股指數資料
  updateTwseIndex: (data: StockInventory) => void;
}

export const useStockDataStore = create<StockDataState>()((set, get) => ({
  // 已訂閱的股票資料陣列
  stocks: Array<StockInventory>(),

  // 新增台股指數相關的實作
  twseIndex: undefined,
  
  updateTwseIndex: (indexData: StockInventory) => set((state) => ({
    twseIndex: {
      ...indexData,
      symbol: 'IX0001',
      name: '發行量加權股價指數',
      type: 'index',
      isRealtime: true,
    }
  })),

  updateStock: (stockData: StockInventory) => set((state) => {
    // 如果是台股指數的更新
    if (stockData.symbol === 'IX0001') {
      return {
        ...state,
        twseIndex: {
          ...stockData,
          name: '發行量加權股價指數',
          type: 'index',
          isRealtime: true,
        }
      };
    }

    // 原有的股票更新邏輯
    return {
      stocks: state.stocks.map((stock: StockInventory) =>
        stock.symbol === stockData.symbol 
          ? { 
              ...stock,
              ...stockData,
              cost: stock.cost,
              alerts: stock.alerts,
              profit: stock.cost 
                ? (stockData.price - stock.cost.averageCost) * stock.cost.quantity 
                : undefined,
              profitPercent: stock.cost
                ? ((stockData.price - stock.cost.averageCost) / stock.cost.averageCost) * 100
                : undefined,
          } 
          : stock
      )
    };
  }),

  updateStockCost: (symbol, cost) => set((state) => {
    const stockExists = state.stocks.some(s => s.symbol === symbol);
    if (!stockExists) {
      console.warn(`Stock ${symbol} not found in current stocks list`);
      return { stocks: state.stocks };
    }

    const newStocks = state.stocks.map(s =>
      s.symbol === symbol ? { ...s, cost } : s
    );

    // Get context from manager
    const context = ExtensionContextManager.getContext();
    context.globalState.update('stocks', newStocks);

    return { stocks: newStocks };
  }),

  removeStockCost: (symbol) => set((state) => ({
    stocks: state.stocks.map(s => {
      if (s.symbol === symbol) {
        const { cost, ...stockWithoutCost } = s;
        return stockWithoutCost;
      }
      return s;
    })
  })),

  addPriceAlert: (symbol, alert) => set((state) => ({
    stocks: state.stocks.map(s =>
      s.symbol === symbol ? { ...s, alerts: [...s.alerts, alert] } : s
    )
  })),

  removePriceAlert: (symbol, alert) => set((state) => ({
    stocks: state.stocks.map(s =>
      s.symbol === symbol ? {
        ...s,
        alerts: s.alerts.filter(a =>
          !(a.price === alert.price && a.type === alert.type)
        )
      } : s
    )
  })),

  addSubscription: async (symbol: string) => {
    const context = ExtensionContextManager.getContext();
    const { wsState, outputChannel } = useWebSocketStore.getState();

    outputChannel?.appendLine(`=== Starting addSubscription for ${symbol} ===`);
    outputChannel?.appendLine(`Current WebSocket state: ${wsState}`);

    if (wsState !== WebSocketState.CONNECTED) {
        const error = `WebSocket not connected (State: ${wsState})`;
        outputChannel?.appendLine(`Error: ${error}`);
        throw new Error(error);
    }

    try {
        outputChannel?.appendLine(`Sending subscription request for ${symbol}`);
        const response = await useWebSocketStore.getState().sendAndWait(
            {
                action: 'subscribe',
                symbols: [symbol],
            },
            (message) => {
                outputChannel?.appendLine(`Received response: ${JSON.stringify(message)}`);
                return message.type === 'subscription_success';
            },
            5000
        );

        outputChannel?.appendLine(`Subscription response: ${JSON.stringify(response)}`);
        outputChannel?.appendLine(`Subscription confirmed for ${symbol}`);

        // 更新本地狀態
        set((state) => {
            const existingStock = state.stocks.find(s => s.symbol === symbol);
            let newStocks;

            if (existingStock) {
                outputChannel?.appendLine(`Updating existing stock ${symbol}`);
                newStocks = state.stocks.map(s =>
                    s.symbol === symbol ? { ...s, isSubscribed: true } : s
                );
            } else {
                outputChannel?.appendLine(`Creating new stock entry for ${symbol}`);
                const newStock: StockInventory = {
                    symbol,
                    name: symbol,
                    price: 0,
                    change: 0,
                    changePercent: 0,
                    open: 0,
                    high: 0,
                    low: 0,
                    close: 0,
                    volume: 0,
                    value: 0,
                    avgPrice: 0,
                    amplitude: 0,
                    date: new Date().toISOString().split('T')[0],
                    time: new Date().toLocaleString(),
                    serial: Date.now(),
                    isRealtime: false,
                    type: 'stock',
                    exchange: '',
                    market: '',
                    alerts: [],
                    isSubscribed: true,
                    
                    // Optional fields can be initialized as undefined
                    lastPrice: undefined,
                    lastSize: undefined,
                    referencePrice: undefined,
                    previousClose: undefined,
                    bids: [],
                    asks: [],
                    total: undefined,
                    lastTrade: undefined,
                    lastTrial: undefined,
                    isClose: undefined
                };
                newStocks = [...state.stocks, newStock];
            }

            context.globalState.update('stocks', newStocks);
            outputChannel?.appendLine(`Updated global state with new stocks`);
            return { stocks: newStocks };
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        outputChannel?.appendLine(`=== Subscription error ===`);
        outputChannel?.appendLine(`Symbol: ${symbol}`);
        outputChannel?.appendLine(`Error: ${errorMessage}`);
        outputChannel?.appendLine(`Stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
        throw error;
    }
  },

  removeSubscription: async (symbol: string) => {
    const context = ExtensionContextManager.getContext();
    const { wsState, outputChannel } = useWebSocketStore.getState();

    if (wsState !== WebSocketState.CONNECTED) {
      throw new Error('WebSocket not connected');
    }

    try {
      // 發送取消訂閱請求並等待確認
      const response = await useWebSocketStore.getState().sendAndWait(
        {
          action: 'unsubscribe',
          symbols: [symbol],
        },
        (message) =>
          message.type === 'unsubscription_success'
        ,
        5000
      );

      outputChannel?.appendLine(`Unsubscription confirmed for ${symbol}`);

      // 更新本地狀態 - 完全移除股票而不是只改變 isSubscribed
      set((state) => {
        // 過濾掉要移除的股票
        const newStocks = state.stocks.filter(s => s.symbol !== symbol);

        // 保存到 GlobalState
        if (context) {
          context.globalState.update('stocks', newStocks);
        }

        return { stocks: newStocks };
      });

      // 驗證更新是否成功
      const updatedStocks = get().stocks;
      outputChannel?.appendLine(`Updated stocks after unsubscription: ${JSON.stringify(updatedStocks)}`);

    } catch (error) {
      outputChannel?.appendLine(`Unsubscription error: ${error}`);
      throw error;
    }
  },

  subscribeToAllStocks: async () => {
    const context = ExtensionContextManager.getContext();
    const { outputChannel } = useWebSocketStore.getState();
    try {
        const savedStocks = context.globalState.get<StockInventory[]>('stocks', []);
        outputChannel?.appendLine(`Saved stocks: ${JSON.stringify(savedStocks)}`);
        
        // Subscribe to each stock individually
        for (const stock of savedStocks) {
            try {
                await useStockDataStore.getState().addSubscription(stock.symbol);
            } catch (error) {
                outputChannel?.appendLine(`Failed to subscribe to ${stock.symbol}: ${error}`);
                // Continue with next stock even if one fails
                continue;
            }
        }
    } catch (error) {
        console.error('Failed to subscribe to all stocks:', error);
        throw error;
    }
  },

  loadFromGlobalState: () => {
    const context = ExtensionContextManager.getContext();
    try {
      const savedData = context.globalState.get<StockInventory[]>('stocks', []);

      if (savedData && Array.isArray(savedData)) {
        set({ stocks: savedData });
        console.log('Loaded stocks from global state:', savedData);
      }

    } catch (error) {
      console.error('Error loading data from global state:', error);
    }
  },

  saveToGlobalState: () => {
    const context = ExtensionContextManager.getContext();
    try {
      const currentStocks = get().stocks;
      context.globalState.update('stocks', currentStocks);
      console.log('Saved data to global state:', { stocks: currentStocks });
    } catch (error) {
      console.error('Error saving data to global state:', error);
    }
  },

  searchStocks: async (query: string): Promise<StockSearchResult[]> => {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-UUID': useSessionStore.getState().clientUuid
    };

    if (useSessionStore.getState().authToken) {
      headers['Authorization'] = `Bearer ${useSessionStore.getState().authToken}`;
    }

    const response = await axios.get(urls.stocks.search, {
      params: { query: query.trim() },
      headers,
      timeout: 10000
    });

    return response.data?.items || [];
  }
}));