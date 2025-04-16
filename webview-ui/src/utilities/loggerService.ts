/**
 * Log levels for the StockMon extension (webview version)
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARNING = 2,
    ERROR = 3
}

// Same categories as the extension version
export enum LogCategory {
    SESSION = 'Session',
    WEBSOCKET = 'WebSocket',
    PANEL = 'Panel',
    EXTENSION = 'Extension',
    STOCK_DATA = 'StockData',
    SYNC = 'Sync',
    AUTH = 'Auth',
    PORTFOLIO = 'Portfolio',
    API = 'API',
    INDICE_DATA = 'IndiceData',
    FEEDBACK = 'Feedback'
}

/**
 * Simplified logging service for the webview UI
 * Uses console.log instead of OutputChannel
 */
export class LoggerService {
    private static instance: LoggerService;
    private logLevel: LogLevel = LogLevel.INFO; // Default log level
    
    private constructor() {
        // No OutputChannel needed for webview
        console.log('[LOGGER] Webview LoggerService initialized');
    }
    
    /**
     * Get the singleton instance of LoggerService
     */
    public static getInstance(): LoggerService {
        if (!LoggerService.instance) {
            LoggerService.instance = new LoggerService();
        }
        return LoggerService.instance;
    }
    
    /**
     * Set the current log level
     * @param level The log level to set
     */
    public setLogLevel(level: LogLevel): void {
        const oldLevel = this.logLevel;
        this.logLevel = level;
        
        // Always log level changes regardless of current level
        const timestamp = new Date().toISOString();
        const levelStr = LogLevel[level];
        console.log(
            `[${timestamp}] [INFO] [LOGGER] Log level changed from ${LogLevel[oldLevel]} (${oldLevel}) to ${levelStr} (${level})`
        );
    }
    
    /**
     * Get the current log level
     * @returns The current log level
     */
    public getLogLevel(): LogLevel {
        return this.logLevel;
    }
    
    /**
     * Log a message with a specific category and level
     * @param category The logging category (e.g., 'Session', 'WebSocket', 'Panel')
     * @param message The message to log
     * @param level The log level (defaults to INFO)
     */
    public log(category: string, message: string, level: LogLevel = LogLevel.INFO): void {
        // Only log if the message level is >= the current log level
        if (level >= this.logLevel) {
            const timestamp = new Date().toISOString();
            const levelStr = LogLevel[level];
            const logMessage = `[${timestamp}] [${levelStr}] [${category}] ${message}`;
            
            switch (level) {
                case LogLevel.DEBUG:
                    console.debug(logMessage);
                    break;
                case LogLevel.INFO:
                    console.info(logMessage);
                    break;
                case LogLevel.WARNING:
                    console.warn(logMessage);
                    break;
                case LogLevel.ERROR:
                    console.error(logMessage);
                    break;
            }
        }
    }
    
    /**
     * Log a debug message
     * @param category The logging category
     * @param message The message to log
     */
    public debug(category: string, message: string): void {
        this.log(category, message, LogLevel.DEBUG);
    }
    
    /**
     * Log an info message
     * @param category The logging category
     * @param message The message to log
     */
    public info(category: string, message: string): void {
        this.log(category, message, LogLevel.INFO);
    }
    
    /**
     * Log a warning message
     * @param category The logging category
     * @param message The message to log
     */
    public warning(category: string, message: string): void {
        this.log(category, message, LogLevel.WARNING);
    }
    
    /**
     * Log an error with a specific category
     * @param category The logging category
     * @param error The error to log
     * @param additionalInfo Optional additional information
     */
    public logError(category: string, error: any, additionalInfo?: string): void {
        const errorMessage = error instanceof Error 
            ? `${error.message}\n${error.stack}`
            : String(error);
            
        const additionalText = additionalInfo ? `\nAdditional info: ${additionalInfo}` : '';
        this.log(category, `ERROR: ${errorMessage}${additionalText}`, LogLevel.ERROR);
    }
} 