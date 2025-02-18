import { create } from 'zustand';
import { WebSocketState } from '../types';
import { config } from '../config';
import { StockInventory } from '../types';
import { useStockDataStore } from './stockDataStore';
import { WebSocket } from 'ws';
import { OutputChannel } from 'vscode';
import { useSessionStore } from './sessionStore';
import { ExtensionContextManager } from '../utilities/contextManager';

interface WebSocketStoreState {
  wsState: WebSocketState;
  lastMessage: any | null;
  connect: (outputChannel: OutputChannel) => void;
  disconnect: () => void;
  sendMessage: (message: any) => void;
  setWsState: (state: WebSocketState) => void;
  socket: WebSocket | null;
  outputChannel?: OutputChannel;
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
  outputChannel: undefined,
  reconnectAttempts: 0,
  maxReconnectAttempts: -1,
  reconnectInterval: 3000,
  extendedReconnectInterval: 10000,
  reconnectTimeoutId: undefined,

  connect: (outputChannel: OutputChannel) => {
    const { socket, reconnectAttempts, maxReconnectAttempts } = get();
    set({ outputChannel });
    
    if (socket?.readyState === WebSocket.OPEN) {
      outputChannel.appendLine('WebSocket already connected');
      return;
    }

    if (get().reconnectTimeoutId) {
      clearTimeout(get().reconnectTimeoutId);
      set({ reconnectTimeoutId: undefined });
    }

    try {
      const context = ExtensionContextManager.getContext();
      const clientUuid = useSessionStore.getState().getOrCreateUuid(context);
      const authToken = useSessionStore.getState().authToken;
      
      const params = new URLSearchParams();
      params.append('uuid', clientUuid);
      if (authToken) {
        params.append('token', authToken);
      }
      
      const wsUrl = `${config.WS_PROTOCOL}://${config.WS_HOST}:${config.WS_PORT}${config.WS_PATH}?${params.toString()}`;
      outputChannel.appendLine(`WebSocketStore Connecting to WebSocket: ${wsUrl}`);
      if (reconnectAttempts > 0) {
        outputChannel.appendLine(`Reconnect attempt: ${reconnectAttempts + 1}`);
      }
      
      const newSocket = new WebSocket(wsUrl);
      set({ wsState: WebSocketState.CONNECTING });

      newSocket.onopen = () => {
        const { outputChannel } = get();
        outputChannel?.appendLine('WebSocket connection established');
        set({
          wsState: WebSocketState.CONNECTED,
          socket: newSocket,
          reconnectAttempts: 0
        });
      };

      newSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data.toString());
          const { outputChannel } = get();
          
          if (!outputChannel) {
            get().disconnect();
            return;
          }

          outputChannel.appendLine('=== WebSocket.onmessage ===');
          outputChannel.appendLine(`Message type: ${message.type}`);
          outputChannel.appendLine(`Raw message: ${event.data.toString()}`);

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
                outputChannel?.appendLine('Updating TWSE index in store');
                useStockDataStore.getState().updateTwseIndex(stockData);
                outputChannel?.appendLine(`Updated TWSE index: ${JSON.stringify(stockData)}`);
              } else {
                useStockDataStore.getState().updateStock(stockData);
              }
              outputChannel?.appendLine(`WebSocketStore Updated data for ${stockData.symbol}`);
              break;
            case 'connection_established':
              set({ wsState: WebSocketState.CONNECTED });
              break;
            case 'subscription_success':
              outputChannel?.appendLine('=== Processing subscription_success ===');
              break;
            case 'subscription_error':
              outputChannel?.appendLine(`WebSocketStore Subscription error: ${message.error}`);
              break;
            case 'unsubscription_success':
              outputChannel?.appendLine(`WebSocketStore Unsubscribe successful: ${message.symbols?.join(', ')}`);
              break;
            case 'pong':
              outputChannel?.appendLine('WebSocketStore Received pong');
              break;
            case 'error':
              outputChannel?.appendLine(`WebSocketStore WebSocket error: ${message.error}`);
              break;
            default:
              outputChannel?.appendLine(`WebSocketStore Unknown message type: ${message.type}`);
              break;
          }
        } catch (error) {
          const { outputChannel } = get();
          if (outputChannel && !outputChannel.dispose) {
            outputChannel.appendLine(`=== Error in onmessage ===\n${error}`);
          }
        }
      };

      newSocket.onclose = (event) => {
        const { outputChannel, reconnectAttempts } = get();
        outputChannel?.appendLine(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
        
        set({ wsState: WebSocketState.CLOSED, socket: null });

        const interval = reconnectAttempts >= 3 
          ? get().extendedReconnectInterval 
          : get().reconnectInterval;

        const reconnectTimeoutId = setTimeout(() => {
          set(state => ({ reconnectAttempts: state.reconnectAttempts + 1 }));
          get().connect(outputChannel!);
        }, interval);
        
        set({ 
          wsState: WebSocketState.RECONNECTING,
          reconnectTimeoutId 
        });
        
        outputChannel?.appendLine(
          `Attempting to reconnect in ${interval/1000} seconds... (Attempt ${reconnectAttempts + 1})`
        );
      };

      newSocket.onerror = (error) => {
        const { outputChannel } = get();
        const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
        outputChannel?.appendLine(`WebSocket error: ${errorMessage}`);
        set({ wsState: WebSocketState.ERROR });
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      outputChannel.appendLine(`Error connecting to WebSocket: ${errorMessage}`);
      set({ wsState: WebSocketState.ERROR });
    }
  },

  disconnect: () => {
    const { socket, outputChannel, reconnectTimeoutId } = get();
    
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
    }
    
    if (socket) {
      socket.close(1000, 'Manual disconnect');
      outputChannel?.appendLine('WebSocket manually disconnected');
    }
    
    set({
      wsState: WebSocketState.CLOSED,
      socket: null,
      reconnectAttempts: 0,
      reconnectTimeoutId: undefined
    });
  },

  sendMessage: (message: any) => {
    const { socket, outputChannel } = get();
    if (socket?.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(message);
      socket.send(messageStr);
      outputChannel?.appendLine(`Sent message: ${messageStr}`);
    } else {
      outputChannel?.appendLine('Cannot send message: WebSocket not connected');
    }
  },

  setWsState: (state: WebSocketState) => {
    const currentState = get().wsState;
    if (currentState !== state) {
      const { outputChannel } = get();
      set({ wsState: state });
    }
  },

  waitForMessage: <T = any>(
    predicate: (message: any) => boolean,
    timeout: number = 5000
  ): Promise<T> => {
    const { outputChannel } = get();
    
    return new Promise((resolve, reject) => {
        let timeoutId: NodeJS.Timeout;

        const messageHandler = (event: any) => {
            try {
                const message = JSON.parse(event.data.toString());
                outputChannel?.appendLine(`Received message: ${JSON.stringify(message)}`);
                
                if (predicate(message)) {
                    outputChannel?.appendLine(`Message matches condition: ${JSON.stringify(message)}`);
                    get().socket?.removeEventListener('message', messageHandler);
                    clearTimeout(timeoutId);
                    resolve(message as T);
                }
            } catch (error) {
                outputChannel?.appendLine(`Error processing message: ${error}`);
            }
        };

        get().socket?.addEventListener('message', messageHandler);

        timeoutId = setTimeout(() => {
            get().socket?.removeEventListener('message', messageHandler);
            outputChannel?.appendLine(`Timeout waiting for message after ${timeout}ms`);
            reject(new Error(`Timeout waiting for message after ${timeout}ms`));
        }, timeout);
    });
  },

  sendAndWait: async <T = any>(
    message: any,
    predicate: (message: any) => boolean,
    timeout: number = 5000
  ): Promise<T> => {
    const { outputChannel } = get();
    
    try {
        const { socket } = get();
        if (socket?.readyState === WebSocket.OPEN) {
            const messageStr = JSON.stringify(message);
            socket.send(messageStr);
            outputChannel?.appendLine(`Sent message: ${messageStr}`);
        } else {
            throw new Error('Cannot send message: WebSocket not connected');
        }

        return await get().waitForMessage(predicate, timeout);
    } catch (error) {
        outputChannel?.appendLine(`SendAndWait error: ${error}`);
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