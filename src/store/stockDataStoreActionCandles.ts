import { LogCategory, LoggerService } from "src/utilities/loggerService";
import { useSessionStore } from "./sessionStore";
import { isTokenExpired } from "src/utilities/tokenUtils";
import axios from "axios";
import { CandleData } from "src/types";
import { urls } from "src/config";
// 添加獲取 5 分鐘 K 線資料的方法
export const getStock5mCandles = async (symbol: string) => {
  const logger = LoggerService.getInstance();
  const sessionStore = useSessionStore.getState();

  try {
    // 檢查用戶是否已登入
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.STOCK_DATA, '用戶未登入，無法獲取股票 5 分鐘 K 線資料');
      return [];
    }

    // 檢查 token 是否過期
    if (sessionStore.authToken && isTokenExpired(sessionStore.authToken)) {
      logger.info(LogCategory.STOCK_DATA, '認證令牌已過期，需要重新登入');
      return [];
    }

    // 構建請求頭
    const headers = {
      'Authorization': `Bearer ${sessionStore.authToken}`,
      'Content-Type': 'application/json',
      'X-Client-UUID': sessionStore.clientUuid
    };

    // 獲取股票 5 分鐘 K 線資料
    const response = await axios.get<CandleData[]>(urls.stocks.candles5m(symbol), { headers });

    // 檢查響應數據的格式
    logger.debug(LogCategory.STOCK_DATA, `5 分鐘 K 線數據響應格式樣例: ${response.data.length > 0 ? JSON.stringify(response.data[0]) : 'Empty data'}`);

    // 確保響應數據符合 CandleData 介面格式
    let processedData = response.data;

    // 如果發現數據不符合我們的 CandleData 介面，嘗試轉換
    if (response.data.length > 0) {
      const firstItem = response.data[0] as any;

      // 檢查是否需要字段映射
      if (
        firstItem.hasOwnProperty('date') &&
        !firstItem.hasOwnProperty('timestamp')
      ) {
        // 使用舊格式轉換為新格式
        processedData = response.data.map(item => {
          const oldItem = item as any;
          return {
            timestamp: oldItem.date || new Date().toISOString(),
            timeframe: '5min',
            open_price: oldItem.open || 0,
            high_price: oldItem.high || 0,
            low_price: oldItem.low || 0,
            close_price: oldItem.close || 0,
            volume: oldItem.volume || 0,
            amount: oldItem.value || 0
          } as CandleData;
        });
        logger.info(LogCategory.STOCK_DATA, '已將舊格式 K 線數據轉換為新格式');
      }
    }

    logger.debug(LogCategory.STOCK_DATA, `成功獲取 ${symbol} 的 5 分鐘 K 線資料，共 ${processedData.length} 筆`);
    return processedData;
  } catch (error: any) {
    // 處理特定錯誤碼
    if (error.response) {
      const status = error.response.status;

      // 如果是未認證 (401)
      if (status === 401) {
        logger.warning(LogCategory.STOCK_DATA, '認證失敗 (401)，需要重新登入');
        return [];
      } else if (status === 202) {
        // 處理 202 狀態（正在處理中）
        logger.info(LogCategory.STOCK_DATA, `服務器正在處理 ${symbol} 的 K 線資料，稍後再試`);
        return [];
      } else if (status === 404) {
        // 處理 404 狀態（找不到資源）
        logger.warning(LogCategory.STOCK_DATA, `找不到 ${symbol} 的 K 線資料`);
        return [];
      }
    }

    logger.logError(LogCategory.STOCK_DATA, error, `獲取 ${symbol} 的 5 分鐘 K 線資料時發生錯誤`);
    return [];
  }
};

// 添加同時獲取多支股票 5 分鐘 K 線資料的方法
export const getMultipleStock5mCandles = async (symbols: string[]): Promise<Record<string, CandleData[]>> => {
  const logger = LoggerService.getInstance();
  const sessionStore = useSessionStore.getState();

  try {
    // 檢查參數
    if (!symbols || symbols.length === 0) {
      logger.warning(LogCategory.STOCK_DATA, '未提供股票代號，無法獲取 K 線資料');
      return {};
    }

    // 限制請求數量，避免過載
    if (symbols.length > 20) {
      logger.warning(LogCategory.STOCK_DATA, `請求股票數量過多，最多同時請求 20 支股票，當前請求 ${symbols.length} 支`);
      symbols = symbols.slice(0, 20);
    }

    // 檢查用戶是否已登入
    if (!sessionStore.isAuthenticated || !sessionStore.authToken) {
      logger.warning(LogCategory.STOCK_DATA, '用戶未登入，無法獲取股票 5 分鐘 K 線資料');
      return {};
    }

    // 檢查 token 是否過期
    if (sessionStore.authToken && isTokenExpired(sessionStore.authToken)) {
      logger.info(LogCategory.STOCK_DATA, '認證令牌已過期，需要重新登入');
      return {};
    }

    // 構建請求頭
    const headers = {
      'Authorization': `Bearer ${sessionStore.authToken}`,
      'Content-Type': 'application/json',
      'X-Client-UUID': sessionStore.clientUuid
    };

    logger.debug(LogCategory.STOCK_DATA, `開始獲取多支股票的 5 分鐘 K 線資料: ${symbols.join(', ')}`);

    // 確保 symbols 是一個陣列
    if (!Array.isArray(symbols)) {
      logger.logError(LogCategory.STOCK_DATA, new Error(`symbols 不是有效的陣列: ${JSON.stringify(symbols)}`), 'Invalid symbols format');
      return {};
    }
    const requestBody = { symbols: symbols };
    logger.debug(LogCategory.STOCK_DATA, `完整的請求體: ${JSON.stringify(requestBody)}`);

    // 使用 POST 方法獲取多支股票的 K 線資料
    const response = await axios.post(
      urls.stocks.multiCandles5m,
      symbols,
      { headers }
    );

    // 添加請求體的詳細日誌，用於調試
    logger.info(LogCategory.STOCK_DATA, `發送的請求數據: ${JSON.stringify({ symbols: symbols })}`);

    if (!response.data || !response.data.data) {
      logger.warning(LogCategory.STOCK_DATA, '伺服器回應數據格式不正確');
      return {};
    }

    const { data, status } = response.data;

    // 處理每支股票的狀態
    Object.entries(status).forEach(([symbol, statusInfo]: [string, any]) => {
      if (statusInfo.status !== 'success') {
        logger.warning(
          LogCategory.STOCK_DATA,
          `獲取 ${symbol} K 線資料狀態: ${statusInfo.status}, 訊息: ${statusInfo.message || '無'}`
        );
      } else {
        logger.debug(
          LogCategory.STOCK_DATA,
          `成功獲取 ${symbol} K 線資料，共 ${statusInfo.count || 0} 筆`
        );
      }
    });

    return data;
  } catch (error: any) {
    // 處理特定錯誤碼
    if (error.response) {
      const status = error.response.status;

      // 如果是未認證 (401)
      if (status === 401) {
        logger.warning(LogCategory.STOCK_DATA, '認證失敗 (401)，需要重新登入');
        return {};
      } else if (status === 202) {
        // 處理 202 狀態（正在處理中）
        logger.info(LogCategory.STOCK_DATA, '服務器正在處理 K 線資料，稍後再試');
        return {};
      } else if (status === 404) {
        // 處理 404 狀態（找不到資源）
        logger.warning(LogCategory.STOCK_DATA, '找不到請求的 K 線資料');
        return {};
      }
    }

    logger.logError(LogCategory.STOCK_DATA, error, '獲取多支股票的 5 分鐘 K 線資料時發生錯誤');
    return {};
  }
};

