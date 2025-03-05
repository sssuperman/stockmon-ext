import * as vscode from 'vscode';

    /**
 * Log levels for the StockMon extension
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARNING = 2,
    ERROR = 3
}

/**
 * Centralized logging service for the StockMon extension
 * Manages a single OutputChannel with categorized logging and different log levels
 */
export class LoggerService {
    private static instance: LoggerService;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.INFO; // Default log level
    
    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('StockMon');
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
        
        // 始終顯示日誌級別變更信息，無論當前級別如何
        const timestamp = new Date().toISOString();
        const levelStr = LogLevel[level];
        this.outputChannel.appendLine(
            `[${timestamp}] [INFO] [LOGGER] Log level changed from ${LogLevel[oldLevel]} (${oldLevel}) to ${levelStr} (${level})`
        );
        
        // 如果設置為 DEBUG，顯示一些額外的調試信息
        if (level === LogLevel.DEBUG) {
            this.debug(LogCategory.EXTENSION, 'Debug logging enabled - you will see more detailed logs');
        }
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
            this.outputChannel.appendLine(`[${timestamp}] [${levelStr}] [${category}] ${message}`);
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
    
    /**
     * Show the output channel
     */
    public show(): void {
        this.outputChannel.show();
    }
    
    /**
     * Clear the output channel
     */
    public clear(): void {
        this.outputChannel.clear();
    }
    
    /**
     * Dispose the output channel
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }
    
    /**
     * Register the output channel with the extension context
     * @param context The extension context
     */
    public register(context: vscode.ExtensionContext): void {
        context.subscriptions.push(this.outputChannel);
    }
}

// Common categories for consistent logging
export enum LogCategory {
    SESSION = 'Session',
    WEBSOCKET = 'WebSocket',
    PANEL = 'Panel',
    EXTENSION = 'Extension',
    STOCK_DATA = 'StockData',
    SYNC = 'Sync',
    AUTH = 'Auth',
    PORTFOLIO = 'Portfolio'
} 