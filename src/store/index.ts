export * from './sessionStore';
export * from './websocketStore';
export * from './stockDataStore';

// 輔助函數
export const subscribeToStore = <T>(
  store: { subscribe: (selector: (state: T) => any, callback: () => void) => void },
  selector: (state: T) => any,
  callback: () => void
) => {
  store.subscribe(selector, callback);
};

// 使用示例：
// import { useSessionStore, useStockDataStore, useAlertStore, useWebSocketStore } from './store'
//
// const sessionState = useSessionStore()
// const stockDataState = useStockDataStore()
// const alertState = useAlertStore()
// const wsState = useWebSocketStore() 