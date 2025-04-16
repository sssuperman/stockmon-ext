import { create } from 'zustand';
import { WebSocketState } from '../types';
import { config } from '../config';
import { StockInventory } from '../types';
import { useStockDataStore } from './stockDataStore';
import { useIndiceDataStore } from './indiceDataStore';
import { WebSocket } from 'ws';
import { OutputChannel } from 'vscode';
import { useSessionStore } from './sessionStore';
import { ExtensionContextManager } from '../utilities/contextManager';
import { LoggerService, LogCategory, LogLevel } from '../utilities/loggerService';
import { updateTwseIndex, updateStock } from './stockDataStoreActionsSubscribe';
import { useAlertStore, AlertTypeEnum } from './alertStore';

// 定義事件系統
export const WebSocketEvents = {
  STOCK_ALERT_RECEIVED: 'stock_alert_received',
  eventListeners: new Map<string, Function[]>(),
  
  // 添加事件監聽器
  addEventListener(event: string, callback: Function) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)?.push(callback);
    return () => this.removeEventListener(event, callback); // 返回取消訂閱函數
  },
  
  // 移除事件監聽器
  removeEventListener(event: string, callback: Function) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  },
  
  // 發布事件
  dispatchEvent(event: string, data: any) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error executing listener for event ${event}:`, error);
        }
      });
    }
  }
};

interface WebSocketStoreState {
  wsState: WebSocketState;
  lastMessage: any | null;
  connect: (logger?: LoggerService | OutputChannel) => void;
  disconnect: () => void;
  sendMessage: (message: any) => void;
  setWsState: (state: WebSocketState) => void;
  socket: WebSocket | null;
  logger?: LoggerService;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  reconnectInterval: number;
  extendedReconnectInterval: number;
  reconnectTimeoutId?: NodeJS.Timeout;
  pingIntervalId?: NodeJS.Timeout;
  waitForMessage: <T = any>(
    predicate: (message: any) => boolean,
    timeout?: number
  ) => Promise<T>;
  sendAndWait: <T = any>(
    message: any,
    predicate: (message: any) => boolean,
    timeout: number
  ) => Promise<T>;
  subscribeAlert: () => void;
  unsubscribeAlert: () => void;
  getAlertSubscribed: () => Promise<string[]>;
  lastAlertFetchTime?: number;
}

export const useWebSocketStore = create<WebSocketStoreState>((set, get) => ({
  lastMessage: null,
  socket: null,
  wsState: WebSocketState.CLOSED,
  logger: undefined,
  reconnectAttempts: 0,
  maxReconnectAttempts: -1,
  reconnectInterval: 3000,
  extendedReconnectInterval: 10000,
  reconnectTimeoutId: undefined,
  pingIntervalId: undefined,
  lastAlertFetchTime: undefined,

  connect: (loggerOrOutputChannel?: LoggerService | OutputChannel) => {
    const { socket, reconnectAttempts } = get();
    
    // Handle both LoggerService and legacy OutputChannel
    let logger: LoggerService;
    if (loggerOrOutputChannel instanceof LoggerService) {
      logger = loggerOrOutputChannel;
    } else if (loggerOrOutputChannel) {
      // If it's an OutputChannel, we'll use our singleton logger instead
      logger = LoggerService.getInstance();
      // For backward compatibility, we can log that we're using a legacy OutputChannel
      logger.warning(LogCategory.WEBSOCKET, 'Using legacy OutputChannel, converting to LoggerService');
    } else {
      // If no logger provided, use the singleton
      logger = LoggerService.getInstance();
    }
    
    set({ logger });
    
    // Rest of the connect method
    logger.info(LogCategory.WEBSOCKET, `Connecting to WebSocket, attempt ${reconnectAttempts + 1}`);
    
    if (get().reconnectTimeoutId) {
      clearTimeout(get().reconnectTimeoutId);
      set({ reconnectTimeoutId: undefined });
    }

    try {
      const context = ExtensionContextManager.getContext();
      const sessionStore = useSessionStore.getState();
      const clientUuid = sessionStore.getOrCreateUuid(context);
      const authToken = sessionStore.authToken;
      
      logger.log(LogCategory.WEBSOCKET, '=== WebSocket Connection Setup ===');
      logger.log(LogCategory.WEBSOCKET, `Connecting with clientUuid: ${clientUuid}`);
      logger.log(LogCategory.WEBSOCKET, `Auth token present: ${!!authToken}`);
      logger.log(LogCategory.WEBSOCKET, `Session authenticated: ${sessionStore.isAuthenticated}`);
      logger.log(LogCategory.WEBSOCKET, `Session info: ${JSON.stringify(sessionStore.sessionInfo)}`);
      logger.log(LogCategory.WEBSOCKET, `Current config: WS_PROTOCOL=${config.WS_PROTOCOL}, WS_HOST=${config.WS_HOST}, WS_PORT=${config.WS_PORT}, WS_PATH=${config.WS_PATH}`);
      
      // 檢查配置是否有效
      if (!config.WS_PROTOCOL || !config.WS_HOST || !config.WS_PORT || !config.WS_PATH) {
        const errorMsg = `Invalid WebSocket configuration: protocol=${config.WS_PROTOCOL}, host=${config.WS_HOST}, port=${config.WS_PORT}, path=${config.WS_PATH}`;
        logger.logError(LogCategory.WEBSOCKET, new Error(errorMsg), 'WebSocket configuration error');
        set({ wsState: WebSocketState.ERROR });
        return;
      }
        
      const params = new URLSearchParams();
      params.append('uuid', clientUuid);
      if (authToken) {
        params.append('token', authToken);
        logger.log(LogCategory.WEBSOCKET, 'Added auth token to URL params');
      }
      
      try {
        const wsUrl = `${config.WS_PROTOCOL}://${config.WS_HOST}:${config.WS_PORT}${config.WS_PATH}?${params.toString()}`;
        logger.log(LogCategory.WEBSOCKET, `Full WebSocket URL: ${wsUrl}`);
        
        const newSocket = new WebSocket(wsUrl);
        set({ wsState: WebSocketState.CONNECTING });

        if (authToken) {
          (newSocket as any).setRequestHeader?.('Authorization', `Bearer ${authToken}`);
        }

        // 如果已經有連接，先關閉
        if (socket) {
          logger.debug(LogCategory.WEBSOCKET, 'Closing existing socket before reconnecting');
          socket.close();
        }

        newSocket.onopen = () => {
          logger.info(LogCategory.WEBSOCKET, 'WebSocket connection established');
          
          // 连接成功后，记录当前认证状态
          const sessionStore = useSessionStore.getState();
          logger.info(LogCategory.WEBSOCKET, `=== WebSocket Authentication Check ===`);
          logger.info(LogCategory.WEBSOCKET, `WebSocket connected with auth state: ${sessionStore.isAuthenticated}`);
          logger.info(LogCategory.WEBSOCKET, `Auth token present: ${!!sessionStore.authToken}`);
          
          // 清除舊的ping定時器
          if (get().pingIntervalId) {
            clearInterval(get().pingIntervalId);
          }
          
          // 設置新的ping定時器
          const pingIntervalId = setInterval(() => {
            const { socket } = get();
            if (socket?.readyState === WebSocket.OPEN) {
              // 使用action欄位發送ping訊息
              get().sendMessage({ action: 'ping' });
              logger.debug(LogCategory.WEBSOCKET, 'Sent ping message');
            }
          }, config.WS_CONFIG.heartbeatInterval);
          
          set({
            wsState: WebSocketState.CONNECTED,
            socket: newSocket,
            reconnectAttempts: 0,
            pingIntervalId
          });
        };

        newSocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data.toString());
            const { logger } = get();
            
            if (!logger) {
              get().disconnect();
              return;
            }

            logger.debug(LogCategory.WEBSOCKET, '=== WebSocket.onmessage ===');
            logger.debug(LogCategory.WEBSOCKET, `Message type: ${message.type}`);
            logger.debug(LogCategory.WEBSOCKET, `Raw message: ${event.data.toString()}`);

            switch (message.type) {
              case 'stock_update':
                const stockData: StockInventory = {
                  symbol: message.symbol,
                  name: message.name || message.symbol,
                  price: message.lastPrice || message.price,
                  change: message.change || 0,
                  changePercent: message.changePercent || 0,
                  open: message.open,
                  high: message.high,
                  low: message.low,
                  close: message.close,
                  volume: message.volume,
                  value: message.value,
                  avgPrice: message.avgPrice,
                  amplitude: message.amplitude,
                  date: message.date,
                  time: new Date(message.time * 1000).toLocaleString(),
                  serial: message.serial,
                  isRealtime: true,
                  type: 'stock',
                  exchange: message.exchange || '',
                  market: message.market || '',
                  alerts: [],
                  isSubscribed: true,
                  
                  // Additional fields for fast channel
                  lastPrice: message.lastPrice,
                  lastSize: message.lastSize,
                  referencePrice: message.referencePrice,
                  previousClose: message.previousClose,
                  bids: message.bids || [],
                  asks: message.asks || [],
                  total: message.total,
                  lastTrade: message.lastTrade,
                  lastTrial: message.lastTrial,
                  isClose: message.isClose
                };

                if (message.symbol === 'IX0001') {
                  logger.log(LogCategory.WEBSOCKET, 'Updating TWSE index in store');
                  updateTwseIndex(stockData);
                  logger.log(LogCategory.WEBSOCKET, `Updated TWSE index: ${JSON.stringify(stockData)}`);
                } else {
                  updateStock(stockData);
                }
                logger.debug(LogCategory.WEBSOCKET, `WebSocketStore Updated data for ${stockData.symbol}`);
                break;
              case 'indice_update':
                logger.debug(LogCategory.INDICE_DATA, `Received indice update for ${message.symbol}: ${message.index}`);
                // 使用新的indiceDataStore處理指數更新，增加所有可用欄位
                useIndiceDataStore.getState().updateIndice({
                  symbol: message.symbol,
                  name: message.name,
                  index: message.index,
                  exchange: message.exchange,
                  time: message.time,
                  previousClose: message.previous_close,
                  change: message.change,
                  changePercent: message.change_percent,
                  date: message.date,
                  isRealtime: true
                });
                break;
              case 'connection_established':
                set({ wsState: WebSocketState.CONNECTED });
                break;
              case 'subscription_success':
                logger.log(LogCategory.WEBSOCKET, '=== Processing subscription_success ===');
                break;
              case 'subscription_error':
                logger.log(LogCategory.WEBSOCKET, `WebSocketStore Subscription error: ${message.error}`);
                break;
              case 'unsubscription_success':
                logger.log(LogCategory.WEBSOCKET, `WebSocketStore Unsubscribe successful: ${message.symbols?.join(', ')}`);
                break;
              case 'alert_subscription_success':
                logger.log(LogCategory.WEBSOCKET, 'Alert subscription successful');
                break;
              case 'alert_unsubscription_success':
                logger.log(LogCategory.WEBSOCKET, 'Alert unsubscription successful');
                break;
              case 'alert_subscribed_symbols':
                logger.log(LogCategory.WEBSOCKET, `Alert subscribed symbols: ${message.symbols?.join(', ') || 'none'}`);
                break;
              case 'stock_alert':
                logger.log(LogCategory.WEBSOCKET, `Received stock alert: ${JSON.stringify(message)}`);
                // 如果有警報處理邏輯，應該在這裡處理
                // 例如更新 stockDataStore 中的股票警報狀態或者顯示通知
                if (message.symbol && message.alert_type) {
                  // 可以擴展此部分以處理不同類型的警報
                  useStockDataStore.getState().addAlertToStock(
                    message.symbol, 
                    {
                      type: message.alert_type,
                      message: message.message || '',
                      timestamp: new Date().toISOString(),
                      id: message.id || `alert-${Date.now()}`
                    }
                  );
                }
                break;
              case 'stock_alerts':
                logger.log(LogCategory.WEBSOCKET, `Received stock alerts message: ${JSON.stringify(message)}`);
                // 處理多個股票警報
                if (message.alerts && Array.isArray(message.alerts)) {
                  message.alerts.forEach((alert: {
                    id?: string | number;
                    alert_id?: number;
                    stock?: { symbol: string; name?: string };
                    symbol?: string;
                    name?: string;
                    alert_rule?: { alert_type: string; threshold?: number; parameters?: any };
                    alert_type?: string;
                    threshold?: number;
                    current_value?: number;
                    price?: number;
                    change_percent?: number;
                    message?: string;
                    time?: string;
                    triggered_at?: string;
                    test?: boolean;
                    // 添加後端新增的時間字段
                    timestamp?: number;
                    timezone?: string;
                    formatted_time?: string;
                  }) => {
                    // 判斷是舊格式還是新格式
                    const symbol = alert.stock?.symbol || alert.symbol;
                    const alertType = alert.alert_rule?.alert_type || alert.alert_type;
                    const alertId = alert.id || alert.alert_id || `alert-${Date.now()}`;
                    const threshold = alert.alert_rule?.threshold || alert.threshold;
                    
                    // 處理時間戳，優先使用後端提供的時間格式
                    const timestamp = alert.timestamp ? new Date(alert.timestamp).toISOString() : 
                              alert.triggered_at || alert.time || new Date().toISOString();
                    
                    // 格式化時間字符串，優先使用後端提供的
                    const formattedTime = alert.formatted_time || 
                              (timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString());
                    
                    if (symbol && alertType) {
                      // 添加到股票資料中
                      useStockDataStore.getState().addAlertToStock(
                        symbol,
                        {
                          type: alertType,
                          message: alert.message || `${alert.name || symbol} 價格 ${alert.price} (${alert.change_percent}%)`,
                          timestamp,
                          id: String(alertId),
                          threshold,
                          currentValue: alert.current_value,
                          price: alert.price,
                          formattedTime // 添加格式化的時間
                        }
                      );
                      
                      // 更新 alertStore 中的提醒歷史
                      const isAuthenticated = useSessionStore.getState().isAuthenticated;
                      if (isAuthenticated && !alert.test) {
                        try {
                          // 只在特定時間間隔內更新提醒列表，避免頻繁請求
                          // 獲取上次提醒列表更新時間
                          const lastAlertFetchTime = get().lastAlertFetchTime || 0;
                          const now = Date.now();
                          
                          // 如果距離上次更新超過10秒，才重新獲取
                          if (now - lastAlertFetchTime > 10000) {
                            useAlertStore.getState().fetchAlerts().then(() => {
                              logger.log(LogCategory.WEBSOCKET, `已更新提醒列表`);
                              // 更新時間戳
                              set({ lastAlertFetchTime: now });
                            });
                          } else {
                            logger.debug(LogCategory.WEBSOCKET, `跳過提醒列表更新：距上次更新僅 ${(now - lastAlertFetchTime) / 1000} 秒`);
                          }
                          
                          // 警報歷史記錄暫時不自動獲取，避免大量 API 請求
                          // 用戶可以在警報頁面手動加載歷史記錄
                        } catch (err) {
                          logger.log(LogCategory.WEBSOCKET, `更新提醒列表失敗: ${err}`);
                        }
                      }
                      
                      // 發布提醒事件
                      WebSocketEvents.dispatchEvent(WebSocketEvents.STOCK_ALERT_RECEIVED, {
                        id: alertId,
                        symbol,
                        name: alert.name || alert.stock?.name || symbol,
                        alertType,
                        message: alert.message || `價格 ${alert.price} (${alert.change_percent}%)`,
                        threshold,
                        currentValue: alert.current_value,
                        price: alert.price,
                        timestamp,
                        formattedTime, // 添加格式化的時間
                        timezone: alert.timezone // 添加時區信息
                      });
                      
                      logger.log(LogCategory.WEBSOCKET, `股票提醒已添加到股票資料: ${symbol}, 類型: ${alertType}, 時間: ${formattedTime}`);
                    }
                  });
                }
                break;
              case 'pong':
                logger.log(LogCategory.WEBSOCKET, 'WebSocketStore Received pong');
                break;
              case 'error':
                logger.log(LogCategory.WEBSOCKET, `WebSocketStore WebSocket error: ${message.error}`);
                break;
              default:
                logger.log(LogCategory.WEBSOCKET, `WebSocketStore Unknown message type: ${message.type}`);
                break;
            }
          } catch (error) {
            const { logger } = get();
            if (logger && !logger.dispose) {
              logger.log(LogCategory.WEBSOCKET, `=== Error in onmessage ===\n${error}`);
            }
          }
        };

        newSocket.onclose = (event) => {
          logger.warning(LogCategory.WEBSOCKET, `WebSocket connection closed: ${event.code} ${event.reason}`);
          set({ wsState: WebSocketState.CLOSED, socket: null });
          
          // 安排重新連接
          const { reconnectAttempts } = get();
          const interval = reconnectAttempts >= 3 
            ? get().extendedReconnectInterval 
            : get().reconnectInterval;

          const reconnectTimeoutId = setTimeout(() => {
            set(state => ({ reconnectAttempts: state.reconnectAttempts + 1 }));
            get().connect(logger);
          }, interval);
          
          set({ 
            wsState: WebSocketState.RECONNECTING,
            reconnectTimeoutId 
          });
          
          logger.info(LogCategory.WEBSOCKET,
            `Attempting to reconnect in ${interval/1000} seconds... (Attempt ${reconnectAttempts + 1})`
          );
        };

        newSocket.onerror = (error) => {
          logger.logError(LogCategory.WEBSOCKET, error, 'WebSocket connection error');
          set({ wsState: WebSocketState.ERROR });
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
        logger?.log(LogCategory.WEBSOCKET, `Error connecting to WebSocket: ${errorMessage}`);
        set({ wsState: WebSocketState.ERROR });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      logger?.log(LogCategory.WEBSOCKET, `Error connecting to WebSocket: ${errorMessage}`);
      set({ wsState: WebSocketState.ERROR });
    }
  },

  disconnect: () => {
    const { socket, logger } = get();
    
    if (socket) {
      logger?.info(LogCategory.WEBSOCKET, 'Manually disconnecting WebSocket');
      socket.close();
      set({ 
        socket: null, 
        wsState: WebSocketState.CLOSED,
        reconnectAttempts: 0
      });
    } else {
      logger?.debug(LogCategory.WEBSOCKET, 'Disconnect called but no active socket');
    }
    
    // 清除重連計時器
    if (get().reconnectTimeoutId) {
      clearTimeout(get().reconnectTimeoutId);
      set({ reconnectTimeoutId: undefined });
    }
    
    // 清除ping定時器
    if (get().pingIntervalId) {
      clearInterval(get().pingIntervalId);
      set({ pingIntervalId: undefined });
    }
  },

  sendMessage: (message: any) => {
    const { socket, logger } = get();
    if (socket?.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(message);
      socket.send(messageStr);
      if (logger) {
        logger.log(LogCategory.WEBSOCKET, `Sent message: ${messageStr}`);
      }
    } else {
      if (logger) {
        logger.log(LogCategory.WEBSOCKET, 'Cannot send message: WebSocket not connected');
      }
    }
  },

  setWsState: (state: WebSocketState) => {
    const currentState = get().wsState;
    if (currentState !== state) {
      const { logger } = get();
      set({ wsState: state });
    }
  },

  // 訂閱股票警報
  subscribeAlert: () => {
    const { socket, logger } = get();
    if (socket?.readyState === WebSocket.OPEN) {
      const message = { action: 'subscribe_alert' };
      const messageStr = JSON.stringify(message);
      socket.send(messageStr);
      if (logger) {
        logger.log(LogCategory.WEBSOCKET, `Sent alert subscription: ${messageStr}`);
      }
    } else {
      if (logger) {
        logger.log(LogCategory.WEBSOCKET, 'Cannot subscribe to alerts: WebSocket not connected');
      }
    }
  },

  // 取消訂閱股票警報
  unsubscribeAlert: () => {
    const { socket, logger } = get();
    if (socket?.readyState === WebSocket.OPEN) {
      const message = { action: 'unsubscribe_alert' };
      const messageStr = JSON.stringify(message);
      socket.send(messageStr);
      if (logger) {
        logger.log(LogCategory.WEBSOCKET, `Sent alert unsubscription: ${messageStr}`);
      }
    } else {
      if (logger) {
        logger.log(LogCategory.WEBSOCKET, 'Cannot unsubscribe from alerts: WebSocket not connected');
      }
    }
  },

  // 獲取當前訂閱的警報股票
  getAlertSubscribed: async () => {
    const { socket, logger } = get();
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        const message = { action: 'get_alert_subscribed' };
        const response = await get().sendAndWait(
          message,
          (msg) => msg.type === 'alert_subscribed_symbols',
          5000
        );
        logger?.log(LogCategory.WEBSOCKET, `Received alert subscribed symbols: ${JSON.stringify(response)}`);
        return response.symbols || [];
      } catch (error) {
        logger?.logError(LogCategory.WEBSOCKET, error, 'Error getting alert subscribed symbols');
        return [];
      }
    } else {
      logger?.log(LogCategory.WEBSOCKET, 'Cannot get alert subscribed symbols: WebSocket not connected');
      return [];
    }
  },

  waitForMessage: <T = any>(
    predicate: (message: any) => boolean,
    timeout: number = 5000
  ): Promise<T> => {
    const { logger } = get();
    
    return new Promise((resolve, reject) => {
        let timeoutId: NodeJS.Timeout;

        const messageHandler = (event: any) => {
            try {
                const message = JSON.parse(event.data.toString());
                logger?.log(LogCategory.WEBSOCKET, `Received message: ${JSON.stringify(message)}`);
                
                if (predicate(message)) {
                    logger?.log(LogCategory.WEBSOCKET, `Message matches condition: ${JSON.stringify(message)}`);
                    get().socket?.removeEventListener('message', messageHandler);
                    clearTimeout(timeoutId);
                    resolve(message as T);
                }
            } catch (error) {
                logger?.log(LogCategory.WEBSOCKET, `Error processing message: ${error}`);
            }
        };

        get().socket?.addEventListener('message', messageHandler);

        timeoutId = setTimeout(() => {
            get().socket?.removeEventListener('message', messageHandler);
            logger?.log(LogCategory.WEBSOCKET, `Timeout waiting for message after ${timeout}ms`);
            reject(new Error(`Timeout waiting for message after ${timeout}ms`));
        }, timeout);
    });
  },

  sendAndWait: async <T = any>(
    message: any,
    predicate: (message: any) => boolean,
    timeout: number = 5000
  ): Promise<T> => {
    const { logger } = get();
    
    try {
        const { socket } = get();
        if (socket?.readyState === WebSocket.OPEN) {
            const messageStr = JSON.stringify(message);
            socket.send(messageStr);
            logger?.log(LogCategory.WEBSOCKET, `Sent message: ${messageStr}`);
        } else {
            throw new Error('Cannot send message: WebSocket not connected');
        }

        return await get().waitForMessage(predicate, timeout);
    } catch (error) {
        logger?.log(LogCategory.WEBSOCKET, `SendAndWait error: ${error}`);
        throw error;
    }
  }
}));

export const subscribeToWebSocket = (callback: (state: WebSocketState) => void) => {
  useWebSocketStore.subscribe(
    (state) => state.wsState,
  );
};

export const subscribeToWebSocketMessages = (callback: (message: any) => void) => {
  useWebSocketStore.subscribe(
    (state) => state.lastMessage,
  );
}; 