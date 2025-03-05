import { create } from 'zustand';
import { WebSocketState } from '../types';
import { config } from '../config';
import { StockInventory } from '../types';
import { useStockDataStore } from './stockDataStore';
import { WebSocket } from 'ws';
import { OutputChannel } from 'vscode';
import { useSessionStore } from './sessionStore';
import { ExtensionContextManager } from '../utilities/contextManager';
import { LoggerService, LogCategory, LogLevel } from '../utilities/loggerService';

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
  waitForMessage: <T = any>(
    predicate: (message: any) => boolean,
    timeout?: number
  ) => Promise<T>;
  sendAndWait: <T = any>(
    message: any,
    predicate: (message: any) => boolean,
    timeout: number
  ) => Promise<T>;
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
          if (authToken) {
            logger.log(LogCategory.WEBSOCKET, 'Sending authentication message');
            const authMessage = {
              type: 'authenticate',
              token: authToken
            };
            newSocket.send(JSON.stringify(authMessage));
          }
          set({
            wsState: WebSocketState.CONNECTED,
            socket: newSocket,
            reconnectAttempts: 0
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
                  useStockDataStore.getState().updateTwseIndex(stockData);
                  logger.log(LogCategory.WEBSOCKET, `Updated TWSE index: ${JSON.stringify(stockData)}`);
                } else {
                  useStockDataStore.getState().updateStock(stockData);
                }
                logger.log(LogCategory.WEBSOCKET, `WebSocketStore Updated data for ${stockData.symbol}`);
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