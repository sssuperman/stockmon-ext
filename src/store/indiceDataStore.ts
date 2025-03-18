import { create } from 'zustand';
import { IndiceData } from '../types';
import { LoggerService, LogCategory } from '../utilities/loggerService';

// 定義指數名稱映射
const indiceNameMap: Record<string, string> = {
  'IX0001': '加權指數', // 台灣加權指數
  'IX0043': '櫃買指數',           // 櫃買指數
  // 可以添加更多指數
};

interface IndiceDataState {
  // 存儲所有指數數據的映射
  indices: Record<string, IndiceData>;
  
  // 更新指數數據
  updateIndice: (data: Partial<IndiceData> & { symbol: string }) => void;
  
  // 獲取特定指數
  getIndice: (symbol: string) => IndiceData | undefined;
  
  // 獲取所有指數列表
  getAllIndices: () => IndiceData[];
  
  // 清除所有指數數據
  clearAll: () => void;
}

export const useIndiceDataStore = create<IndiceDataState>((set, get) => ({
  // 初始化空的指數映射
  indices: {},
  
  // 更新指數數據
  updateIndice: (data) => {
    const logger = LoggerService.getInstance();
    
    try {
      // 獲取指數名稱，如果映射中沒有則使用symbol作為名稱
      const name = indiceNameMap[data.symbol] || data.symbol;
      
      // 格式化時間
      const formattedTime = data.time 
        ? new Date(data.time).toLocaleString() 
        : new Date().toLocaleString();
      
      // 獲取現有的指數數據
      const existingIndice = get().indices[data.symbol];
      
      // 計算漲跌和漲跌幅
      let change = data.change;
      let changePercent = data.changePercent;
      
      // 如果沒有提供漲跌和漲跌幅，但有現有數據和前收盤價，則計算
      if (existingIndice && existingIndice.previousClose && data.index && !change) {
        change = data.index - existingIndice.previousClose;
        changePercent = (change / existingIndice.previousClose) * 100;
      }
      
      // 更新指數數據
      set((state) => ({
        indices: {
          ...state.indices,
          [data.symbol]: {
            ...existingIndice,
            ...data,
            name,
            formattedTime,
            change,
            changePercent,
            isRealtime: true,
          },
        },
      }));
      
      logger.debug(LogCategory.INDICE_DATA, `Updated indice data for ${data.symbol}: ${data.index}`);
    } catch (error) {
      logger.logError(LogCategory.INDICE_DATA, error, `Failed to update indice data for ${data.symbol}`);
    }
  },
  
  // 獲取特定指數
  getIndice: (symbol) => {
    return get().indices[symbol];
  },
  
  // 獲取所有指數列表
  getAllIndices: () => {
    return Object.values(get().indices);
  },
  
  // 清除所有指數數據
  clearAll: () => {
    set({ indices: {} });
  },
}));

// 添加訂閱函數，方便組件訂閱指數數據變化
export const subscribeToIndiceData = (callback: (indices: Record<string, IndiceData>) => void) => {
  return useIndiceDataStore.subscribe((state) => {
    callback(state.indices);
  });
};

// 添加訂閱特定指數的函數
export const subscribeToSpecificIndice = (symbol: string, callback: (indice: IndiceData | undefined) => void) => {
  return useIndiceDataStore.subscribe((state) => {
    callback(state.indices[symbol]);
  });
}; 