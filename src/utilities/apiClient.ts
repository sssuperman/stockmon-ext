import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { useSessionStore } from '../store/sessionStore';
import { LoggerService, LogCategory } from './loggerService';
import { ExtensionContextManager } from './contextManager';

/**
 * 統一的 API 客戶端類，確保所有 API 請求都包含必要的頭信息
 */
export class ApiClient {
  private static instance: ApiClient;
  private logger: LoggerService;

  private constructor() {
    this.logger = LoggerService.getInstance();
  }

  /**
   * 獲取 ApiClient 的單例實例
   */
  public static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient();
    }
    return ApiClient.instance;
  }

  /**
   * 獲取包含認證信息和 UUID 的請求頭
   */
  private getHeaders(): Record<string, string> {
    const sessionStore = useSessionStore.getState();
    const context = ExtensionContextManager.getContext();
    const clientUuid = sessionStore.getOrCreateUuid(context);
    const authToken = sessionStore.authToken;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-UUID': clientUuid
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    return headers;
  }

  /**
   * 發送 GET 請求
   * @param url 請求 URL
   * @param config 額外的請求配置
   */
  public async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    try {
      const headers = this.getHeaders();
      this.logger.log(LogCategory.API, `GET ${url} with headers: ${JSON.stringify(headers)}`);
      
      return await axios.get<T>(url, {
        ...config,
        headers: {
          ...headers,
          ...config?.headers
        }
      });
    } catch (error) {
      this.logger.logError(LogCategory.API, error, `GET ${url} failed`);
      throw error;
    }
  }

  /**
   * 發送 POST 請求
   * @param url 請求 URL
   * @param data 請求數據
   * @param config 額外的請求配置
   */
  public async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    try {
      const headers = this.getHeaders();
      this.logger.log(LogCategory.API, `POST ${url} with headers: ${JSON.stringify(headers)}`);
      
      return await axios.post<T>(url, data, {
        ...config,
        headers: {
          ...headers,
          ...config?.headers
        }
      });
    } catch (error) {
      this.logger.logError(LogCategory.API, error, `POST ${url} failed`);
      throw error;
    }
  }

  /**
   * 發送 PUT 請求
   * @param url 請求 URL
   * @param data 請求數據
   * @param config 額外的請求配置
   */
  public async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    try {
      const headers = this.getHeaders();
      this.logger.log(LogCategory.API, `PUT ${url} with headers: ${JSON.stringify(headers)}`);
      
      return await axios.put<T>(url, data, {
        ...config,
        headers: {
          ...headers,
          ...config?.headers
        }
      });
    } catch (error) {
      this.logger.logError(LogCategory.API, error, `PUT ${url} failed`);
      throw error;
    }
  }

  /**
   * 發送 DELETE 請求
   * @param url 請求 URL
   * @param config 額外的請求配置
   */
  public async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    try {
      const headers = this.getHeaders();
      this.logger.log(LogCategory.API, `DELETE ${url} with headers: ${JSON.stringify(headers)}`);
      
      return await axios.delete<T>(url, {
        ...config,
        headers: {
          ...headers,
          ...config?.headers
        }
      });
    } catch (error) {
      this.logger.logError(LogCategory.API, error, `DELETE ${url} failed`);
      throw error;
    }
  }
}

// 導出單例實例，方便直接使用
export const apiClient = ApiClient.getInstance(); 