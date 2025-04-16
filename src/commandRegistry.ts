import * as vscode from 'vscode';
import { LoggerService, LogCategory, LogLevel } from './utilities/loggerService';

// Import command registration functions from individual modules
import { registerAuthCommands } from './commands/auth';
import { registerStockCommands } from './commands/stock';
import { registerPanelCommands } from './commands/panel';
import { registerPortfolioCommands } from './commands/portfolio';
import { registerAlertCommands } from './commands/alert';
import { registerSyncCommands } from './commands/sync';
import { registerConfigCommands } from './commands/config';
import { registerFeedbackCommands } from './commands/feedback';
import { registerDebugCommands } from './commands/debug';
import { registerNotificationCommands } from './commands/notification';

/**
 * Registers all commands for the StockMon extension.
 * @param context - The extension context provided by VS Code.
 * @param logger - The logger service instance.
 */
export function registerCommands(context: vscode.ExtensionContext, logger: LoggerService, logLevel: LogLevel): void {
    logger.info(LogCategory.COMMAND, 'Registering extension commands');

    // Register commands from each module
    registerStockCommands(context, logger);
    registerAuthCommands(context, logger);
    registerPanelCommands(context, logger);
    registerPortfolioCommands(context, logger);
    registerAlertCommands(context, logger);
    registerSyncCommands(context, logger);
    registerConfigCommands(context, logger);
    registerFeedbackCommands(context, logger);
    // Debug commands are only registered in debug mode

    registerDebugCommands(context, logger);
    registerNotificationCommands(context, logger);

    logger.info(LogCategory.COMMAND, 'All commands registered successfully');
}

// Optional: Define an interface for command registration functions if needed
// export interface CommandRegistration {
//     (context: vscode.ExtensionContext, logger: LoggerService): void;
// } 