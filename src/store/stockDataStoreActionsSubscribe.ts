
import { useWebSocketStore } from './websocketStore';
import { LoggerService, LogCategory } from '../utilities/loggerService';
import { ExtensionContextManager } from '../utilities/contextManager';
import { StockInventory, WebSocketState } from '../types';
import { useStockDataStore } from './stockDataStore';

export const subscribeToAllStocks = async () => {

    const logger = LoggerService.getInstance();

    try {
        const savedStocks = ExtensionContextManager.getContext().globalState.get<StockInventory[]>('stocks', []);
        logger.debug(LogCategory.STOCK_DATA, `Local Saved stocks: ${JSON.stringify(savedStocks)}`);

        // 檢查是否有保存的股票
        const symbolsList = savedStocks.map(stock => stock.symbol);

        // 如果沒有股票，則直接返回，避免發送空訂閱請求
        if (symbolsList.length === 0) {
            logger.log(LogCategory.STOCK_DATA, 'No stocks to subscribe, skipping subscription');
            return;
        }

        try {
            await subscribeStock(symbolsList);
        } catch (error) {
            logger.logError(LogCategory.STOCK_DATA, error, `Failed to subscribe to ${symbolsList}`);
            // Continue with next stock even if one fails
        }

    } catch (error) {
        logger.logError(LogCategory.STOCK_DATA, error, 'Failed to subscribe to all stocks');
        throw error;
    }
};
export const subscribeStock = async (symbols: string[]) => {
    const logger = LoggerService.getInstance();

    try {
        // 檢查是否提供了有效的股票代碼
        if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
            logger.warning(LogCategory.STOCK_DATA, '訂閱請求未提供有效的股票代碼');
            return { type: 'warning', message: '未提供股票代碼' };
        }

        const response = await useWebSocketStore.getState().sendAndWait(
            { action: 'subscribe', symbols },
            (message) => message.type === 'subscription_success',
            5000
        );

        useStockDataStore.setState((state) => ({
            stocks: state.stocks.map(stock =>
                symbols.includes(stock.symbol)
                    ? { ...stock, isSubscribed: true }
                    : stock
            )
        }));

        return response;
    } catch (error) {
        logger.logError(LogCategory.STOCK_DATA, error, 'WebSocket subscription failed');
        throw error;
    }
};

export const unsubscribeStock = async (symbol: string) => {
    const logger = LoggerService.getInstance();
    const { wsState } = useWebSocketStore.getState();

    if (wsState !== WebSocketState.CONNECTED) {
        throw new Error('WebSocket not connected');
    }

    try {
        const response = await useWebSocketStore.getState().sendAndWait(
            {
                action: 'unsubscribe',
                symbols: [symbol],
            },
            (message) => message.type === 'unsubscription_success',
            5000
        );

        useStockDataStore.setState((state) => ({
            stocks: state.stocks.map(stock =>
                stock.symbol === symbol
                    ? { ...stock, isSubscribed: false }
                    : stock
            )
        }));

        logger.log(LogCategory.STOCK_DATA, `Unsubscription confirmed for ${symbol}`);
        return response;
    } catch (error) {
        logger.logError(LogCategory.STOCK_DATA, error, 'Unsubscription error');
        throw error;
    }
};




export const updateStock = (stockData: StockInventory) =>
    useStockDataStore.setState((state) => {
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
    });

export const updateTwseIndex = (indexData: StockInventory) =>
    useStockDataStore.setState((state) => ({
        twseIndex: {
            ...indexData,
            symbol: 'IX0001',
            name: '發行量加權股價指數',
            type: 'index',
            isRealtime: true,
        }
    }));

